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
import { extractInteractiveMessageText, resolveEventVisibleText } from '../../src/services/conversations/conversationPresentation.js';

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

test('interactive button placeholder renders the received labels instead of [buttons]', () => {
  const event = {
    message_text: '[buttons]',
    raw_payload: {
      data: {
        message: {
          buttonsMessage: {
            contentText: 'Qual veículo você quer ver?',
            footerText: 'Gênesis Automóveis',
            buttons: [{ buttonText: { displayText: 'Ver motos' } }, { buttonText: { displayText: 'Ver carros' } }],
          },
        },
      },
    },
  };
  assert.equal(extractInteractiveMessageText(event.raw_payload), 'Qual veículo você quer ver?\nGênesis Automóveis\nVer motos\nVer carros');
  assert.equal(resolveEventVisibleText(event), 'Qual veículo você quer ver?\nGênesis Automóveis\nVer motos\nVer carros');
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

test('normalizeMedia: strips mmg.whatsapp.net encrypted URLs and does not fabricate paths without storagePath', () => {
  const eventBase = {
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    external_message_id: '3EB0TEST123',
    direction: 'inbound',
  };

  // 1. Mensagem de imagem recebida sem persistência prévia no storage -> unavailable sem inventar caminho
  const unconfirmedImageEvent = {
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
  const normUnconfirmed = normalizeMedia(unconfirmedImageEvent.raw_payload, unconfirmedImageEvent);
  assert.equal(normUnconfirmed.kind, 'image');
  assert.equal(normUnconfirmed.url, '', 'Encrypted WhatsApp URL must NOT be used as displayable url');
  assert.equal(normUnconfirmed.storagePath, '', 'Must NOT fabricate storage path when storagePath is missing');
  assert.equal(normUnconfirmed.status, 'unavailable');
  assert.equal(normUnconfirmed.caption, 'Foto do carro');

  // 2. Mensagem confirmada com storagePath persistido
  const confirmedImageEvent = {
    ...eventBase,
    raw_payload: {
      media: {
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0TEST123.jpg',
        status: 'stored',
        caption: 'Foto do carro confirmada',
      },
    },
  };
  const normConfirmed = normalizeMedia(confirmedImageEvent.raw_payload, confirmedImageEvent);
  assert.equal(normConfirmed.kind, 'image');
  assert.equal(normConfirmed.bucket, 'channel-media');
  assert.equal(normConfirmed.storagePath, 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0TEST123.jpg');
  assert.equal(normConfirmed.status, 'stored');
  assert.equal(normConfirmed.caption, 'Foto do carro confirmada');
});

test('hasStoredMediaNeedingUrl and enrichMediaUrls: resolves signed URLs for stored media', async () => {
  clearMediaUrlCache();
  const event = {
    id: 'evt-test-enrich',
    direction: 'inbound',
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    external_message_id: '3EB0TEST123',
    raw_payload: {
      media: {
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'wesley_automoveis/whatsapp/5511999999999_s.whatsapp.net/3EB0TEST123.jpg',
        status: 'stored',
        caption: 'Foto do Corolla',
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

test('normalizeMedia: preserves stored-media aliases so the signer receives the original object path', () => {
  const event = { direction: 'inbound' };
  const media = normalizeMedia({
    media: {
      kind: 'image',
      storage_bucket: 'channel-media',
      storage_path: 'wesley_automoveis/whatsapp/chat/legacy.jpg',
      storage_status: 'stored',
      media_url: 'https://example.test/legacy.jpg',
      mimetype: 'image/jpeg',
      filename: 'legacy.jpg',
    },
  }, event);

  assert.equal(media.bucket, 'channel-media');
  assert.equal(media.storagePath, 'wesley_automoveis/whatsapp/chat/legacy.jpg');
  assert.equal(media.status, 'stored');
  assert.equal(media.url, 'https://example.test/legacy.jpg');
  assert.equal(media.mimeType, 'image/jpeg');
  assert.equal(media.fileName, 'legacy.jpg');
});

test('Section 6 technical placeholders: [video], [document], [sticker], and [album] do NOT fabricate storage paths', () => {
  const base = {
    tenant_slug: 'wesley_automoveis',
    external_conversation_id: '5511888888888@s.whatsapp.net',
    external_message_id: 'MSG123',
    direction: 'inbound',
  };

  const video = normalizeMedia({}, { ...base, message_text: '[video]' });
  assert.equal(video, null);

  const sticker = normalizeMedia({}, { ...base, message_text: '[sticker]' });
  assert.equal(sticker, null);

  const document = normalizeMedia({}, { ...base, message_text: '[documento recebido]' });
  assert.equal(document, null);

  const album = normalizeMedia({}, { ...base, message_text: '[álbum]' });
  assert.equal(album, null);
});
