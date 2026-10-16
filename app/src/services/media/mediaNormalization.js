import { asObject } from '../../utils/asObject.js';
import { REAL_MEDIA_KINDS, isMediaPlaceholderForKind } from '../../utils/audioUtils.js';
import { isExplicitOutboundMedia } from './mediaDirection.js';
import { productSnapshotMedia } from './productSnapshot.js';

export function isUsableBrowserUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes('whatsapp.net') || lower.includes('.enc')) return false;
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('blob:');
}

export function extensionForKind(kind, mimeType = '', fileName = '') {
  const fromName = String(fileName || '').match(/\.([a-z0-9]{1,12})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const byMime = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/webm': 'webm',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/3gpp': '3gp',
    'application/pdf': 'pdf',
  };
  if (byMime[mime]) return byMime[mime];
  if (kind === 'image') return 'jpg';
  if (kind === 'audio') return 'ogg';
  if (kind === 'video') return 'mp4';
  if (kind === 'sticker') return 'webp';
  if (kind === 'document') return 'pdf';
  return 'bin';
}

export function unwrapWhatsAppMessage(raw = {}) {
  let message = raw?.data?.message || raw?.message || raw || {};
  for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    if (message?.[key]?.message) message = message[key].message;
  }
  return message;
}

function deriveWhatsAppStorage(event, payload, kind, mimeType = '', fileName = '') {
  const messageId = event?.external_message_id || payload?.key?.id || payload?.external_message_id || payload?.message_id;
  const convId = event?.external_conversation_id || payload?.external_conversation_id || payload?.key?.remoteJid;
  const tenant = event?.tenant_slug || event?.tenantId || payload?.tenant_slug || '';
  if (!messageId || !convId || !tenant) return null;
  const cleanChat = String(convId).replace(/@/g, '_');
  const safeMessageId = String(messageId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = extensionForKind(kind, mimeType, fileName);
  return {
    bucket: 'channel-media',
    storagePath: `${tenant}/whatsapp/${cleanChat}/${safeMessageId}.${ext}`,
  };
}

export function normalizeMedia(rawPayload, event = null) {
  const payload = asObject(rawPayload);
  const isOutboundEvent = String(event?.direction || '').toLowerCase() === 'outbound';

  // 1. Rejeição explícita de mensagens de texto puro (evita falso-positivo de "Anexo recebido")
  const messageType = String(payload.messageType || payload.data?.messageType || '').toLowerCase();
  const operatorCategory = String(payload.magia_operator?.media?.category || '').toLowerCase();
  const magiaNormalizedCategory = String(payload.magia_normalized?.media?.category || '').toLowerCase();
  const directCategory = String(payload.media?.category || '').toLowerCase();
  const directKind = String(payload.media?.kind || '').toLowerCase();

  if (
    operatorCategory === 'text'
    || magiaNormalizedCategory === 'text'
    || directCategory === 'text'
    || directKind === 'text'
    || messageType === 'conversation'
    || messageType === 'extendedtextmessage'
  ) {
    const storedMedia = asObject(payload.media);
    const storedKind = String(storedMedia.kind || storedMedia.category || '').toLowerCase();
    if (storedMedia.status !== 'stored' || !storedMedia.storagePath || !REAL_MEDIA_KINDS.has(storedKind)) {
      return null;
    }
  }

  const operatorMedia = asObject(payload.magia_operator?.media);
  const normalized = asObject(payload.media);
  const evolutionMessage = asObject(unwrapWhatsAppMessage(payload));
  const telegramMessage = asObject(payload.telegram_update).message || {};

  // Hotfix12 product contracts. product_snapshot is produced for a manual
  // WhatsApp catalog send; catalog_referral is the deliberately minimal inbound
  // reference. Neither falls back to an internal inventory price or image.
  const snapshot = asObject(payload.product_snapshot || normalized.product_snapshot);
  const catalogReferral = asObject(payload.catalog_referral || payload.referencedProduct || evolutionMessage.contextInfo?.referencedProduct);
  const directProduct = asObject(evolutionMessage.productMessage?.product || evolutionMessage.productMessage?.productSnapshot || evolutionMessage.productMessage);
  const cachedCatalogProduct = asObject(event?._catalogProduct);
  const product = productSnapshotMedia(snapshot)
    || productSnapshotMedia(cachedCatalogProduct, catalogReferral)
    || (!isOutboundEvent ? productSnapshotMedia(directProduct, catalogReferral) : null)
    || (!isOutboundEvent ? productSnapshotMedia(catalogReferral) : null);
  if (product) return product;

  // 2. Mídia de operador Mag.IA / NORIA
  if (operatorMedia.category && operatorMedia.category !== 'text') {
    const kindMap = {
      image: 'image',
      photo: 'image',
      audio: 'audio',
      ptt: 'audio',
      video: 'video',
      document: 'document',
      product: 'product',
      sticker: 'sticker',
    };
    const kind = kindMap[operatorMedia.category] || operatorMedia.category;
    if (REAL_MEDIA_KINDS.has(kind)) {
      return {
        kind,
        category: operatorMedia.category,
        caption: operatorMedia.caption || '',
        url: isUsableBrowserUrl(operatorMedia.url) ? operatorMedia.url : '',
        fileName: operatorMedia.fileName || '',
        mimeType: operatorMedia.mimetype || '',
        size: Number(operatorMedia.fileSize || operatorMedia.size || 0),
        duration: Number(operatorMedia.seconds || 0),
      };
    }
  }

  // 3. Mídia normalizada padrão (armazenada em Supabase Storage ou canais externos)
  if (normalized.kind || normalized.category) {
    const rawKind = normalized.kind || normalized.category;
    const kind = String(rawKind).toLowerCase();
    // Uma resposta textual outbound antiga pode ter copiado `raw_payload.media`
    // do inbound. Ela só pode renderizar mídia direta quando o payload declara
    // que o arquivo pertence ao próprio evento outbound.
    if (REAL_MEDIA_KINDS.has(kind) && (!isOutboundEvent || isExplicitOutboundMedia(normalized, payload, event))) {
      let bucket = normalized.bucket || '';
      let storagePath = normalized.storagePath || '';
      let status = normalized.status || '';

      if ((!storagePath || !bucket) && !isOutboundEvent) {
        const derived = deriveWhatsAppStorage(event, payload, kind, normalized.mimeType || normalized.mime_type, normalized.fileName || normalized.file_name);
        if (derived) {
          bucket = bucket || derived.bucket;
          storagePath = storagePath || derived.storagePath;
          if (!status) status = 'stored';
        }
      }

      const rawUrl = normalized.url || '';
      const url = isUsableBrowserUrl(rawUrl) ? rawUrl : '';
      const rawThumb = normalized.thumbnailUrl || normalized.thumbnail_url || '';
      const thumbnailUrl = isUsableBrowserUrl(rawThumb) ? rawThumb : '';

      return {
        kind,
        category: normalized.category || kind,
        status: status || (storagePath ? 'stored' : ''),
        verified: normalized.verified === true,
        origin: normalized.origin || normalized.source || '',
        loadState: normalized.loadState || '',
        bucket,
        storagePath,
        caption: normalized.caption || '',
        url,
        thumbnailUrl,
        fileName: normalized.fileName || normalized.file_name || '',
        mimeType: normalized.mimeType || normalized.mime_type || '',
        encoding: normalized.encoding || '',
        size: Number(normalized.size || normalized.file_size || 0),
        duration: Number(normalized.duration || 0),
      };
    }
  }

  // 4. Mídia Evolution API (WhatsApp)
  // Eventos outbound do workflow podem reter o envelope bruto do inbound que os
  // originou. Esse envelope descreve a mensagem do cliente, não uma mídia que a
  // IA tenha enviado. Para outbound, aceite somente mídia declarada nos blocos
  // normalizados acima (media/magia_operator).
  if (!isOutboundEvent && evolutionMessage.imageMessage) {
    const img = evolutionMessage.imageMessage;
    const mimeType = img.mimetype || 'image/jpeg';
    const derived = deriveWhatsAppStorage(event, payload, 'image', mimeType);
    return {
      kind: 'image',
      category: 'image',
      caption: img.caption || '',
      mimeType,
      url: isUsableBrowserUrl(img.url) ? img.url : '',
      bucket: derived?.bucket || '',
      storagePath: derived?.storagePath || '',
      status: derived ? 'stored' : '',
      size: Number(img.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.audioMessage) {
    const aud = evolutionMessage.audioMessage;
    const mimeType = aud.mimetype || 'audio/ogg';
    const derived = deriveWhatsAppStorage(event, payload, 'audio', mimeType);
    return {
      kind: 'audio',
      category: 'audio',
      duration: Number(aud.seconds || 0),
      mimeType,
      url: isUsableBrowserUrl(aud.url) ? aud.url : '',
      bucket: derived?.bucket || '',
      storagePath: derived?.storagePath || '',
      status: derived ? 'stored' : '',
      size: Number(aud.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.videoMessage) {
    const vid = evolutionMessage.videoMessage;
    const mimeType = vid.mimetype || 'video/mp4';
    const derived = deriveWhatsAppStorage(event, payload, 'video', mimeType);
    return {
      kind: 'video',
      category: 'video',
      caption: vid.caption || '',
      duration: Number(vid.seconds || 0),
      mimeType,
      url: isUsableBrowserUrl(vid.url) ? vid.url : '',
      bucket: derived?.bucket || '',
      storagePath: derived?.storagePath || '',
      status: derived ? 'stored' : '',
      size: Number(vid.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.documentMessage) {
    const doc = evolutionMessage.documentMessage;
    const fileName = doc.fileName || 'Documento';
    const mimeType = doc.mimetype || 'application/octet-stream';
    const derived = deriveWhatsAppStorage(event, payload, 'document', mimeType, fileName);
    return {
      kind: 'document',
      category: 'document',
      fileName,
      mimeType,
      size: Number(doc.fileLength || 0),
      url: isUsableBrowserUrl(doc.url) ? doc.url : '',
      bucket: derived?.bucket || '',
      storagePath: derived?.storagePath || '',
      status: derived ? 'stored' : '',
    };
  }
  if (!isOutboundEvent && evolutionMessage.stickerMessage) {
    const stk = evolutionMessage.stickerMessage;
    const mimeType = stk.mimetype || 'image/webp';
    const derived = deriveWhatsAppStorage(event, payload, 'sticker', mimeType);
    return {
      kind: 'sticker',
      category: 'sticker',
      mimeType,
      url: isUsableBrowserUrl(stk.url) ? stk.url : '',
      bucket: derived?.bucket || '',
      storagePath: derived?.storagePath || '',
      status: derived ? 'stored' : '',
      size: Number(stk.fileLength || 0),
    };
  }

  // 5. Mídia Telegram
  if (!isOutboundEvent && Array.isArray(telegramMessage.photo) && telegramMessage.photo.length) {
    const photo = telegramMessage.photo[telegramMessage.photo.length - 1] || {};
    return { kind: 'image', caption: telegramMessage.caption || '', size: Number(photo.file_size || 0) };
  }
  if (!isOutboundEvent && telegramMessage.voice) return { kind: 'audio', caption: telegramMessage.caption || '', duration: Number(telegramMessage.voice.duration || 0), mimeType: telegramMessage.voice.mime_type || '', size: Number(telegramMessage.voice.file_size || 0) };
  if (!isOutboundEvent && telegramMessage.audio) return { kind: 'audio', caption: telegramMessage.caption || '', duration: Number(telegramMessage.audio.duration || 0), fileName: telegramMessage.audio.file_name || '', mimeType: telegramMessage.audio.mime_type || '', size: Number(telegramMessage.audio.file_size || 0) };
  if (!isOutboundEvent && (telegramMessage.video || telegramMessage.video_note || telegramMessage.animation)) {
    const video = telegramMessage.video || telegramMessage.video_note || telegramMessage.animation;
    return { kind: 'video', caption: telegramMessage.caption || '', duration: Number(video.duration || 0), fileName: video.file_name || '', mimeType: video.mime_type || '', size: Number(video.file_size || 0) };
  }
  if (!isOutboundEvent && telegramMessage.document) return { kind: 'document', caption: telegramMessage.caption || '', fileName: telegramMessage.document.file_name || '', mimeType: telegramMessage.document.mime_type || '', size: Number(telegramMessage.document.file_size || 0) };

  // 6. Mídia WhatsApp armazenada em Storage cujo raw_payload.media foi sobrescrito por patch posterior
  if (!isOutboundEvent && (!normalized.kind && !normalized.category)) {
    const text = String(event?.message_text || '').trim();
    let detectedKind = null;
    let detectedMime = '';

    if (isMediaPlaceholderForKind(text, 'image') || isMediaPlaceholderForKind(text, 'album')
      || (payload.sales_media && (
        Array.isArray(payload.sales_media)
          ? payload.sales_media.some((m) => m.kind === 'vehicle_photo' && m.readable !== false)
          : payload.sales_media.kind === 'vehicle_photo' && payload.sales_media.readable !== false
      ))) {
      detectedKind = 'image';
      detectedMime = 'image/jpeg';
    } else if (isMediaPlaceholderForKind(text, 'video')) {
      detectedKind = 'video';
      detectedMime = 'video/mp4';
    } else if (isMediaPlaceholderForKind(text, 'sticker')) {
      detectedKind = 'sticker';
      detectedMime = 'image/webp';
    } else if (isMediaPlaceholderForKind(text, 'document')) {
      detectedKind = 'document';
      detectedMime = 'application/pdf';
    } else if (isMediaPlaceholderForKind(text, 'audio') || Boolean(payload.audio_transcriptions || payload.audio_processing)) {
      detectedKind = 'audio';
      detectedMime = 'audio/ogg';
    }

    if (detectedKind) {
      const derived = deriveWhatsAppStorage(event, payload, detectedKind, detectedMime);
      if (derived) {
        return {
          kind: detectedKind,
          category: detectedKind,
          status: 'stored',
          bucket: derived.bucket,
          storagePath: derived.storagePath,
          url: '',
          caption: '',
          mimeType: detectedMime,
        };
      }
    }
  }

  return null;
}

export function hasStoredMediaNeedingUrl(event) {
  if (!event) return false;
  const payload = asObject(event?.raw_payload);
  const media = normalizeMedia(payload, event) || asObject(payload.media);
  const kind = String(media.kind || media.category || '').toLowerCase();
  if (kind === 'text' || kind === 'conversation' || kind === 'none') return false;
  if (!REAL_MEDIA_KINDS.has(kind)) return false;
  if (String(event?.direction || '').toLowerCase() === 'outbound'
    && !isExplicitOutboundMedia(media, payload, event)) return false;
  return media.status === 'stored' && Boolean(media.bucket) && Boolean(media.storagePath) && !isUsableBrowserUrl(media.url);
}
