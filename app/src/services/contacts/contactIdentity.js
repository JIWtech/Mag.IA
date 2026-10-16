import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';

export function contactAvatarKey(channel, externalHandle, tenantId = '') {
  const normChannel = normalizeChannel(channel).type || 'unknown';
  const normHandle = normalizeExternalConversationId(normChannel, externalHandle) || String(externalHandle || '').trim().toLowerCase();
  const tenantPrefix = tenantId ? `${String(tenantId).trim().toLowerCase()}:` : '';
  return `${tenantPrefix}${normChannel}:${normHandle}`;
}

export function normalizeAvatarUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
