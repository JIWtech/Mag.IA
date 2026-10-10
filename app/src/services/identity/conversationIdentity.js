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

export function normalizeExternalConversationId(channelType, externalId, fallbackHandle = '') {
  const normalizedChannel = normalizeChannel(channelType).type || 'unknown';
  const raw = String(externalId || fallbackHandle || '').trim();
  if (!raw) return '';

  if (normalizedChannel === 'whatsapp') {
    const lower = raw.toLowerCase();
    if (lower.endsWith('@s.whatsapp.net')) {
      const digits = lower.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      return digits ? `${digits}@s.whatsapp.net` : lower;
    }
    if (lower.endsWith('@g.us') || lower.endsWith('@broadcast') || lower.endsWith('@lid')) {
      return lower;
    }
    const cleanDigits = raw.replace(/\D/g, '');
    if (cleanDigits.length >= 10 && cleanDigits.length <= 15) {
      return `${cleanDigits}@s.whatsapp.net`;
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
