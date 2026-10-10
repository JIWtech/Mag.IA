export function getTrustedContactName(event = {}) {
  if (String(event.direction || '').toLowerCase() !== 'inbound') return '';
  if (String(event.sender_type || '').toLowerCase() !== 'contact') return '';
  return String(event.contact_name || '').trim();
}

export function isUsefulContactName(value, phone = '') {
  const name = String(value || '').trim();
  if (!name || /^(?:unknown|undefined|null|n\/?a)$/i.test(name)) return false;
  if (/^[\s._\-–—]+$/u.test(name)) return false;
  if (
    /^\+?\d+(?:@(s\.whatsapp\.net|c\.us))?$/i.test(name)
    || /@(s\.whatsapp\.net|c\.us|g\.us|lid|broadcast)$/i.test(name)
  ) {
    return false;
  }

  const digits = name.replace(/\D/g, '');
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (/^\d+$/.test(name) || (normalizedPhone && digits === normalizedPhone)) return false;
  // WhatsApp permits intentional emoji-only push names. Keep them as display
  // names, while markers such as "." and "-" remain invalid above.
  return /\p{L}|\p{Extended_Pictographic}/u.test(name);
}

export function getUsefulTrustedContactName(event = {}) {
  const name = getTrustedContactName(event);
  const phone = event.contact_handle || event.external_conversation_id || '';
  return isUsefulContactName(name, phone) ? name : '';
}
