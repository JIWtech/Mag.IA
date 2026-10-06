const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
let text = String(input.messageText || '').trim();

function extractEvolutionMessage(raw = {}) {
  let msg = raw?.data?.message || raw?.message || raw || {};
  if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;
  return msg;
}

const mediaMessage = extractEvolutionMessage(input.raw_payload);

function referralText(value, max = 500) {
  const text = (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) ? String(value).trim() : '';
  return text.length > 0 && text.length <= max ? text : '';
}

function referralFromEvolution(raw = {}) {
  const message = extractEvolutionMessage(raw);
  const wrappers = [message.extendedTextMessage, message.imageMessage, message.videoMessage, message.documentMessage, message.audioMessage]
    .filter(value => value && typeof value === 'object');
  const adReply = wrappers.map(value => value.contextInfo?.externalAdReply).find(value => value && typeof value === 'object');
  if (!adReply) return null;
  const referral = { source: 'external_ad_reply' };
  const fields = [['title', 'title'], ['body', 'body'], ['sourceId', 'source_id'], ['sourceUrl', 'source_url'], ['mediaType', 'media_type']];
  for (const [from, to] of fields) {
    const value = referralText(adReply[from]);
    if (value) referral[to] = value;
  }
  return Object.keys(referral).length > 1 ? referral : null;
}

const referral = referralFromEvolution(input.raw_payload);

let contentType = String(input.contentType || 'text').toLowerCase();
let sourceMedia = null;
let audioMetadata = null;

const salesMedia = input.core_sales ? (mediaMessage.imageMessage ? 'image' : mediaMessage.documentMessage ? 'document' : '') : '';

if (mediaMessage.imageMessage) {
  contentType = 'image';
  const img = mediaMessage.imageMessage;
  sourceMedia = {
    kind: 'image',
    mime_type: String(img.mimetype || 'image/jpeg').split(';')[0].trim().toLowerCase(),
    caption: String(img.caption || ''),
    file_length: Number(img.fileLength) || 0,
    width: Number(img.width) || 0,
    height: Number(img.height) || 0,
  };
  if (salesMedia && !text.startsWith('[' + salesMedia + ']')) text = '[' + salesMedia + ']\n' + text;
} else if (mediaMessage.audioMessage) {
  contentType = 'audio';
  const aud = mediaMessage.audioMessage;
  sourceMedia = {
    kind: 'audio',
    mime_type: String(aud.mimetype || 'audio/ogg').split(';')[0].trim().toLowerCase(),
    duration: Number(aud.seconds) || 0,
    file_length: Number(aud.fileLength) || 0,
  };
  audioMetadata = { seconds: Number(aud.seconds) || 0, bytes: Number(aud.fileLength) || 0 };
  if (!text.startsWith('[audio]')) text = '[audio]';
} else if (mediaMessage.videoMessage) {
  contentType = 'video';
  const vid = mediaMessage.videoMessage;
  sourceMedia = {
    kind: 'video',
    mime_type: String(vid.mimetype || 'video/mp4').split(';')[0].trim().toLowerCase(),
    caption: String(vid.caption || ''),
    duration: Number(vid.seconds) || 0,
    file_length: Number(vid.fileLength) || 0,
    width: Number(vid.width) || 0,
    height: Number(vid.height) || 0,
  };
  if (!text.startsWith('[video]')) text = '[video]' + (text ? '\n' + text : '');
} else if (mediaMessage.documentMessage) {
  contentType = 'document';
  const doc = mediaMessage.documentMessage;
  sourceMedia = {
    kind: 'document',
    mime_type: String(doc.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
    file_name: String(doc.fileName || ''),
    caption: String(doc.caption || ''),
    file_length: Number(doc.fileLength) || 0,
  };
  if (salesMedia && !text.startsWith('[' + salesMedia + ']')) text = '[' + salesMedia + ']\n' + text;
} else if (mediaMessage.stickerMessage) {
  contentType = 'sticker';
  const stk = mediaMessage.stickerMessage;
  sourceMedia = {
    kind: 'sticker',
    mime_type: String(stk.mimetype || 'image/webp').split(';')[0].trim().toLowerCase(),
    file_length: Number(stk.fileLength) || 0,
    width: Number(stk.width) || 0,
    height: Number(stk.height) || 0,
    is_animated: Boolean(stk.isAnimated),
  };
  if (!text.startsWith('[sticker]')) text = '[sticker]';
} else if (contentType === 'audio') {
  const aud = input.raw_payload?.data?.message?.audioMessage || {};
  audioMetadata = { seconds: Number(aud.seconds) || 0, bytes: Number(aud.fileLength) || 0 };
  sourceMedia = { kind: 'audio', mime_type: 'audio/ogg', duration: audioMetadata.seconds, file_length: audioMetadata.bytes };
  if (!text.startsWith('[audio]')) text = '[audio]';
}

const isFragment = text.split(/\s+/).length <= 2 && !/[?!.]$/.test(text);
const quiet = Math.max(input.core_quiet_ms, isFragment ? input.core_fragment_ms : 0);
const pendingMedia = sourceMedia ? {
  kind: sourceMedia.kind,
  category: sourceMedia.kind,
  source: 'whatsapp',
  status: 'pending',
  verified: false,
  caption: sourceMedia.caption || '',
  fileName: sourceMedia.file_name || '',
  mimeType: sourceMedia.mime_type || '',
  size: Number(sourceMedia.file_length || 0),
  duration: Number(sourceMedia.duration || 0),
  width: Number(sourceMedia.width || 0) || null,
  height: Number(sourceMedia.height || 0) || null,
} : null;

const queued = await this.helpers.httpRequest({
  method: 'POST',
  url: base + '/rest/v1/rpc/magia_enqueue_turn',
  headers: { apikey: key, Authorization: 'Bearer ' + key },
  body: {
    p_tenant: input.tenant_id,
    p_chat: input.remoteJid,
    p_instance: input.instance,
    p_quiet_ms: quiet,
    p_message: {
      id: input.messageId,
      text,
      name: input.contactName,
      raw: {
        channel_type: 'whatsapp',
        content_type: contentType,
        core_revision: 'conversation_core_v1',
        ...(sourceMedia ? { source_media: sourceMedia } : {}),
        ...(pendingMedia ? { media: pendingMedia } : {}),
        ...(salesMedia ? { sales_media_type: salesMedia } : {}),
        ...(audioMetadata ? { audio_metadata: audioMetadata } : {}),
        ...(referral ? { referral } : {})
      }
    }
  },
  json: true,
  timeout: 10000,
});

return { json: { ...input, messageText: text, contentType, queued, core_wait_seconds: Math.ceil(quiet / 1000) + 1 } };
