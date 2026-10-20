import { isInternalOperationalEvent } from '../timeline/eventClassification.js';

const genericLeadInquiryText = 'ola posso ter mais informacoes sobre isso';
const genericLeadInquiryWindowMs = 3 * 60 * 1000;

function normalizeLeadInquiryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isGenericLeadInquiry(eventOrMessage = {}) {
  const text = String(eventOrMessage.message_text || eventOrMessage.text || '').trim();
  return normalizeLeadInquiryText(text) === genericLeadInquiryText;
}

export function isSubstantiveInboundFollowUp(eventOrMessage = {}) {
  const text = String(eventOrMessage.message_text || eventOrMessage.text || '').trim();
  if (!text || isGenericLeadInquiry(eventOrMessage) || /^\[(?:audio|image|video|document|sticker|contact)\]$/i.test(text)) return false;
  return normalizeLeadInquiryText(text).replace(/\s/g, '').length >= 3;
}

export function isShortlyAfter(previousAt, nextAt) {
  const previous = Date.parse(previousAt || '');
  const next = Date.parse(nextAt || '');
  return !Number.isNaN(previous) && !Number.isNaN(next) && next >= previous && next - previous <= genericLeadInquiryWindowMs;
}

function isSameInboundConversation(previous = {}, next = {}) {
  return String(previous.direction || 'inbound').toLowerCase() !== 'outbound'
    && String(next.direction || 'inbound').toLowerCase() !== 'outbound'
    && String(previous.tenant_slug || '') === String(next.tenant_slug || '')
    && String(previous.channel_type || '').toLowerCase() === String(next.channel_type || '').toLowerCase()
    && Boolean(previous.external_conversation_id)
    && String(previous.external_conversation_id) === String(next.external_conversation_id);
}

export function shouldHideGenericLeadInquiry(event = {}, laterEvents = []) {
  if (String(event.direction || 'inbound').toLowerCase() === 'outbound' || !isGenericLeadInquiry(event)) return false;
  return (laterEvents || []).some((next) => isSameInboundConversation(event, next)
    && isShortlyAfter(event.created_at, next.created_at)
    && isSubstantiveInboundFollowUp(next));
}

export function isCustomerInboundEvent(event = {}) {
  if (!event || isInternalOperationalEvent(event)) return false;
  const direction = String(event.direction || '').toLowerCase();
  const senderType = String(event.sender_type || '').toLowerCase();
  return direction === 'inbound' && senderType !== 'system';
}

export function isFollowUpOutboundEvent(event = {}) {
  if (!event || isInternalOperationalEvent(event)) return false;
  const direction = String(event.direction || '').toLowerCase();
  const service = String(event.service || '').toLowerCase().trim();
  return direction === 'outbound' && (service === 'follow_up' || service === 'follow-up');
}
