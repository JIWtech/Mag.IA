const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const normalizeCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_normalize_webhook.js'), 'utf8');
const captureCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_capture_manual_reply.js'), 'utf8');

function env() { return { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key', WHATSAPP_TENANT_SLUG: 'wesley_automoveis' }; }
function payload(fromMe, message = { conversation: 'Boa tarde, pode vir agora' }) {
  return { event: 'messages.upsert', instance: 'genesis', data: { key: { id: 'wamid-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe }, pushName: 'Cliente', message } };
}
async function normalize(body) {
  const fn = new AsyncFunction('$json', '$env', normalizeCode);
  return fn.call({ helpers: { httpRequest: async () => [] } }, { body }, env());
}
async function capture(input, existing = []) {
  const calls = [];
  const fn = new AsyncFunction('$json', '$env', captureCode);
  const result = await fn.call({ helpers: { httpRequest: async (request) => {
    calls.push(request);
    if (request.method === 'GET' && request.url.includes('/tenants?')) return [{ id: 'tenant-1' }];
    if (request.method === 'GET') return existing;
    if (request.method === 'POST') return [{ id: 'event-manual-1', ...request.body }];
    if (request.method === 'PATCH') return [{ id: existing[0]?.id || 'event-known' }];
    throw new Error(`unexpected ${request.method}`);
  } } }, input, env());
  return { result, calls };
}

test('fromMe=false remains an inbound event', async () => {
  const result = await normalize(payload(false));
  assert.equal(result.json.shouldProcess, true);
  assert.equal(result.json.is_manual_whatsapp_outbound, false);
});

test('fromMe=true unmatched text becomes a human manual_reply', async () => {
  const normalized = await normalize(payload(true));
  const { result, calls } = await capture(normalized.json);
  const inserted = calls.find((call) => call.method === 'POST').body;
  assert.equal(result.json.queued.manual_reply, true);
  assert.equal(inserted.direction, 'outbound');
  assert.equal(inserted.sender_type, 'agent');
  assert.equal(inserted.service, 'manual_reply');
  assert.equal(inserted.ai_provider, 'human_operator');
  assert.equal(inserted.delivery_status, 'sent');
  assert.equal(inserted.raw_payload.magia_operator.source, 'whatsapp_fromMe');
  const followUpPatch = calls.find((call) => call.method === 'PATCH' && call.url.includes('/follow_up_jobs?'));
  assert.deepEqual(followUpPatch.body, { status: 'cancelled', updated_at: followUpPatch.body.updated_at, error: 'human_operator_activity' });
});

test('fromMe echo of a NORIA outbound enriches it and never inserts manual_reply', async () => {
  const normalized = await normalize(payload(true));
  const { result, calls } = await capture(normalized.json, [{
    id: 'existing-ai', external_conversation_id: normalized.json.remoteJid,
    raw_payload: { outbound_origin: 'noria', provider_event: { instance: normalized.json.instance } },
  }]);
  assert.equal(result.json.queued.duplicate, true);
  assert.equal(result.json.queued.matched_outbound, true);
  assert.equal(calls.some((call) => call.method === 'POST'), false);
  assert.equal(calls.some((call) => call.method === 'PATCH'), true);
});

for (const [kind, messageKey] of [['audio', 'audioMessage'], ['image', 'imageMessage']]) {
  test(`fromMe unmatched ${kind} preserves the media descriptor`, async () => {
    const message = { [messageKey]: { mimetype: kind === 'audio' ? 'audio/ogg' : 'image/jpeg', fileLength: 42, seconds: 3 } };
    const normalized = await normalize(payload(true, message));
    const { calls } = await capture(normalized.json);
    const inserted = calls.find((call) => call.method === 'POST').body;
    assert.equal(inserted.raw_payload.source_media.kind, kind);
    assert.equal(inserted.raw_payload.media.status, 'pending');
  });
}

test('generated workflow routes manual sends outside the AI core and through media finalization', {
  skip: !fs.existsSync(path.join(root, 'n8n/workflows/NORIA_Hotfix12_CATALOGO_REFERENCIAS_PRODUTOS_LAYOUT.json')),
}, () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA_Hotfix12_CATALOGO_REFERENCIAS_PRODUTOS_LAYOUT.json'), 'utf8'));
  const next = (name) => (workflow.connections[name]?.main || []).flat().map((edge) => edge.node);
  assert.deepEqual(next('Mensagem enviada fora da NORIA?').sort(), ['Capturar Resposta Manual WhatsApp', 'Sincronizar Contato WhatsApp'].sort());
  assert.deepEqual(next('Capturar Resposta Manual WhatsApp'), ['Preparar Mídia WhatsApp']);
  assert.ok(!next('Capturar Resposta Manual WhatsApp').includes('Processar Conversa WhatsApp'));
});
