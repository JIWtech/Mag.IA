import { contactAvatarKey, normalizeAvatarUrl } from './contactIdentity.js';
import { isUsefulContactName } from './contactNames.js';
import { conversationPhoneFallback } from './contactPhones.js';

export function applyContactUpdateToConversations(conversations = [], contact = {}, tenantId = '') {
  if (!Array.isArray(conversations) || !contact?.external_handle) return conversations;
  const channel = contact.source_channel || 'whatsapp';
  const targetKey = contactAvatarKey(channel, contact.external_handle, tenantId || contact.tenant_id || '');
  const nextName = String(contact.name || '').trim();
  const nextAvatarUrl = normalizeAvatarUrl(contact.avatar_url || contact.avatarUrl);
  let changed = false;
  const next = conversations.map((conversation) => {
    const conversationKey = contactAvatarKey(
      conversation.channelType || conversation.channel,
      conversation.externalConversationId || conversation.normalizedExternalId,
      tenantId || contact.tenant_id || '',
    );
    if (conversationKey !== targetKey) return conversation;
    const contactName = isUsefulContactName(nextName, conversationPhoneFallback({
      channel_type: conversation.channelType,
      external_conversation_id: conversation.externalConversationId,
    })) ? nextName : conversation.contact;
    if (contactName === conversation.contact && (!nextAvatarUrl || nextAvatarUrl === conversation.avatarUrl)) return conversation;
    changed = true;
    return {
      ...conversation,
      contact: contactName,
      contactNameIsTrusted: contactName === nextName ? true : conversation.contactNameIsTrusted,
      contactNameIsCanonical: contactName === nextName ? true : conversation.contactNameIsCanonical,
      avatarUrl: nextAvatarUrl || conversation.avatarUrl || null,
    };
  });
  return changed ? next : conversations;
}
