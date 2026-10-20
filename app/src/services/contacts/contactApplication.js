import { contactAvatarKey, normalizeAvatarUrl } from './contactIdentity.js';

function contactEntryFor(channel, handle, contactIndex, tenantId = '') {
  const scoped = tenantId && contactIndex.get(contactAvatarKey(channel, handle, tenantId));
  const entry = scoped || contactIndex.get(contactAvatarKey(channel, handle)) || null;
  return typeof entry === 'string' ? { avatarUrl: entry, name: null } : entry;
}

export function applyContactDirectory(events = [], contactIndex, tenantId = '') {
  if (!Array.isArray(events) || !contactIndex) return events;
  return events.map((event) => {
    const channel = event.channel_type;
    const handle = event.external_conversation_id || event.contact_handle;
    const scopedTenant = tenantId || event.tenant_id || event.tenant_slug || '';
    const contact = contactEntryFor(channel, handle, contactIndex, scopedTenant);
    return {
      ...event,
      ...(contact?.avatarUrl ? { avatar_url: contact.avatarUrl } : {}),
      ...(contact?.name ? { contact_name_canonical: contact.name } : {}),
    };
  });
}

export function applyContactAvatars(events = [], avatarIndex, tenantId = '') {
  return applyContactDirectory(events, avatarIndex, tenantId);
}

export function applyContactAvatarsToBroadcastContacts(contacts = [], contactIndex, tenantId = '') {
  if (!Array.isArray(contacts) || !contactIndex) return contacts;
  return contacts.map((contact) => {
    const channel = contact.channel_type || contact.channelType;
    const handle = contact.external_conversation_id || contact.externalConversationId;
    const scopedTenant = tenantId || contact.tenant_id || contact.tenantId || '';
    const resolved = contactEntryFor(channel, handle, contactIndex, scopedTenant);
    return {
      ...contact,
      avatarUrl: resolved?.avatarUrl || null,
      ...(resolved?.name ? { name: resolved.name } : {}),
    };
  });
}

export function resolveContactAvatarState({ currentFailed = false, prevUrl = null, nextUrl = null } = {}) {
  const normNext = normalizeAvatarUrl(nextUrl);
  const normPrev = normalizeAvatarUrl(prevUrl);
  const failed = normNext !== normPrev ? false : currentFailed;
  return {
    failed,
    url: failed ? null : normNext,
    shouldRenderImage: Boolean(normNext && !failed),
  };
}
