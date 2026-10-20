import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';

export function conversationReadKey(tenantId, userId, channelType, externalConversationId) {
  const tenant = String(tenantId || '').trim().toLowerCase();
  const user = String(userId || '').trim().toLowerCase();
  const channel = normalizeChannel(channelType).type || 'unknown';
  const conversationId = normalizeExternalConversationId(channel, externalConversationId);
  return `${tenant}:${user}:${channel}:${conversationId || 'unknown'}`;
}

export function isUnreadInboundEvent(event = {}, { eventAlreadyPresent = false, markIncomingAsRead = false } = {}) {
  return !eventAlreadyPresent
    && !markIncomingAsRead
    && !isInternalOperationalEvent(event)
    && String(event.direction || '').toLowerCase() === 'inbound'
    && String(event.sender_type || '').toLowerCase() !== 'system';
}

export function getLatestReadableEvent(conversation = {}) {
  const readable = (conversation.messages || []).filter((message) => (
    message?.eventId
    && !String(message.eventId).endsWith('-response')
    && message?.createdAt
  ));
  return readable.reduce((latest, message) => {
    const messageAt = Date.parse(message.createdAt);
    const latestAt = Date.parse(latest?.createdAt || '');
    if (!latest || (Number.isFinite(messageAt) && (!Number.isFinite(latestAt) || messageAt >= latestAt))) {
      return message;
    }
    return latest;
  }, null);
}

export function shouldAdvanceConversationRead(marker, latestEvent) {
  if (!latestEvent?.eventId || !latestEvent?.createdAt) return false;
  if (!marker) return true;
  const markerAt = Date.parse(marker.last_read_at || '');
  const latestAt = Date.parse(latestEvent.createdAt);
  if (!Number.isFinite(markerAt) || !Number.isFinite(latestAt)) return marker.last_read_event_id !== latestEvent.eventId;
  return latestAt > markerAt
    || (latestAt === markerAt && marker.last_read_event_id !== latestEvent.eventId);
}

function isUnreadInboundMessage(message = {}, marker) {
  if (message.from !== 'contact' || !message.eventId || !message.createdAt) return false;
  if (!marker) return true;
  const messageAt = Date.parse(message.createdAt);
  const markerAt = Date.parse(marker.last_read_at || '');
  if (!Number.isFinite(messageAt) || !Number.isFinite(markerAt)) return false;
  if (messageAt > markerAt) return true;
  if (messageAt < markerAt) return false;
  // UUID não é ordenável: em empate de timestamp, somente o evento usado no
  // watermark é considerado lido. A escolha conservadora evita perder unread.
  return message.eventId !== marker.last_read_event_id;
}

export function upsertConversationReadMarker(markers = [], marker) {
  if (!marker?.tenant_id || !marker?.user_id) return Array.isArray(markers) ? markers : [];
  const key = conversationReadKey(
    marker.tenant_id,
    marker.user_id,
    marker.channel_type,
    marker.external_conversation_id,
  );
  const current = (markers || []).find((item) => conversationReadKey(
    item.tenant_id,
    item.user_id,
    item.channel_type,
    item.external_conversation_id,
  ) === key);
  const next = (markers || []).filter((item) => conversationReadKey(
    item.tenant_id,
    item.user_id,
    item.channel_type,
    item.external_conversation_id,
  ) !== key);
  if (current && !shouldAdvanceConversationRead(current, {
    eventId: marker.last_read_event_id,
    createdAt: marker.last_read_at,
  })) {
    return [...next, current];
  }
  return [...next, marker];
}

export function applyConversationReadState(conversations = [], markers = [], tenantId = '', userId = '') {
  const markerIndex = new Map();
  for (const marker of markers || []) {
    markerIndex.set(conversationReadKey(
      marker.tenant_id,
      marker.user_id,
      marker.channel_type,
      marker.external_conversation_id,
    ), marker);
  }

  return (conversations || []).map((conversation) => {
    const marker = markerIndex.get(conversationReadKey(
      tenantId,
      userId,
      conversation.channelType || conversation.channel,
      conversation.externalConversationId || conversation.normalizedExternalId,
    ));
    return {
      ...conversation,
      unread: (conversation.messages || []).filter((message) => isUnreadInboundMessage(message, marker)).length,
    };
  });
}
