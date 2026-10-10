// Captures Evolution fromMe messages that were sent outside NORIA. This branch
// deliberately never enters the conversation core, so it cannot wake IA or
// alter an existing human lock.
const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
if (!base || !key) throw new Error('Supabase environment unavailable');

function unwrap(raw = {}) {
  let message = raw?.data?.message || raw?.message || raw || {};
  for (const wrapper of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    if (message?.[wrapper]?.message) message = message[wrapper].message;
  }
  return message;
}
function safeProductSnapshot(message) {
  const msg = message?.productMessage;
  if (!msg || typeof msg !== 'object') return null;
  const product = msg.product || msg.productSnapshot || msg;
  const clean = (value, max = 180) => (typeof value === 'string' || typeof value === 'number') ? String(value).trim().slice(0, max) : '';
  const candidate = product?.productImage?.url || product?.imageUrl || product?.image_url || product?.productImage?.imageUrl || '';
  let imageUrl = '';
  try {
    const url = new URL(String(candidate));
    if (url.protocol === 'https:' && !url.username && !url.password && url.hostname
      && !/(?:^|\.)(?:localhost|local|internal|test)$/i.test(url.hostname)
      && !/^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname)) imageUrl = url.href.slice(0, 1500);
  } catch (_) {}
  const thumbnail = product?.productImage?.jpegThumbnail || product?.jpegThumbnail || null;
  let thumbnailBase64 = '';
  if (typeof thumbnail === 'string' && thumbnail.length > 0 && thumbnail.length <= 48000 && /^[A-Za-z0-9+/]*={0,2}$/.test(thumbnail)) thumbnailBase64 = thumbnail;
  else if (thumbnail && typeof thumbnail === 'object' && Array.isArray(thumbnail.data) && thumbnail.data.length > 0 && thumbnail.data.length <= 32000 && thumbnail.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && typeof Buffer !== 'undefined') thumbnailBase64 = Buffer.from(thumbnail.data).toString('base64');
  return {
    source: 'whatsapp_manual_product', product_id: clean(product?.productId || product?.product_id || product?.id, 220), retailer_id: clean(product?.retailerId || product?.retailer_id, 220), title: clean(product?.title || product?.name, 180), currency: clean(product?.currencyCode || product?.currency, 10), price_amount_1000_raw: clean(product?.priceAmount1000, 36), image_url: imageUrl, thumbnail_base64: thumbnailBase64,
    // A manual provider snapshot is evidence of what was sent, not a current
    // catalog quote. The UI must not treat this raw amount as authoritative.
    verified_price: false, image_status: imageUrl ? 'provider_url_unverified' : 'not_available',
  };
}
function sourceMedia(message) {
  const pairs = [['image', message.imageMessage], ['audio', message.audioMessage], ['video', message.videoMessage], ['document', message.documentMessage], ['sticker', message.stickerMessage]];
  const found = pairs.find(([, value]) => value && typeof value === 'object');
  if (!found) return null;
  const [kind, media] = found;
  return { kind, mime_type: String(media.mimetype || media.mimeType || '').split(';')[0].trim(), caption: String(media.caption || ''), file_length: Number(media.fileLength || media.file_length || 0), duration: Number(media.seconds || media.duration || 0), width: Number(media.width || 0), height: Number(media.height || 0) };
}

const tenantRows = await this.helpers.httpRequest({ method: 'GET', url: `${base}/rest/v1/tenants?select=id&slug=eq.${encodeURIComponent(input.tenant_slug)}&limit=1`, headers, json: true, timeout: 7000 });
const tenantId = tenantRows?.[0]?.id;
if (!tenantId) throw new Error('tenant_not_found');
const message = unwrap(input.raw_payload);
const media = sourceMedia(message);
const productSnapshot = safeProductSnapshot(message);
const originalRaw = input.raw_payload && typeof input.raw_payload === 'object' ? input.raw_payload : {};
const rawData = originalRaw?.data && typeof originalRaw.data === 'object' ? originalRaw.data : {};
const safeProviderAudit = { event: String(originalRaw.event || originalRaw.type || ''), instance: String(originalRaw.instance || originalRaw.instanceName || input.instance || ''), date_time: String(originalRaw.date_time || originalRaw.dateTime || ''), message_type: String(rawData.messageType || input.contentType || ''), from_me: true };
// WhatsApp can echo one provider message for a phone JID and a LID. Deduplicate
// only inside the same tenant/channel and only when the provider instance also
// matches; LIDs are never guessed as phone numbers.
const lookup = `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&channel_type=eq.whatsapp&direction=eq.outbound&external_message_id=eq.${encodeURIComponent(input.messageId)}&select=id,raw_payload,external_conversation_id&limit=5`;
const candidates = await this.helpers.httpRequest({ method: 'GET', url: lookup, headers, json: true, timeout: 7000 });
const existing = (Array.isArray(candidates) ? candidates : []).filter(row => {
  const priorInstance = String(row.raw_payload?.provider_event?.instance || '');
  return priorInstance === String(input.instance || '') || (!priorInstance && row.external_conversation_id === input.remoteJid);
});
if (Array.isArray(existing) && existing.length) {
  // Evolution can echo a panel/AI send after NORIA already created it. Enrich
  // that row only; never turn it into a human manual_reply.
  const prior = existing.find(row => row.external_conversation_id === input.remoteJid) || existing[0];
  const rawPayload = { ...(prior.raw_payload || {}), evolution_echo: { received_at: new Date().toISOString(), source: 'messages.upsert_fromMe' } };
  if (productSnapshot && !rawPayload.product_snapshot) rawPayload.product_snapshot = productSnapshot;
  await this.helpers.httpRequest({ method: 'PATCH', url: `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&id=eq.${encodeURIComponent(prior.id)}`, headers, body: { raw_payload: rawPayload }, json: true, timeout: 7000 });
  return { json: { ...input, tenant_id: tenantId, queued: { event_id: prior.id, duplicate: true, matched_outbound: true } } };
}
const text = String(input.messageText || '').trim();
const event = {
  tenant_id: tenantId, tenant_slug: input.tenant_slug, channel_type: 'whatsapp', external_conversation_id: input.remoteJid,
  external_message_id: input.messageId, direction: 'outbound', sender_type: 'agent', message_text: text,
  contact_name: input.contactName || null, service: 'manual_reply', stage: null, handoff: false,
  ai_provider: 'human_operator', ai_model: null, delivery_status: 'sent', response_text: null,
  raw_payload: { provider_event: safeProviderAudit, magia_operator: { source: 'whatsapp_fromMe', operator_name: 'Atendente', identity_resolution: 'unavailable' }, outbound_origin: 'whatsapp_fromMe', content_type: productSnapshot ? 'product' : String(input.contentType || 'text'), ...(productSnapshot ? { product_snapshot: productSnapshot } : {}), ...(media ? { source_media: media, media: { kind: media.kind, category: media.kind, source: 'whatsapp', status: 'pending', verified: false } } : {}) },
};
const saved = await this.helpers.httpRequest({ method: 'POST', url: `${base}/rest/v1/channel_events`, headers: { ...headers, Prefer: 'return=representation' }, body: event, json: true, timeout: 10000 });
const row = Array.isArray(saved) ? saved[0] : saved;
if (!row?.id) throw new Error('manual_reply_not_persisted');
// A human outbound is real conversation activity. It must stop pending automatic
// follow-ups, but it must not touch the attendance/human-lock state.
await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${base}/rest/v1/follow_up_jobs?tenant_id=eq.${encodeURIComponent(tenantId)}&channel_type=eq.whatsapp&external_conversation_id=eq.${encodeURIComponent(input.remoteJid)}&status=eq.pending`,
  headers,
  body: { status: 'cancelled', updated_at: new Date().toISOString(), error: 'human_operator_activity' },
  json: true,
  timeout: 7000,
}).catch(() => {});
return { json: { ...input, tenant_id: tenantId, queued: { event_id: row.id, duplicate: false, manual_reply: true }, source_media: media || undefined } };
