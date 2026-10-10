import { asObject } from '../../utils/asObject.js';
import { isExplicitOutboundMedia } from './mediaDirection.js';
import { normalizeMedia } from './mediaNormalization.js';
import { isTransientStorageError } from './storageErrors.js';

export const SIGNED_URL_EXPIRES_IN = 86400;
const MEDIA_SIGNING_CONCURRENCY = 4;
const SIGNED_URL_RETRY_DELAY_MS = 300;
const mediaObjectUrlCache = new Map();
const mediaUrlRequestCache = new Map();

export function clearMediaUrlCache() {
  mediaObjectUrlCache.clear();
  mediaUrlRequestCache.clear();
}

export function getMediaUrlFromCache(key) {
  const cached = mediaObjectUrlCache.get(key);
  if (!cached) return null;
  return typeof cached === 'string' ? cached : cached.url;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      if (typeof blob?.arrayBuffer === 'function') {
        blob.arrayBuffer().then((buf) => {
          const base64 = Buffer.from(buf).toString('base64');
          resolve(`data:${blob.type || 'image/jpeg'};base64,${base64}`);
        }).catch(reject);
        return;
      }
      resolve(`data:${blob?.type || 'image/jpeg'};base64,mockdata`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

function waitForMediaRetry() {
  return new Promise((resolve) => setTimeout(resolve, SIGNED_URL_RETRY_DELAY_MS));
}

async function createSignedUrlWithRetry(storageBucket, storagePath) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await storageBucket.createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN);
      if (!error && data?.signedUrl) return data.signedUrl;
      lastError = error;
    } catch (error) {
      lastError = error;
    }

    if (attempt === 0 && isTransientStorageError(lastError)) {
      await waitForMediaRetry();
      continue;
    }
    break;
  }

  if (lastError) console.warn('createSignedUrl error:', lastError?.message || lastError);
  return '';
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function resolveStoredMediaUrl(media, supabase) {
  if (!supabase?.storage?.from) return '';
  const storageBucket = supabase.storage.from(media.bucket);
  let resolvedUrl = '';

  // 1. Preferir createSignedUrl diretamente do Storage (sem baixar Blob nem usar FileReader)
  // Seguro para bucket privado e diretamente utilizável por <img>, <audio>, <video>
  if (media.encoding !== 'base64' && typeof storageBucket?.createSignedUrl === 'function') {
    resolvedUrl = await createSignedUrlWithRetry(storageBucket, media.storagePath);
  }

  // 2. Fallback de download se createSignedUrl não estiver disponível ou falhar
  if (!resolvedUrl && typeof storageBucket?.download === 'function') {
    try {
      const { data, error } = await storageBucket.download(media.storagePath);
      if (error) {
        console.warn('Media download fallback:', error.message);
        return '';
      }
      if (data?.size) {
        if (media.encoding === 'base64') {
          const base64 = (await data.text()).trim();
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            console.warn('Media download fallback: conteúdo Base64 inválido.');
            return '';
          }
          resolvedUrl = `data:${media.mimeType || 'application/octet-stream'};base64,${base64}`;
        } else {
          if (media.kind === 'image' && data.type && !String(data.type).startsWith('image/')) {
            console.warn('Media download fallback: arquivo não é uma imagem válida.', data.type || 'tipo ausente');
            return '';
          }
          resolvedUrl = media.kind === 'image'
            ? await blobToDataUrl(data)
            : (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(data) : '');
        }
      }
    } catch (err) {
      console.warn('Media download fallback error:', err?.message || err);
    }
  }

  return resolvedUrl;
}

export async function enrichMediaUrls(events, supabase) {
  const targets = new Map();

  for (const event of events) {
    const payload = asObject(event?.raw_payload);
    const media = normalizeMedia(payload, event) || asObject(payload.media);
    if (media.status !== 'stored' || !media.bucket || !media.storagePath || media.url) continue;
    if (String(event?.direction || '').toLowerCase() === 'outbound'
      && !isExplicitOutboundMedia(media, payload, event)) continue;
    targets.set(`${media.bucket}:${media.storagePath}`, media);
  }

  if (!targets.size) return events;

  const mediaUrls = new Map();
  await mapWithConcurrency([...targets.entries()], MEDIA_SIGNING_CONCURRENCY, async ([key, media]) => {
    const cached = mediaObjectUrlCache.get(key);
    const cachedUrl = typeof cached === 'string'
      ? cached
      : (cached && cached.expiresAt > Date.now() ? cached.url : null);
    if (cachedUrl) {
      mediaUrls.set(key, cachedUrl);
      return;
    }

    let request = mediaUrlRequestCache.get(key);
    if (!request) {
      request = resolveStoredMediaUrl(media, supabase);
      mediaUrlRequestCache.set(key, request);
    }
    let resolvedUrl = '';
    try {
      resolvedUrl = await request;
    } finally {
      if (mediaUrlRequestCache.get(key) === request) mediaUrlRequestCache.delete(key);
    }

    if (resolvedUrl) {
      const expiresAt = Date.now() + (SIGNED_URL_EXPIRES_IN - 300) * 1000;
      mediaObjectUrlCache.set(key, { url: resolvedUrl, expiresAt });
      mediaUrls.set(key, resolvedUrl);
    }
  });

  return events.map((event) => {
    const payload = asObject(event?.raw_payload);
    const media = normalizeMedia(payload, event) || asObject(payload.media);
    const url = mediaUrls.get(`${media.bucket}:${media.storagePath}`);
    if (!url) return event;
    const updatedPayload = {
      ...payload,
      media: { ...media, url },
      ...(payload.magia_operator ? {
        magia_operator: {
          ...payload.magia_operator,
          media: {
            ...asObject(payload.magia_operator.media),
            url,
          },
        },
      } : {}),
    };
    return { ...event, raw_payload: updatedPayload };
  });
}

export function invalidateMediaUrl(key) {
  mediaObjectUrlCache.delete(key);
  mediaUrlRequestCache.delete(key);
}
