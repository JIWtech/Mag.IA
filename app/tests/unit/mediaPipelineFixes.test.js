import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extensionForKind,
  hasStoredMediaNeedingUrl,
  isUsableBrowserUrl,
  normalizeMedia,
  unwrapWhatsAppMessage,
} from '../../src/services/media/mediaNormalization.js';
import { clearMediaUrlCache, enrichMediaUrls } from '../../src/services/media/mediaUrlService.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';

test('isUsableBrowserUrl: rejects WhatsApp encrypted URLs and accepts web URLs', () => {
  assert.equal(isUsableBrowserUrl('https://mmg.whatsapp.net/v/t62.7118-24/12345.enc'), false);
  assert.equal(isUsableBrowserUrl('https://pps.whatsapp.net/v/t61.24694-24/67890'), false);
  assert.equal(isUsableBrowserUrl('http://media.whatsapp.net/file.enc'), false);
  assert.equal(isUsableBrowserUrl(''), false);
  assert.equal(isUsableBrowserUrl(null), false);

  assert.equal(isUsableBrowserUrl('https://xyz.supabase.co/storage/v1/object/sign/channel-media/photo.jpg?token=abc'), true);
  assert.equal(isUsableBrowserUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isUsableBrowserUrl('blob:http://localhost:5173/uuid-1234'), true);
});

test('unwrapWhatsAppMessage: unwraps viewOnce, ephemeral, and document wrappers', () => {
  const viewOnce = {
    data: {
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: { mimetype: 'image/jpeg', caption: 'Foto única' },
          },
        },
      },
    },
  };
  const unwrapped = unwrapWhatsAppMessage(viewOnce);
  assert.equal(unwrapped.imageMessage?.caption, 'Foto única');

  const ephemeral = {
    message: {
      ephemeralMessage: {
        message: {
          videoMessage: { mimetype: 'video/mp4', seconds: 12 },
        },
      },
    },
  };
  assert.equal(unwrapWhatsAppMessage(ephemeral).videoMessage?.seconds, 12);
});

test('extensionForKind: maps MIME types and file names to safe extensions', () => {
  assert.equal(extensionForKind('image', 'image/jpeg'), 'jpg');
  assert.equal(extensionForKind('image', 'image/png'), 'png');
  assert.equal(extensionForKind('image', 'image/webp'), 'webp');
  assert.equal(extensionForKind('video', 'video/mp4'), 'mp4');
  assert.equal(extensionForKind('video', 'video/webm'), 'webm');
  assert.equal(extensionForKind('audio', 'audio/ogg'), 'ogg');
  assert.equal(extensionForKind('audio', 'audio/mpeg'), 'mp3');
  assert.equal(extensionForKind('sticker', 'image/webp'), 'webp');
  assert.equal(extensionForKind('document', 'application/pdf', 'contrato.pdf'), 'pdf');
  assert.equal(extensionForKind('document', 'application/pdf'), 'pdf');
  assert.equal(extensionForKind('document', 'application/msword', 'documento.docx'), 'docx');
});

test('normalizeMedia: strips mmg.whatsapp.net encrypted URLs and derives Supabase storage paths for all media types', () => {
  const eventBase = {
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    external_message_id: '3EB0TEST123',
    direction: 'inbound',
  };

  // 1. Imagem
  const imageEvent = {
    ...eventBase,
    raw_payload: {
      data: {
        message: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/encrypted.enc',
            mimetype: 'image/jpeg',
            caption: 'Foto do carro',
            fileLength: 54321,
          },
        },
      },
    },
  };
  const normImg = normalizeMedia(imageEvent.raw_payload, imageEvent);
  assert.equal(normImg.kind, 'image');
  assert.equal(normImg.url, '', 'Encrypted WhatsApp URL must NOT be used as displayable url');
  assert.equal(normImg.bucket, 'channel-media');
  assert.equal(normImg.storagePath, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0TEST123.jpg');
  assert.equal(normImg.status, 'stored');
  assert.equal(normImg.caption, 'Foto do carro');

  // 2. Vídeo
  const videoEvent = {
    ...eventBase,
    external_message_id: '3EB0VID123',
    raw_payload: {
      data: {
        message: {
          videoMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/video.enc',
            mimetype: 'video/mp4',
            seconds: 15,
            fileLength: 1048576,
          },
        },
      },
    },
  };
  const normVid = normalizeMedia(videoEvent.raw_payload, videoEvent);
  assert.equal(normVid.kind, 'video');
  assert.equal(normVid.url, '');
  assert.equal(normVid.bucket, 'channel-media');
  assert.equal(normVid.storagePath, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0VID123.mp4');
  assert.equal(normVid.status, 'stored');
  assert.equal(normVid.duration, 15);

  // 3. Figurinha (Sticker)
  const stickerEvent = {
    ...eventBase,
    external_message_id: '3EB0STK123',
    raw_payload: {
      data: {
        message: {
          stickerMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/sticker.enc',
            mimetype: 'image/webp',
          },
        },
      },
    },
  };
  const normStk = normalizeMedia(stickerEvent.raw_payload, stickerEvent);
  assert.equal(normStk.kind, 'sticker');
  assert.equal(normStk.url, '');
  assert.equal(normStk.bucket, 'channel-media');
  assert.equal(normStk.storagePath, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0STK123.webp');
  assert.equal(normStk.status, 'stored');

  // 4. Documento
  const documentEvent = {
    ...eventBase,
    external_message_id: '3EB0DOC123',
    raw_payload: {
      data: {
        message: {
          documentMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/doc.enc',
            mimetype: 'application/pdf',
            fileName: 'cnh_cliente.pdf',
            fileLength: 204800,
          },
        },
      },
    },
  };
  const normDoc = normalizeMedia(documentEvent.raw_payload, documentEvent);
  assert.equal(normDoc.kind, 'document');
  assert.equal(normDoc.url, '');
  assert.equal(normDoc.fileName, 'cnh_cliente.pdf');
  assert.equal(normDoc.bucket, 'channel-media');
  assert.equal(normDoc.storagePath, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0DOC123.pdf');
  assert.equal(normDoc.status, 'stored');
});

test('hasStoredMediaNeedingUrl and enrichMediaUrls: resolves signed URLs for stored media with WhatsApp encrypted URLs', async () => {
  clearMediaUrlCache();
  const event = {
    id: 'evt-test-enrich',
    direction: 'inbound',
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    external_message_id: '3EB0TEST123',
    raw_payload: {
      data: {
        message: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/encrypted.enc',
            mimetype: 'image/jpeg',
            caption: 'Foto do Corolla',
          },
        },
      },
    },
  };

  assert.equal(hasStoredMediaNeedingUrl(event), true);

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path) => {
          assert.equal(bucket, 'channel-media');
          assert.equal(path, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0TEST123.jpg');
          return { data: { signedUrl: 'https://supabase.co/signed/corolla.jpg?token=xyz' }, error: null };
        },
      }),
    },
  };

  const [enriched] = await enrichMediaUrls([event], mockSupabase);
  assert.equal(enriched.raw_payload.media.url, 'https://supabase.co/signed/corolla.jpg?token=xyz');
  assert.equal(enriched.raw_payload.media.status, 'stored');

  // Agora que tem URL assinada usável, hasStoredMediaNeedingUrl deve retornar false
  assert.equal(hasStoredMediaNeedingUrl(enriched), false);

  const [conversation] = eventsToConversations([enriched], 'wesley_automoveis');
  const msg = conversation.messages[0];
  assert.equal(msg.media.kind, 'image');
  assert.equal(msg.media.url, 'https://supabase.co/signed/corolla.jpg?token=xyz');
  assert.equal(msg.text, 'Foto do Corolla');
});

test('Section 6 technical placeholders: [video], [document], [sticker], and [album] derive storage paths', () => {
  const base = {
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511888888888@s.whatsapp.net',
    external_message_id: 'MSG123',
    direction: 'inbound',
  };

  const video = normalizeMedia({}, { ...base, message_text: '[video]' });
  assert.equal(video.kind, 'video');
  assert.equal(video.bucket, 'channel-media');
  assert.equal(video.storagePath, 'wesley_automoveis/whatsapp/5511888888888_s.whatsapp.net/MSG123.mp4');

  const sticker = normalizeMedia({}, { ...base, message_text: '[sticker]' });
  assert.equal(sticker.kind, 'sticker');
  assert.equal(sticker.bucket, 'channel-media');
  assert.equal(sticker.storagePath, 'wesley_automoveis/whatsapp/5511888888888_s.whatsapp.net/MSG123.webp');

  const document = normalizeMedia({}, { ...base, message_text: '[documento recebido]' });
  assert.equal(document.kind, 'document');
  assert.equal(document.bucket, 'channel-media');
  assert.equal(document.storagePath, 'wesley_automoveis/whatsapp/5511888888888_s.whatsapp.net/MSG123.pdf');

  const album = normalizeMedia({}, { ...base, message_text: '[álbum]' });
  assert.equal(album.kind, 'image');
  assert.equal(album.bucket, 'channel-media');
  assert.equal(album.storagePath, 'wesley_automoveis/whatsapp/5511888888888_s.whatsapp.net/MSG123.jpg');
});
