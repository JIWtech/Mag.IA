import { asObject } from '../../utils/asObject.js';
import { getAuthClient } from '../auth/authService.js';
import { hasStoredMediaNeedingUrl } from './mediaNormalization.js';
import { enrichMediaUrls, invalidateMediaUrl } from './mediaUrlService.js';

export async function enrichSingleMediaEvent(event, client, { force = false } = {}) {
  if (!event) return event;
  const payload = asObject(event.raw_payload);
  const media = asObject(payload.media);
  const candidate = force && media.status === 'stored' && media.bucket && media.storagePath
    ? { ...event, raw_payload: { ...payload, media: { ...media, url: '' } } }
    : event;

  if (!hasStoredMediaNeedingUrl(candidate)) return event;
  if (force && media.bucket && media.storagePath) {
    const key = `${media.bucket}:${media.storagePath}`;
    invalidateMediaUrl(key);
  }
  const supabase = client || getAuthClient();
  if (!supabase) return event;
  const [enriched] = await enrichMediaUrls([candidate], supabase);
  return enriched || event;
}
