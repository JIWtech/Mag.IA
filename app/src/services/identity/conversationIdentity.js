export function normalizeChannel(value) {
  const type = String(value || 'telegram').toLowerCase();
  const labels = {
    telegram: 'Telegram',
    instagram: 'Instagram',
    instagram_direct: 'Instagram',
    whatsapp: 'WhatsApp',
    webchat: 'WebChat',
    manual: 'Manual',
  };
  return { type, label: labels[type] || type.charAt(0).toUpperCase() + type.slice(1) };
}

function normalizeBrazilianPhoneDigits(digits) {
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length === 12 && ['6', '7', '8', '9'].includes(digits[4])) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    return `55${ddd}9${rest}`;
  }
  return digits;
}

export function normalizeExternalConversationId(channelType, externalId, fallbackHandle = '') {
  const normalizedChannel = normalizeChannel(channelType).type || 'unknown';
  const raw = String(externalId || fallbackHandle || '').trim();
  if (!raw) return '';

  if (normalizedChannel === 'whatsapp') {
    const lower = raw.toLowerCase();
    if (lower.endsWith('@s.whatsapp.net')) {
      const cleanDigits = lower.replace('@s.whatsapp.net', '').split(':')[0].replace(/\D/g, '');
      const normalizedDigits = normalizeBrazilianPhoneDigits(cleanDigits);
      return normalizedDigits ? `${normalizedDigits}@s.whatsapp.net` : lower;
    }
    if (lower.endsWith('@g.us') || lower.endsWith('@broadcast') || lower.endsWith('@lid')) {
      return lower;
    }
    const cleanDigits = raw.split(':')[0].replace(/\D/g, '');
    if (cleanDigits.length >= 10 && cleanDigits.length <= 15) {
      const normalizedDigits = normalizeBrazilianPhoneDigits(cleanDigits);
      return `${normalizedDigits}@s.whatsapp.net`;
    }
    return lower;
  }

  return raw.toLowerCase();
}

export function canonicalConversationKey(channelType, externalConversationId, fallbackId = '', tenantSlug = '') {
  const normalizedChannel = normalizeChannel(channelType).type || 'unknown';
  const canonicalId = normalizeExternalConversationId(channelType, externalConversationId, fallbackId) || String(fallbackId || 'unknown').trim();
  const slug = String(tenantSlug || '').trim().toLowerCase();
  return `${slug ? `${slug}:` : ''}${normalizedChannel}::${canonicalId || 'unknown'}`;
}
