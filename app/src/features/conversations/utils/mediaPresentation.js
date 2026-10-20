import {
  isTechnicalMediaPlaceholder,
  normalizeTechnicalMediaPlaceholder,
} from '../../../utils/audioUtils.js';

export function resolveVisualMediaCaption(media, messageText) {
  const kind = String(media?.kind || media?.category || '').toLowerCase();
  if (!['image', 'video', 'sticker'].includes(kind)) return '';
  const candidates = [media?.caption, messageText];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && !isTechnicalMediaPlaceholder(value, media)) return normalizeTechnicalMediaPlaceholder(value);
  }
  return '';
}

export function consecutiveImageGallery(messages = [], index = -1) {
  const isGalleryImage = (message) => ['image', 'sticker'].includes(String(message?.media?.kind || message?.media?.category || '').toLowerCase()) && Boolean(message?.media?.url);
  const senderKey = (message) => message?.isAi ? 'ai' : message?.isAgent ? 'agent' : 'contact';
  const current = messages[index];
  if (!isGalleryImage(current)) return { items: [], index: 0 };
  const sender = senderKey(current);
  let start = index;
  let end = index;
  while (start > 0 && isGalleryImage(messages[start - 1]) && senderKey(messages[start - 1]) === sender) start -= 1;
  while (end < messages.length - 1 && isGalleryImage(messages[end + 1]) && senderKey(messages[end + 1]) === sender) end += 1;
  const items = messages.slice(start, end + 1).map(message => ({
    src: message.media.url,
    alt: resolveVisualMediaCaption(message.media, message.text) || (String(message.media.kind || '').toLowerCase() === 'sticker' ? 'Figurinha' : 'Imagem'),
  }));
  return { items, index: index - start };
}

export function formatProductPrice(cents, currency = 'BRL') {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: /^[A-Z]{3}$/i.test(currency) ? currency : 'BRL' }).format(cents / 100);
  } catch (_) {
    return '';
  }
}
