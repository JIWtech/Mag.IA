import { asObject } from '../../utils/asObject.js';
import { normalizeAvatarUrl } from './contactIdentity.js';

export function extractPayloadAvatar(event) {
  if (!event) return null;
  const payload = asObject(event.raw_payload);
  const contactAvatar = asObject(payload.contact_avatar);
  const candidate = (
    contactAvatar.avatarUrl
    || contactAvatar.avatar_url
    || payload.avatarUrl
    || payload.avatar_url
    || payload.profilePictureUrl
    || null
  );
  return normalizeAvatarUrl(candidate);
}

export function extractAvatarUrlFromEvent(event) {
  if (!event) return null;
  return extractPayloadAvatar(event) || normalizeAvatarUrl(event.avatar_url) || null;
}
