import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAudioTime,
  calculateAudioProgress,
  isTechnicalMediaPlaceholder,
  normalizeTechnicalMediaPlaceholder,
  formatConversationPreview,
  formatCoordinates,
  formatFileSize,
  formatFriendlyMimeType,
  REAL_MEDIA_KINDS,
} from './audioUtils.js';
import {
  hasStoredMediaNeedingUrl,
  enrichSingleMediaEvent,
  resolveEventMessagePreview,
  applyIncomingEventToConversations,
  clearMediaUrlCache,
  normalizeLocation,
  eventsToConversations,
} from './dataService.js';

// ============================================================================
// TEMPOS E CÁLCULOS DO PLAYER
// ============================================================================

test('formatAudioTime: formata segundos corretamente para tempos curtos e longos', () => {
  assert.equal(formatAudioTime(0), '0:00');
  assert.equal(formatAudioTime(4), '0:04'); // Cenário C
  assert.equal(formatAudioTime(8), '0:08');
  assert.equal(formatAudioTime(17), '0:17'); // Contexto áudio real
  assert.equal(formatAudioTime(25), '0:25'); // Cenário D
  assert.equal(formatAudioTime(59), '0:59');
  assert.equal(formatAudioTime(60), '1:00');
  assert.equal(formatAudioTime(63), '1:03');
  assert.equal(formatAudioTime(125), '2:05');
  assert.equal(formatAudioTime(765), '12:45');
});

test('formatAudioTime: trata valores inválidos e extremos sem quebrar (sem NaN:NaN ou Infinity)', () => {
  assert.equal(formatAudioTime(NaN), '0:00');
  assert.equal(formatAudioTime(Infinity), '0:00');
  assert.equal(formatAudioTime(-Infinity), '0:00');
  assert.equal(formatAudioTime(-10), '0:00');
  assert.equal(formatAudioTime(null), '0:00');
  assert.equal(formatAudioTime(undefined), '0:00');
  assert.equal(formatAudioTime('invalid'), '0:00');
});

test('calculateAudioProgress: calcula porcentagem precisa e com clamping [0, 100]', () => {
  assert.equal(calculateAudioProgress(0, 17), 0);
  assert.equal(calculateAudioProgress(8.5, 17), 50);
  assert.equal(calculateAudioProgress(17, 17), 100);
  assert.equal(calculateAudioProgress(20, 17), 100); // Clamped no máximo
  assert.equal(calculateAudioProgress(-5, 17), 0);   // Clamped no mínimo
  assert.equal(calculateAudioProgress(0, 0), 0);     // Sem duração não divide por zero
  assert.equal(calculateAudioProgress(10, -5), 0);
  assert.equal(calculateAudioProgress(NaN, 17), 0);
  assert.equal(calculateAudioProgress(10, Infinity), 0);
});

// ============================================================================
// TESTES OBRIGATÓRIOS DO ESCOPO (TEST 1 a TEST 13)
// ============================================================================

test('TEST 1: Evento realtime de áudio com status stored ganha URL e integra na conversa sem F5', async () => {
  const audioEvent = {
    id: 'evt-audio-rt-1',
    created_at: '2026-10-02T14:00:00.000Z',
    direction: 'inbound',
    sender_type: 'contact',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    message_text: '[audio]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        category: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio.ogg',
        mimeType: 'audio/ogg; codecs=opus',
        duration: 17,
        size: 40256,
      },
    },
  };

  assert.equal(hasStoredMediaNeedingUrl(audioEvent), true);

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        download: async (path) => ({
          data: new Blob(['fake ogg opus data'], { type: 'audio/ogg' }),
          error: null,
        }),
      }),
    },
  };

  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL após enrichSingleMediaEvent');
  assert.match(enriched.raw_payload.media.url, /^(blob:|data:)/);

  const initialConv = {
    id: 'conv-5511999999999',
    canonicalKey: 'whatsapp::5511999999999',
    channel: 'WhatsApp',
    channelType: 'whatsapp',
    externalConversationId: '5511999999999',
    contact: 'Cliente',
    messages: [],
  };

  const updatedConvs = applyIncomingEventToConversations([initialConv], enriched, 'tenant');
  assert.equal(updatedConvs.length, 1);
  const latestMsg = updatedConvs[0].messages[0];
  assert.ok(latestMsg.media.url, 'message.media.url deve estar preenchida na conversa');
  assert.equal(latestMsg.media.kind, 'audio');
});

test('TEST 2: Evento realtime de imagem stored também ganha URL sem F5', async () => {
  const imageEvent = {
    id: 'evt-img-rt-1',
    created_at: '2026-10-02T14:05:00.000Z',
    direction: 'inbound',
    sender_type: 'contact',
    channel_type: 'whatsapp',
    external_conversation_id: '5511888888888',
    message_text: '[image]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        category: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/images/foto.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  assert.equal(hasStoredMediaNeedingUrl(imageEvent), true);

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        download: async (path) => ({
          data: {
            size: 2048,
            type: 'image/jpeg',
            arrayBuffer: async () => Buffer.from('fake image binary'),
          },
          error: null,
        }),
      }),
    },
  };

  const enriched = await enrichSingleMediaEvent(imageEvent, mockSupabase);
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL para imagem stored');
});

test('TEST 3: Evento realtime de texto não executa trabalho desnecessário de Storage', async () => {
  const textEvent = {
    id: 'evt-txt-1',
    message_text: 'Olá, gostaria de saber os horários',
    raw_payload: {},
  };

  assert.equal(hasStoredMediaNeedingUrl(textEvent), false);
  const result = await enrichSingleMediaEvent(textEvent, null);
  assert.equal(result, textEvent);
});

test('TEST 4: Placeholder [audio] vira Áudio', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[áudio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[ptt]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio recebido]'), 'Áudio');
  assert.equal(formatConversationPreview('[audio]'), 'Áudio');
});

test('TEST 5: Placeholder [image] vira Imagem', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[image]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[imagem]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[photo]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[foto]'), 'Imagem');
  assert.equal(formatConversationPreview('[image]'), 'Imagem');
});

test('TEST 6: Placeholder [sticker] vira Figurinha', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[sticker]'), 'Figurinha');
  assert.equal(normalizeTechnicalMediaPlaceholder('[figurinha]'), 'Figurinha');
  assert.equal(formatConversationPreview('[sticker]'), 'Figurinha');
});

test('TEST 7: [secretencrypted] não aparece como preview principal', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[secretencrypted]'), '');
  assert.equal(formatConversationPreview('[secretencrypted]'), '');

  const secretEvent = {
    id: 'e-secret',
    message_text: '[secretencrypted]',
    direction: 'inbound',
    raw_payload: {},
  };
  const preview = resolveEventMessagePreview(secretEvent);
  assert.equal(preview, null, 'resolveEventMessagePreview deve retornar null para secretencrypted');
});

test('TEST 8: reaction não substitui última mensagem normal', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('reaction'), '');
  assert.equal(normalizeTechnicalMediaPlaceholder('[reaction]'), '');

  const reactionEvent = {
    id: 'e-react',
    direction: 'inbound',
    message_text: '❤️',
    service: 'reaction',
    raw_payload: {
      messageType: 'reactionMessage',
    },
  };
  const preview = resolveEventMessagePreview(reactionEvent);
  assert.equal(preview, null, 'resolveEventMessagePreview deve retornar null para reaction');
});

test('TEST 9: media existe + text="[audio]" -> player renderiza e "[audio]" não renderiza abaixo', () => {
  const audioMedia = { kind: 'audio', url: 'https://example.com/audio.ogg' };
  assert.equal(isTechnicalMediaPlaceholder('[audio]', audioMedia), true);
  assert.equal(isTechnicalMediaPlaceholder('[áudio]', audioMedia), true);
});

test('TEST 10: media não existe + text="[audio]" -> mostra fallback "Áudio"', () => {
  // Quando media não existe, isTechnicalMediaPlaceholder é false para que o bloco trate o fallback:
  assert.equal(isTechnicalMediaPlaceholder('[audio]', null), false);
  // O displayText exibido na bolha deve ser normalizado:
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[image]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[sticker]'), 'Figurinha');
});

test('TEST 11: media caption real + text="[image]" -> preview usa caption real', () => {
  const mediaWithCaption = {
    kind: 'image',
    caption: 'Olha esse carro',
  };
  assert.equal(formatConversationPreview('[image]', mediaWithCaption), 'Olha esse carro');

  const eventWithCaption = {
    id: 'e-caption',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[image]',
    raw_payload: {
      media: {
        kind: 'image',
        caption: 'Olha esse carro',
      },
    },
  };
  const preview = resolveEventMessagePreview(eventWithCaption);
  assert.equal(preview.text, 'Olha esse carro');
});

test('TEST 12: texto legítimo como "Eu uso [audio] como nome da variável" NÃO deve ser transformado', () => {
  const legitimateText = 'Eu uso [audio] como nome da variável';
  assert.equal(normalizeTechnicalMediaPlaceholder(legitimateText), legitimateText);
  assert.equal(formatConversationPreview(legitimateText), legitimateText);

  const bracketsText = 'Relatório [2026] finalizado com sucesso [doc]';
  assert.equal(normalizeTechnicalMediaPlaceholder(bracketsText), bracketsText);
});

test('TEST 13: variações de caixa e espaços (" [AUDIO] ", "[Imagem]") também devem funcionar', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder(' [AUDIO] '), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('  [áudio]  '), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[Imagem]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [STICKER] '), 'Figurinha');
  assert.equal(normalizeTechnicalMediaPlaceholder('[Vídeo]'), 'Vídeo');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [Documento] '), 'Documento');
  assert.equal(formatConversationPreview(' [AUDIO] '), 'Áudio');
  assert.equal(formatConversationPreview('[Imagem]'), 'Imagem');
});

test('TEST 14: Storage com createSignedUrl retorna URL assinada direta para imagens sem executar download de Blob ou FileReader', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;
  let createSignedUrlCalls = 0;

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath, expiresIn) => {
          createSignedUrlCalls += 1;
          assert.equal(bucket, 'channel-media');
          assert.equal(storagePath, 'tenant/images/foto_signed.jpg');
          assert.ok(expiresIn >= 7200, 'Duração do link assinado deve ser adequada (>= 2 horas)');
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/images/foto_signed.jpg?token=secret123' },
            error: null,
          };
        },
        download: async () => {
          downloadCalled = true;
          throw new Error('download não deveria ser chamado quando createSignedUrl é suportado!');
        },
      }),
    },
  };

  const imageEvent = {
    id: 'evt-img-signed-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/images/foto_signed.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(imageEvent, mockSupabase);
  assert.equal(downloadCalled, false, 'Download de Blob nunca deve ser executado no caminho preferencial');
  assert.equal(createSignedUrlCalls, 1);
  assert.equal(
    enriched.raw_payload.media.url,
    'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/images/foto_signed.jpg?token=secret123',
  );
});

test('TEST 15: Storage com createSignedUrl para áudio retorna URL assinada direta para o AudioMessagePlayer sem download de Blob', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath, expiresIn) => {
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/audio/audio_signed.ogg?token=tok456' },
            error: null,
          };
        },
        download: async () => {
          downloadCalled = true;
          throw new Error('download não deveria ser chamado para áudio quando createSignedUrl é suportado!');
        },
      }),
    },
  };

  const audioEvent = {
    id: 'evt-audio-signed-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio_signed.ogg',
        mimeType: 'audio/ogg; codecs=opus',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  assert.equal(downloadCalled, false);
  assert.equal(
    enriched.raw_payload.media.url,
    'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/audio/audio_signed.ogg?token=tok456',
  );
});

test('TEST 16: Cache de URLs reutiliza signed URL sem chamadas repetidas ao Storage para o mesmo bucket e storagePath', async () => {
  clearMediaUrlCache();
  let createSignedUrlCalls = 0;

  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          createSignedUrlCalls += 1;
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz' },
            error: null,
          };
        },
      }),
    },
  };

  const event1 = {
    id: 'evt-cache-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/cache/foto.jpg',
      },
    },
  };
  const event2 = {
    id: 'evt-cache-2',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/cache/foto.jpg',
      },
    },
  };

  const res1 = await enrichSingleMediaEvent(event1, mockSupabase);
  assert.equal(createSignedUrlCalls, 1);
  assert.equal(res1.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz');

  const res2 = await enrichSingleMediaEvent(event2, mockSupabase);
  assert.equal(createSignedUrlCalls, 1, 'Segunda requisição para o mesmo arquivo deve ser atendida pelo cache');
  assert.equal(res2.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz');
});

test('TEST 17: Falha em createSignedUrl executa fallback gracioso para download de Blob', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;

  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
          error: new Error('createSignedUrl não suportado nesta região'),
        }),
        download: async () => {
          downloadCalled = true;
          return {
            data: {
              size: 1024,
              type: 'image/jpeg',
              arrayBuffer: async () => Buffer.from('binary-data'),
            },
            error: null,
          };
        },
      }),
    },
  };

  const event = {
    id: 'evt-fallback-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/fallback/foto.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(event, mockSupabase);
  assert.equal(downloadCalled, true, 'Deve ter chamado download() em caso de falha de createSignedUrl');
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL do fallback');
});

// ============================================================================
// TESTES OBRIGATÓRIOS: TEXTO PURO, LOCATION, DOCUMENTOS E REGRESSÕES
// ============================================================================

test('TEST A: category=text + media ausente -> não cria media nem renderiza MediaAttachment', () => {
  const pureTextEvent = {
    id: 'evt-text-pure',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Tem manual e chave reserva',
    raw_payload: {
      messageType: 'conversation',
      media: null,
      magia_normalized: {
        media: {
          category: 'text',
        },
      },
    },
  };
  const [conv] = eventsToConversations([pureTextEvent], 'tenant');
  assert.equal(conv.messages[0].media, null, 'media deve ser estritamente null para texto puro');
  assert.equal(conv.messages[0].text, 'Tem manual e chave reserva');
  assert.equal(hasStoredMediaNeedingUrl(pureTextEvent), false);
});

test('TEST B: message_text="Tem manual e chave reserva" -> somente texto', () => {
  const anotherTextEvent = {
    id: 'evt-text-amassados',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Ele só tá com uns amassados...',
    raw_payload: {
      messageType: 'conversation',
      media: {
        category: 'text',
      },
    },
  };
  const [conv2] = eventsToConversations([anotherTextEvent], 'tenant');
  assert.equal(conv2.messages[0].media, null, 'objeto com category=text não pode gerar media');
  assert.equal(conv2.messages[0].text, 'Ele só tá com uns amassados...');
});

test('TEST C: locationMessage + [location] -> preview "Localização"', () => {
  const locationEvent = {
    id: 'evt-loc-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -22.9068,
        degreesLongitude: -43.1729,
      },
    },
  };
  const preview = resolveEventMessagePreview(locationEvent);
  assert.equal(preview.text, 'Localização');
});

test('TEST D: locationMessage com nome/endereço/coordenadas -> LocationAttachment recebe os dados corretos', () => {
  const locationWithDetailsEvent = {
    id: 'evt-loc-details',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -22.9068,
        degreesLongitude: -43.1729,
        name: 'Gênesis automóveis',
        address: 'Av. das Américas, 500',
      },
    },
  };
  const loc = normalizeLocation(locationWithDetailsEvent.raw_payload);
  assert.equal(loc.name, 'Gênesis automóveis');
  assert.equal(loc.address, 'Av. das Américas, 500');
  assert.equal(loc.latitude, -22.9068);
  assert.equal(loc.longitude, -43.1729);
  assert.ok(loc.url.includes('google.com/maps'));

  const previewDetails = resolveEventMessagePreview(locationWithDetailsEvent);
  assert.equal(previewDetails.text, 'Gênesis automóveis');

  const [convLoc] = eventsToConversations([locationWithDetailsEvent], 'tenant');
  assert.ok(convLoc.messages[0].location);
  assert.equal(convLoc.messages[0].location.name, 'Gênesis automóveis');
  assert.equal(convLoc.messages[0].location.address, 'Av. das Américas, 500');
});

test('TEST E: [location] nunca aparece cru', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[location]'), 'Localização');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [LOCATION] '), 'Localização');
  assert.equal(normalizeTechnicalMediaPlaceholder('[localização]'), 'Localização');
  assert.equal(formatConversationPreview('[location]'), 'Localização');
  assert.equal(formatConversationPreview(' [location] '), 'Localização');
});

test('TEST F: document stored + URL -> card de documento real com metadados', async () => {
  clearMediaUrlCache();
  const docEvent = {
    id: 'evt-doc-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5511666666666',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[document]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'document',
        bucket: 'channel-media',
        storagePath: 'tenant/docs/manual.pdf',
        fileName: 'manual_do_proprietario.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/manual.pdf?token=xyz' },
          error: null,
        }),
      }),
    },
  };
  const enrichedDoc = await enrichSingleMediaEvent(docEvent, mockSupabase);
  assert.equal(enrichedDoc.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/manual.pdf?token=xyz');
  const [convDoc] = eventsToConversations([enrichedDoc], 'tenant');
  const docMsg = convDoc.messages[0];
  assert.equal(docMsg.media.kind, 'document');
  assert.equal(docMsg.media.fileName, 'manual_do_proprietario.pdf');
  assert.equal(formatFriendlyMimeType(docMsg.media.mimeType, docMsg.media.fileName), 'PDF');
  assert.equal(formatFileSize(docMsg.media.size), '1.0 MB');
});

test('TEST G: document sem URL -> fallback amigável Documento, sem card fantasma de imagem', () => {
  const pendingDocEvent = {
    id: 'evt-doc-pending',
    channel_type: 'whatsapp',
    external_conversation_id: '5511666666666',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[document]',
    raw_payload: {
      media: {
        status: 'pending',
        kind: 'document',
        fileName: 'contrato.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  };
  const [convPending] = eventsToConversations([pendingDocEvent], 'tenant');
  const pendingMsg = convPending.messages[0];
  assert.equal(pendingMsg.media.kind, 'document');
  assert.equal(pendingMsg.media.url, '');
  assert.equal(formatFriendlyMimeType(pendingMsg.media.mimeType, pendingMsg.media.fileName), 'Word');
});

test('TEST H: áudio e imagem atuais continuam funcionando', () => {
  assert.equal(REAL_MEDIA_KINDS.has('audio'), true);
  assert.equal(REAL_MEDIA_KINDS.has('image'), true);
  assert.equal(REAL_MEDIA_KINDS.has('text'), false);
  assert.equal(REAL_MEDIA_KINDS.has('conversation'), false);
});

// ============================================================================
// LOCALIZAÇÃO: FORMATAÇÃO, RESOLUÇÃO IMEDIATA E CACHE
// ============================================================================

test('formatCoordinates: formata latitude e longitude com cardinalidade e 4 casas decimais', () => {
  assert.equal(formatCoordinates(-23.55052, -46.633308), '23.5505° S, 46.6333° O');
  assert.equal(formatCoordinates(40.7128, -74.0060), '40.7128° N, 74.0060° O');
  assert.equal(formatCoordinates(-22.9068, 43.1729), '22.9068° S, 43.1729° L');
  assert.equal(formatCoordinates(0, 0), '0.0000° N, 0.0000° L');
});

test('formatCoordinates: trata valores nulos ou inválidos retornando string vazia', () => {
  assert.equal(formatCoordinates(null, null), '');
  assert.equal(formatCoordinates(undefined, -46.63), '');
  assert.equal(formatCoordinates('abc', 10), '');
  assert.equal(formatCoordinates(NaN, NaN), '');
});

test('normalizeLocation: reconhece imediatamente mensagem de localização mesmo sem coordenadas prévias', () => {
  const event = {
    id: 'evt-loc-pending',
    message_text: '[location]',
    raw_payload: {},
  };
  const result = normalizeLocation(event.raw_payload, event);
  assert.ok(result);
  assert.equal(result.isResolving, true);
  assert.equal(result.name, '');
  assert.equal(result.address, '');
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
});

test('normalizeLocation: extrai nome, endereço e coordenadas do payload Evolution / WhatsApp', () => {
  const event = {
    id: 'evt-loc-complete',
    message_text: 'Localização',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -23.55052,
        degreesLongitude: -46.63331,
        name: 'Parque Ibirapuera',
        address: 'Av. Pedro Álvares Cabral - Vila Mariana, São Paulo - SP',
      },
    },
  };
  const result = normalizeLocation(event.raw_payload, event);
  assert.ok(result);
  assert.equal(result.isResolving, false);
  assert.equal(result.name, 'Parque Ibirapuera');
  assert.equal(result.address, 'Av. Pedro Álvares Cabral - Vila Mariana, São Paulo - SP');
  assert.equal(result.latitude, -23.55052);
  assert.equal(result.longitude, -46.63331);
  assert.ok(result.url.includes('-23.55052,-46.63331'));
});

test('normalizeLocation: reutiliza cache de endereço e nome para coordenadas idênticas', () => {
  // 1º evento tem nome e endereço
  const event1 = {
    id: 'evt-loc-cached-1',
    raw_payload: {
      locationMessage: {
        degreesLatitude: -22.90684,
        degreesLongitude: -43.17291,
        name: 'Cristo Redentor',
        address: 'Parque Nacional da Tijuca - Alto da Boa Vista, Rio de Janeiro - RJ',
      },
    },
  };
  normalizeLocation(event1.raw_payload, event1);

  // 2º evento com as mesmas coordenadas mas sem nome/endereço (apenas coordenadas brutas)
  const event2 = {
    id: 'evt-loc-cached-2',
    raw_payload: {
      locationMessage: {
        degreesLatitude: -22.90684,
        degreesLongitude: -43.17291,
      },
    },
  };
  const result2 = normalizeLocation(event2.raw_payload, event2);
  assert.ok(result2);
  assert.equal(result2.name, 'Cristo Redentor');
  assert.equal(result2.address, 'Parque Nacional da Tijuca - Alto da Boa Vista, Rio de Janeiro - RJ');
});

test('applyIncomingEventToConversations: atualiza location atomicamente quando mensagem pendente é enriquecida', () => {
  // 1. Mensagem inicial chega como [location] pendente
  const pendingEvent = {
    id: 'evt-loc-realtime',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999887766',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    created_at: '2026-10-02T18:00:00.000Z',
    raw_payload: {},
  };

  const initialConversations = applyIncomingEventToConversations([], pendingEvent, 'tenant');
  assert.equal(initialConversations.length, 1);
  const msg1 = initialConversations[0].messages[0];
  assert.ok(msg1.location);
  assert.equal(msg1.location.isResolving, true);

  // 2. Evento atualizado chega com coordenadas e endereço resolvidos
  const resolvedEvent = {
    id: 'evt-loc-realtime',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999887766',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    created_at: '2026-10-02T18:00:00.000Z',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -23.55,
        degreesLongitude: -46.63,
        name: 'Sé',
        address: 'Praça da Sé, São Paulo - SP',
      },
    },
  };

  const updatedConversations = applyIncomingEventToConversations(initialConversations, resolvedEvent, 'tenant');
  assert.equal(updatedConversations[0].messages.length, 1);
  const updatedMsg = updatedConversations[0].messages[0];
  assert.ok(updatedMsg.location);
  assert.equal(updatedMsg.location.isResolving, false);
  assert.equal(updatedMsg.location.name, 'Sé');
  assert.equal(updatedMsg.location.address, 'Praça da Sé, São Paulo - SP');
  assert.equal(updatedMsg.location.latitude, -23.55);
});
