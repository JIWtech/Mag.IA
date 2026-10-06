const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../app/src/audioPlayer.test.js');
const content = fs.readFileSync(filePath, 'utf8');

const contractTests = `
// ============================================================================
// SECTION: FRONTEND MEDIA CONTRACT TESTS (video, storage_error, audio+transcription)
// ============================================================================

test('contract: video stored uses signed URL and produces MediaAttachment kind video', async () => {
  clearMediaUrlCache();
  const videoEvent = {
    id: 'evt-video-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[video]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'video',
        category: 'video',
        bucket: 'channel-media',
        storagePath: 'tenant/video/video-walkaround.mp4',
        mimeType: 'video/mp4',
        size: 5242880,
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath) => {
          assert.equal(bucket, 'channel-media');
          assert.equal(storagePath, 'tenant/video/video-walkaround.mp4');
          return { data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc' }, error: null };
        },
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(videoEvent, mockSupabase);
  assert.equal(enriched.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc');
  const [conv] = eventsToConversations([enriched], 'tenant');
  const msg = conv.messages[0];
  assert.equal(msg.media.kind, 'video');
  assert.equal(msg.media.url, 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc');
  assert.equal(msg.media.mimeType, 'video/mp4');
});

test('contract: storage_error does NOT attempt to generate signed URL', async () => {
  clearMediaUrlCache();
  let calledSignedUrl = false;
  const errorEvent = {
    id: 'evt-storage-error-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[image]',
    raw_payload: {
      media: {
        status: 'storage_error',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: null,
        error: 'media_too_large',
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          calledSignedUrl = true;
          return { data: null, error: new Error('should not be called') };
        },
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(errorEvent, mockSupabase);
  assert.equal(calledSignedUrl, false, 'createSignedUrl must NOT be called for storage_error');
  assert.equal(enriched.raw_payload.media.url, undefined);
});

test('contract: audio stored + audio_processing renders player and transcription together', async () => {
  clearMediaUrlCache();
  const audioEvent = {
    id: 'evt-audio-full-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        category: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio-contract.ogg',
        mimeType: 'audio/ogg',
        size: 32000,
      },
      audio_processing: {
        version: 'whatsapp_audio_v1',
        status: 'transcribed',
        text: 'Boa tarde, gostaria de agendar uma visita.',
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/audio.ogg?token=xyz' },
          error: null,
        }),
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  const [conv] = eventsToConversations([enriched], 'tenant');
  const msg = conv.messages[0];
  assert.equal(msg.media.kind, 'audio');
  assert.equal(msg.media.url, 'https://project.supabase.co/storage/v1/object/sign/audio.ogg?token=xyz');
  assert.equal(msg.audioTranscription?.text, 'Boa tarde, gostaria de agendar uma visita.');
});
`;

fs.writeFileSync(filePath, content.trimEnd() + '\n' + contractTests);
console.log('Successfully appended frontend contract tests!');
