import { contactAvatarKey, normalizeAvatarUrl } from './contactIdentity.js';

export function buildContactDirectory(contacts = [], tenantId = '') {
  const index = new Map();
  const targetTenant = String(tenantId || '').trim();

  for (const contact of contacts) {
    const contactTenant = String(contact?.tenant_id || '').trim();
    if (targetTenant && contactTenant && contactTenant !== targetTenant) {
      continue;
    }
    if (!contact?.external_handle) continue;
    const entry = {
      id: contact?.id || null,
      name: String(contact?.name || '').trim() || null,
      avatarUrl: normalizeAvatarUrl(contact?.avatar_url || contact?.avatarUrl),
    };

    const scopedTenant = targetTenant || contactTenant;
    if (scopedTenant) {
      index.set(contactAvatarKey(contact.source_channel, contact.external_handle, scopedTenant), entry);
    }
    index.set(contactAvatarKey(contact.source_channel, contact.external_handle), entry);
  }
  return index;
}

export function buildContactAvatarIndex(contacts = [], tenantId = '') {
  const directory = buildContactDirectory(contacts, tenantId);
  const index = new Map();
  for (const [key, contact] of directory) {
    if (contact?.avatarUrl) index.set(key, contact.avatarUrl);
  }
  return index;
}
