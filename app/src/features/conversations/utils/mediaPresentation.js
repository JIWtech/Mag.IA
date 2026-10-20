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
    if (value && value !== media?.fileName && !isTechnicalMediaPlaceholder(value, media)) return normalizeTechnicalMediaPlaceholder(value);
  }
  return '';
}

export function consecutiveImageGallery(messages = [], index = -1) {
  const isVisualMedia = (msg) => {
    const k = String(msg?.media?.kind || msg?.media?.category || '').toLowerCase();
    return ['image', 'video', 'sticker'].includes(k) && Boolean(msg?.media?.url || (msg?.media?.bucket && msg?.media?.storagePath));
  };

  const current = messages[index];
  if (!isVisualMedia(current)) return { items: [], index: 0 };

  const visualItems = [];
  let targetIndex = 0;
  const sender = (msg) => msg.from || (msg.isAi ? 'ai' : msg.isAgent ? 'agent' : 'contact');
  const sameGroup = (msg) => isVisualMedia(msg) && sender(msg) === sender(current);
  let start = index;
  let end = index;
  while (start > 0 && sameGroup(messages[start - 1])) start--;
  while (end + 1 < messages.length && sameGroup(messages[end + 1])) end++;

  for (let i = start; i <= end; i += 1) {
    const msg = messages[i];
    if (isVisualMedia(msg)) {
      if (i === index) {
        targetIndex = visualItems.length;
      }
      const rawKind = String(msg.media.kind || msg.media.category || 'image').toLowerCase();
      const kind = rawKind === 'video' ? 'video' : rawKind === 'sticker' ? 'sticker' : 'image';
      const caption = resolveVisualMediaCaption(msg.media, msg.text);
      visualItems.push({
        id: msg.eventId || `msg-${msg.createdAt || msg.at || i}-${i}`,
        kind,
        src: msg.media.url || '',
        poster: msg.media.thumbnailUrl || undefined,
        alt: caption || (kind === 'video' ? 'Vídeo' : kind === 'sticker' ? 'Figurinha' : 'Imagem'),
        caption,
        senderLabel: msg.senderLabel || (msg.isAi ? 'IA' : msg.isAgent ? 'Atendente' : 'Cliente'),
        formattedTime: msg.formattedTime || '',
        bucket: msg.media.bucket,
        storagePath: msg.media.storagePath,
      });
    }
  }

  return { items: visualItems, index: targetIndex };
}

export function formatProductPrice(cents, currency = 'BRL') {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: /^[A-Z]{3}$/i.test(currency) ? currency : 'BRL' }).format(cents / 100);
  } catch (_) {
    return '';
  }
}
