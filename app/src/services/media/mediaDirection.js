export function isExplicitOutboundMedia(media = {}, payload = {}, event = {}) {
  const origin = String(
    media.origin
    || media.source
    || media.direction
    || media.message_origin
    || payload.media_origin
    || payload.media_source
    || '',
  ).toLowerCase();
  if (['outbound', 'outbound_media', 'operator', 'manual_reply', 'assistant', 'whatsapp_fromme', 'from_me'].includes(origin)) {
    return true;
  }

  const mediaEventId = media.event_id || media.eventId || media.source_event_id || media.sourceEventId;
  if (event.id && mediaEventId && String(event.id) === String(mediaEventId)) return true;

  const mediaMessageId = media.external_message_id || media.externalMessageId || media.message_id || media.messageId;
  if (event.external_message_id && mediaMessageId && String(event.external_message_id) === String(mediaMessageId)) return true;

  return Boolean(payload.fromMe || payload.data?.key?.fromMe);
}
