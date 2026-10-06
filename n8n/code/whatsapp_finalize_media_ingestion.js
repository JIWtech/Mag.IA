// Runs after the native HTTP Request node. Storage is considered available only
// after a 2xx upload and a scoped HEAD whose exact length matches the bytes sent.
function compactMediaError(error, fallback) {
  return String(error?.message || error || fallback)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
}

function responseStatus(value) {
  return Number(value?.statusCode || value?.status || value?.body?.statusCode || 0);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const entries = Object.entries(headers || {});
  return entries.find(([key]) => String(key).toLowerCase() === lower)?.[1] || '';
}

function preparedInput() {
  if ($json?.media_ingestion) return { json: $json, binary: $binary || {} };
  const item = $('Preparar Mídia WhatsApp').item;
  return { json: item?.json || {}, binary: item?.binary || {} };
}

const prepared = preparedInput();
const source = prepared.json;
const job = source.media_ingestion || {};

if (!job.present) return { json: source, binary: prepared.binary };

let media = { ...(job.media || {}) };
if (job.should_upload) {
  const status = responseStatus($json);
  if (status < 200 || status >= 300) {
    media = { ...media, status: 'storage_error', verified: false, error: `storage_upload_failed:${status || 'unknown'}` };
  } else {
    try {
      const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
      const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;
      const verify = await this.helpers.httpRequest({
        method: 'HEAD',
        url: `${base}/storage/v1/object/${encodeURIComponent(media.bucket)}/${media.storagePath}`,
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        json: false,
        returnFullResponse: true,
        timeout: 20000,
      });
      const verifyStatus = responseStatus(verify);
      if (verifyStatus < 200 || verifyStatus >= 300) throw new Error(`storage_verify_failed:${verifyStatus || 'unknown'}`);
      const storedSize = Number(headerValue(verify.headers || verify.response?.headers, 'content-length'));
      if (!Number.isFinite(storedSize) || storedSize !== Number(job.expectedSize)) throw new Error('storage_size_mismatch');
      media = { ...media, status: 'stored', verified: true, storedSize, size: storedSize, magic: job.magic || media.magic || '' };
    } catch (error) {
      const code = String(error?.message || 'storage_verify_failed');
      media = { ...media, status: 'storage_error', verified: false, error: code.includes('storage_size_mismatch') ? 'storage_size_mismatch' : compactMediaError(error, 'storage_verify_failed') };
    }
  }
}

const tenantId = String(source.tenant_id || '').trim();
const eventId = String(job.event_id || '').trim();
const externalMessageId = String(job.external_message_id || '').trim();
const chatId = String(source.remoteJid || '').trim();
let persistenceError = '';

if (tenantId && eventId && externalMessageId && chatId) {
  const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;
  const scope = `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&channel_type=eq.whatsapp&external_conversation_id=eq.${encodeURIComponent(chatId)}&id=eq.${encodeURIComponent(eventId)}&external_message_id=eq.${encodeURIComponent(externalMessageId)}`;
  try {
    const rows = await this.helpers.httpRequest({ method: 'GET', url: `${scope}&select=id,raw_payload&limit=1`, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, json: true, timeout: 10000 });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('media_event_scope_mismatch');
    const rawPayload = rows[0].raw_payload && typeof rows[0].raw_payload === 'object' ? rows[0].raw_payload : {};
    const saved = await this.helpers.httpRequest({
      method: 'PATCH', url: scope, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: { raw_payload: { ...rawPayload, media } }, json: true, timeout: 10000,
    });
    if (!Array.isArray(saved) || saved.length !== 1) throw new Error('media_event_not_persisted');
  } catch (error) {
    persistenceError = compactMediaError(error, 'media_persistence_failed');
    media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
  }
}

return {
  json: { ...source, media_ingestion: { ...job, media, persisted: !persistenceError, persistence_error: persistenceError || undefined } },
  binary: prepared.binary,
};
