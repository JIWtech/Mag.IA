import { asObject } from '../../utils/asObject.js';
import { REAL_MEDIA_KINDS, isMediaPlaceholderForKind } from '../../utils/audioUtils.js';
import { isExplicitOutboundMedia } from './mediaDirection.js';
import { productSnapshotMedia } from './productSnapshot.js';

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
  const evolutionMessage = asObject(payload.data?.message || payload.message);
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
        url: operatorMedia.url || '',
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
      return {
        kind,
        category: normalized.category || kind,
        status: normalized.status || '',
        loadState: normalized.loadState || '',
        bucket: normalized.bucket || '',
        storagePath: normalized.storagePath || '',
        caption: normalized.caption || '',
        url: normalized.url || '',
        thumbnailUrl: normalized.thumbnailUrl || normalized.thumbnail_url || '',
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
    return { kind: 'image', caption: img.caption || '', mimeType: img.mimetype || 'image/jpeg', url: img.url || '' };
  }
  if (!isOutboundEvent && evolutionMessage.audioMessage) {
    const aud = evolutionMessage.audioMessage;
    return { kind: 'audio', duration: Number(aud.seconds || 0), mimeType: aud.mimetype || 'audio/ogg', url: aud.url || '' };
  }
  if (!isOutboundEvent && evolutionMessage.videoMessage) {
    const vid = evolutionMessage.videoMessage;
    return { kind: 'video', caption: vid.caption || '', duration: Number(vid.seconds || 0), mimeType: vid.mimetype || 'video/mp4', url: vid.url || '' };
  }
  if (!isOutboundEvent && evolutionMessage.documentMessage) {
    const doc = evolutionMessage.documentMessage;
    return { kind: 'document', fileName: doc.fileName || 'Documento', mimeType: doc.mimetype || 'application/octet-stream', size: Number(doc.fileLength || 0), url: doc.url || '' };
  }
  if (!isOutboundEvent && evolutionMessage.stickerMessage) {
    const stk = evolutionMessage.stickerMessage;
    return { kind: 'sticker', mimeType: stk.mimetype || 'image/webp', url: stk.url || '' };
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
    const isImagePlaceholder = isMediaPlaceholderForKind(event?.message_text, 'image')
      || (payload.sales_media && (
        Array.isArray(payload.sales_media)
          ? payload.sales_media.some((m) => m.kind === 'vehicle_photo' && m.readable !== false)
          : payload.sales_media.kind === 'vehicle_photo' && payload.sales_media.readable !== false
      ));
    const isAudioPlaceholder = isMediaPlaceholderForKind(event?.message_text, 'audio')
      || Boolean(payload.audio_transcriptions || payload.audio_processing);

    const messageId = event?.external_message_id || payload?.key?.id || payload?.external_message_id || payload?.message_id;
    const convId = event?.external_conversation_id || payload?.external_conversation_id || payload?.key?.remoteJid;

    if ((isImagePlaceholder || isAudioPlaceholder) && messageId && convId) {
      const tenant = event?.tenant_slug || event?.tenantId || payload?.tenant_slug || '';
      if (tenant) {
        const cleanChat = String(convId).replace(/@/g, '_');
        const ext = isImagePlaceholder ? 'jpg' : 'ogg';
        const kind = isImagePlaceholder ? 'image' : 'audio';
        return {
          kind,
          category: kind,
          status: 'stored',
          bucket: 'channel-media',
          storagePath: `${tenant}/whatsapp/${cleanChat}/${messageId}.${ext}`,
          url: '',
          caption: '',
          mimeType: isImagePlaceholder ? 'image/jpeg' : 'audio/ogg',
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
  if (kind === 'text' || kind === 'conversation') return false;
  if (!REAL_MEDIA_KINDS.has(kind)) return false;
  if (String(event?.direction || '').toLowerCase() === 'outbound'
    && !isExplicitOutboundMedia(media, payload, event)) return false;
  return media.status === 'stored' && Boolean(media.bucket) && Boolean(media.storagePath) && !media.url;
}
