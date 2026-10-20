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

// Caminhos de storage NUNCA devem ser presumidos ou inventados a partir de
// external_message_id. Para mídias confirmadas, o caminho persistido em
// raw_payload.media (ou source_media) gravado pelo workflow CORE é a única
// fonte de verdade.


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
      // Aceita as variantes legadas de serialização sem adivinhar caminhos.
      // O caminho continua vindo exclusivamente do evento que já foi gravado.
      let bucket = normalized.bucket || normalized.storageBucket || normalized.storage_bucket || '';
      let storagePath = normalized.storagePath || normalized.storage_path || normalized.path || '';
      let status = normalized.status || normalized.storageStatus || normalized.storage_status || '';

      const rawUrl = normalized.url || normalized.mediaUrl || normalized.media_url || '';
      const url = isUsableBrowserUrl(rawUrl) ? rawUrl : '';
      const rawThumb = normalized.thumbnailUrl || normalized.thumbnail_url || '';
      const thumbnailUrl = isUsableBrowserUrl(rawThumb) ? rawThumb : '';

      return {
        kind,
        category: normalized.category || kind,
        status: status || (storagePath ? 'stored' : ''),
        verified: normalized.verified === true,
        origin: normalized.origin || normalized.source || '',
        loadState: normalized.loadState || normalized.load_state || '',
        bucket,
        storagePath,
        caption: normalized.caption || '',
        url,
        thumbnailUrl,
        fileName: normalized.fileName || normalized.file_name || normalized.filename || '',
        mimeType: normalized.mimeType || normalized.mime_type || normalized.mimetype || '',
        encoding: normalized.encoding || '',
        size: Number(normalized.size || normalized.file_size || 0),
        duration: Number(normalized.duration || 0),
      };
    }
  }

  // 4. Mídia Evolution API (WhatsApp)
  // Mídias confirmadas possuem raw_payload.media com storagePath gravado pelo CORE workflow.
  // Se o envelope bruto contiver apenas a mensagem da Evolution sem storagePath confirmado,
  // nunca invente um arquivo a partir do ID da mensagem.
  if (!isOutboundEvent && evolutionMessage.imageMessage) {
    const img = evolutionMessage.imageMessage;
    const mimeType = img.mimetype || 'image/jpeg';
    const usableUrl = isUsableBrowserUrl(img.url) ? img.url : '';
    return {
      kind: 'image',
      category: 'image',
      caption: img.caption || '',
      mimeType,
      url: usableUrl,
      bucket: '',
      storagePath: '',
      status: usableUrl ? 'stored' : 'unavailable',
      size: Number(img.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.audioMessage) {
    const aud = evolutionMessage.audioMessage;
    const mimeType = aud.mimetype || 'audio/ogg';
    const usableUrl = isUsableBrowserUrl(aud.url) ? aud.url : '';
    return {
      kind: 'audio',
      category: 'audio',
      duration: Number(aud.seconds || 0),
      mimeType,
      url: usableUrl,
      bucket: '',
      storagePath: '',
      status: usableUrl ? 'stored' : 'unavailable',
      size: Number(aud.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.videoMessage) {
    const vid = evolutionMessage.videoMessage;
    const mimeType = vid.mimetype || 'video/mp4';
    const usableUrl = isUsableBrowserUrl(vid.url) ? vid.url : '';
    return {
      kind: 'video',
      category: 'video',
      caption: vid.caption || '',
      duration: Number(vid.seconds || 0),
      mimeType,
      url: usableUrl,
      bucket: '',
      storagePath: '',
      status: usableUrl ? 'stored' : 'unavailable',
      size: Number(vid.fileLength || 0),
    };
  }
  if (!isOutboundEvent && evolutionMessage.documentMessage) {
    const doc = evolutionMessage.documentMessage;
    const fileName = doc.fileName || 'Documento';
    const mimeType = doc.mimetype || 'application/octet-stream';
    const usableUrl = isUsableBrowserUrl(doc.url) ? doc.url : '';
    return {
      kind: 'document',
      category: 'document',
      fileName,
      mimeType,
      size: Number(doc.fileLength || 0),
      url: usableUrl,
      bucket: '',
      storagePath: '',
      status: usableUrl ? 'stored' : 'unavailable',
    };
  }
  if (!isOutboundEvent && evolutionMessage.stickerMessage) {
    const stk = evolutionMessage.stickerMessage;
    const mimeType = stk.mimetype || 'image/webp';
    const usableUrl = isUsableBrowserUrl(stk.url) ? stk.url : '';
    return {
      kind: 'sticker',
      category: 'sticker',
      mimeType,
      url: usableUrl,
      bucket: '',
      storagePath: '',
      status: usableUrl ? 'stored' : 'unavailable',
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

  // 6. Mídia WhatsApp armazenada cujo raw_payload.media foi omitido mas possui comprovação de processamento (sales_media com readable: true ou transcrição em lote com chave de mensagem)
  // IMPORTANTE: Nunca invente caminho a partir de texto simples como [image] ou [audio] sem evidência concreta de objeto existente.
  if (!isOutboundEvent && (!normalized.kind && !normalized.category)) {
    const hasVerifiedSalesMedia = Boolean(
      payload.sales_media && (
        Array.isArray(payload.sales_media)
          ? payload.sales_media.some((m) => m.kind === 'vehicle_photo' && m.readable !== false)
          : payload.sales_media.kind === 'vehicle_photo' && payload.sales_media.readable !== false
      )
    );
    const hasAudioWithTranscription = Array.isArray(payload.audio_transcriptions) && payload.audio_transcriptions.length > 0;

    const messageId = event?.external_message_id || payload?.key?.id || payload?.external_message_id || payload?.message_id;
    const convId = event?.external_conversation_id || payload?.external_conversation_id || payload?.key?.remoteJid;
    const tenant = event?.tenant_slug || event?.tenantId || payload?.tenant_slug || '';

    if ((hasVerifiedSalesMedia || hasAudioWithTranscription) && messageId && convId && tenant) {
      const cleanChat = String(convId).replace(/@/g, '_');
      const ext = hasVerifiedSalesMedia ? 'jpg' : 'ogg';
      const kind = hasVerifiedSalesMedia ? 'image' : 'audio';
      return {
        kind,
        category: kind,
        status: 'stored',
        bucket: 'channel-media',
        storagePath: `${tenant}/whatsapp/${cleanChat}/${messageId}.${ext}`,
        url: '',
        caption: '',
        mimeType: hasVerifiedSalesMedia ? 'image/jpeg' : 'audio/ogg',
      };
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
