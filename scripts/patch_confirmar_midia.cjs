const fs = require('node:fs');
const path = require('node:path');

const file = process.env.NORIA_WORKFLOW_FILE || path.join(__dirname, '../n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));

function uniqueCodeNode(name) {
  const matches = workflow.nodes.filter((node) => node.name === name && node.type === 'n8n-nodes-base.code');
  if (matches.length !== 1) throw new Error(`Expected one Code node named ${name}; found ${matches.length}`);
  if (typeof matches[0].parameters?.jsCode !== 'string') throw new Error(`${name} has no jsCode`);
  return matches[0];
}

function replaceRange(code, startMarker, endMarkers, replacement, label) {
  const start = code.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = endMarkers
    .map((marker) => code.indexOf(marker, start))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (end < 0) throw new Error(`${label}: end marker not found`);
  return code.slice(0, start) + replacement + code.slice(end);
}

const confirmation = uniqueCodeNode('Confirmar Mídia WhatsApp');
const confirmationBlock = `const tenantId = String(source.tenant_id || '').trim();
const eventId = String(job.event_id || '').trim();
const externalMessageId = String(job.external_message_id || '').trim();
const chatId = String(source.remoteJid || '').trim();
let persistenceError = '';

if (!tenantId || !eventId || !externalMessageId || !chatId) {
  persistenceError = 'media_identity_missing';
  media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
} else {
  const base = String($env.SUPABASE_URL || '').replace(/\\/$/, '');
  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;
  let result;
  try {
    result = await this.helpers.httpRequest({
      method: 'POST',
      url: base + '/rest/v1/rpc/magia_confirm_whatsapp_media',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: { p_tenant: tenantId, p_event: eventId, p_channel: 'whatsapp', p_conversation: chatId,
        p_external_message: externalMessageId, p_media: media },
      json: true,
      timeout: 10000,
    });
  } catch (_) {
    persistenceError = 'media_atomic_rpc_transport_failed';
    media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
  }
  const confirmationResult = Array.isArray(result) ? result[0] : result;
  const normalizeNoriaMime = (value) => {
    const normalized = String(value || '').toLowerCase().replace(/\\s+/g, '');
    if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
      return { value: normalized, base: normalized };
    }
    if (normalized === 'audio/ogg;codecs=opus') return { value: normalized, base: 'audio/ogg' };
    return null;
  };
  const equivalentNoriaMime = (left, right) => {
    const a = normalizeNoriaMime(left);
    const b = normalizeNoriaMime(right);
    return Boolean(a && b && a.base === b.base && (a.base === 'audio/ogg' || a.value === b.value));
  };
  const sameObject = confirmationResult?.stored_media
    && confirmationResult.stored_media.bucket === media.bucket
    && confirmationResult.stored_media.storagePath === media.storagePath
    && equivalentNoriaMime(confirmationResult.stored_media.mimeType, media.mimeType)
    && Number(confirmationResult.stored_media.size || 0) === Number(media.size || 0)
    && confirmationResult.stored_media.status === 'stored'
    && confirmationResult.stored_media.verified === true
    && media.status === 'stored'
    && media.verified === true;
  if (!persistenceError && (!confirmationResult
    || (confirmationResult.applied !== true
      && !(confirmationResult.reason === 'already_stored' && sameObject)))) {
    persistenceError = 'media_atomic_confirmation_rejected';
    media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
  }
}

`;
if (!confirmation.parameters.jsCode.includes('media_identity_missing')
  || !confirmation.parameters.jsCode.includes('equivalentNoriaMime')) {
  confirmation.parameters.jsCode = replaceRange(
    confirmation.parameters.jsCode,
    'const tenantId = String(source.tenant_id || \'\').trim();',
    ['return {\n  json:', 'return {\r\n  json:'],
    confirmationBlock,
    'Confirmar Mídia WhatsApp',
  );
}

const manual = uniqueCodeNode('Capturar Resposta Manual WhatsApp');
const manualStart = '  const rawPayload = { ...(prior.raw_payload || {}), evolution_echo:';
const manualAtomicStart = '  const patch = { evolution_echo:';
if (!manual.parameters.jsCode.includes('/rpc/magia_merge_channel_event_raw')
  || !manual.parameters.jsCode.includes('p_expected_product_snapshot: prior.raw_payload?.product_snapshot || null')
  || !manual.parameters.jsCode.includes('if (productSnapshot && !prior.raw_payload?.product_snapshot)')
  || !manual.parameters.jsCode.includes("'product_snapshot_stale'")) {
  const manualBlock = `  const patch = { evolution_echo: { received_at: new Date().toISOString(), source: 'messages.upsert_fromMe' } };
  if (productSnapshot && !prior.raw_payload?.product_snapshot) patch.product_snapshot = productSnapshot;
  const merged = await this.helpers.httpRequest({
    method: 'POST',
    url: base + '/rest/v1/rpc/magia_merge_channel_event_raw',
    headers,
    body: {
      p_tenant: tenantId,
      p_event: prior.id,
      p_channel: 'whatsapp',
      p_conversation: prior.external_conversation_id,
      p_external_message: input.messageId,
      p_patch: patch,
      p_expected_product_snapshot: prior.raw_payload?.product_snapshot || null,
    },
    json: true,
    timeout: 7000,
  });
  const mergeResult = Array.isArray(merged) ? merged[0] : merged;
  if (!mergeResult || (mergeResult.applied !== true
    && !['already_applied', 'product_snapshot_stale'].includes(mergeResult.reason))) {
    throw new Error('manual_echo_not_persisted');
  }
`;
  manual.parameters.jsCode = replaceRange(
    manual.parameters.jsCode,
    manual.parameters.jsCode.includes(manualStart) ? manualStart : manualAtomicStart,
    ['  return { json: { ...input, tenant_id: tenantId, queued:', '  return {\r\n    json: { ...input, tenant_id: tenantId, queued:'],
    manualBlock,
    'Capturar Resposta Manual WhatsApp',
  );
}

fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Patched atomic media confirmation and manual WhatsApp echo without changing workflow topology.');
