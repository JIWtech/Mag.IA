import { getUsefulTrustedContactName, isUsefulContactName } from './contactNames.js';
import { conversationPhoneFallback, formatWhatsAppPhone } from './contactPhones.js';

export function resolveConversationDisplayName(event = {}, fallbackName = '') {
  const canonical = String(
    event.contact_name_canonical
    || event.contact?.name
    || (event.contact && typeof event.contact === 'string' && event.contact !== 'Cliente' && !event.contact.includes('@') ? event.contact : '')
    || ''
  ).trim();
  const phone = conversationPhoneFallback(event);
  const rawId = String(event.external_conversation_id || event.externalConversationId || event.contact_handle || '').trim();
  const isLid = /@lid$/i.test(rawId) || /@lid$/i.test(String(event.contact || ''));
  const defaultFallback = isLid ? 'Contato WhatsApp' : (fallbackName || 'Contato WhatsApp');
  const usefulCanonical = isUsefulContactName(canonical, phone) ? canonical : '';
  const usefulTrusted = isUsefulContactName(getUsefulTrustedContactName(event), phone) ? getUsefulTrustedContactName(event) : '';
  const formattedPhone = (!isLid && phone) ? formatWhatsAppPhone(phone) : '';
  return usefulCanonical || usefulTrusted || formattedPhone || defaultFallback;
}
