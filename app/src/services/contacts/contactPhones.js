import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';

export function conversationPhoneFallback(event = {}) {
  const channel = normalizeChannel(event.channel_type || event.channel).type;
  if (channel !== 'whatsapp') return '';
  const candidates = [
    event.external_conversation_id,
    event.externalConversationId,
    event.contact_handle,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    if (/@lid$/i.test(raw)) continue; // @lid nunca é número de telefone
    const normalized = normalizeExternalConversationId('whatsapp', raw, event.contact_handle);
    if (/@lid$/i.test(normalized)) continue;
    const digits = String(normalized || raw)
      .replace(/@(s\.whatsapp\.net|c\.us)$/i, '')
      .split(':')[0]
      .replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }
  return '';
}

export function formatWhatsAppPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const area = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    const split = subscriber.length === 9 ? 5 : 4;
    return `+55 (${area}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
  }
  return `+${digits}`;
}
