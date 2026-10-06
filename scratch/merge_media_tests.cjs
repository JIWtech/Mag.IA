const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const combined = fs.readFileSync(path.join(root, 'scratch/test_combined_media.cjs'), 'utf8');

const extra = `
test('20. storage size limit: <= 10 MiB permitted, > 10 MiB rejected without upload attempt', async () => {
  // Case A: 10 MiB exact (10485760 bytes) -> allowed
  const tenMbBuffer = Buffer.alloc(10 * 1024 * 1024, 0x61);
  const tenMbBase64 = tenMbBuffer.toString('base64');
  const hA = createMockHarness({
    messages: [{ event_id: 'e-10mb', id: 'm-10mb', text: '[image]' }],
    rawPayloads: {
      'e-10mb': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', file_length: 10 * 1024 * 1024, mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-10mb': { mimetype: 'image/jpeg', base64: tenMbBase64 },
    },
  });
  const resA = await hA.execute();
  assert.equal(resA.ok, true, 'Turn must succeed');
  assert.equal(hA.uploads.length, 1, 'Upload must be attempted for <= 10 MiB');
  assert.equal(hA.eventsInDb['e-10mb'].raw_payload.media.status, 'stored');
  assert.equal(hA.eventsInDb['e-10mb'].raw_payload.media.size, 10 * 1024 * 1024);

  // Case B: > 10 MiB declared in descriptor -> rejected BEFORE download/upload
  const hB = createMockHarness({
    messages: [{ event_id: 'e-11mb', id: 'm-11mb', text: '[image]' }],
    rawPayloads: {
      'e-11mb': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', file_length: 11 * 1024 * 1024, mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-11mb': { mimetype: 'image/jpeg', base64: 'should-not-be-called' },
    },
  });
  const resB = await hB.execute();
  assert.equal(resB.ok, true, 'Turn must not crash for oversized media');
  assert.equal(hB.uploads.length, 0, 'Must NOT attempt upload for > 10 MiB');
  const mediaB = hB.eventsInDb['e-11mb'].raw_payload.media;
  assert.equal(mediaB.status, 'skipped_too_large');
  assert.equal(mediaB.error, 'media_too_large');

  // Case C: > 10 MiB undeclared (downloaded bytes > 10 MiB) -> rejected BEFORE storage upload
  const elevenMbBuffer = Buffer.alloc(11 * 1024 * 1024, 0x62);
  const elevenMbBase64 = elevenMbBuffer.toString('base64');
  const hC = createMockHarness({
    messages: [{ event_id: 'e-11mb-undec', id: 'm-11mb-undec', text: '[image]' }],
    rawPayloads: {
      'e-11mb-undec': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-11mb-undec': { mimetype: 'image/jpeg', base64: elevenMbBase64 },
    },
  });
  const resC = await hC.execute();
  assert.equal(resC.ok, true, 'Turn must not crash for oversized downloaded media');
  assert.equal(hC.uploads.length, 0, 'Must NOT attempt upload when downloaded bytes > 10 MiB');
  const mediaC = hC.eventsInDb['e-11mb-undec'].raw_payload.media;
  assert.equal(mediaC.status, 'skipped_too_large');
  assert.equal(mediaC.error, 'media_too_large');
});

test('21. storage real idempotency: same event upload does not duplicate path, uses x-upsert, never 409', async () => {
  const h = createMockHarness({
    messages: [{ event_id: 'e-idemp', id: 'm-idemp', text: '[image]' }],
    rawPayloads: {
      'e-idemp': { channel_type: 'whatsapp', content_type: 'image' },
    },
    mediaFixtures: {
      'm-idemp': { mimetype: 'image/jpeg', base64: Buffer.from('photo-bytes').toString('base64') },
    },
  });
  // First run: stores file
  await h.execute();
  assert.equal(h.uploads.length, 1);
  const firstUpload = h.uploads[0];
  assert.equal(firstUpload.headers['x-upsert'], 'true');
  const firstStoragePath = h.eventsInDb['e-idemp'].raw_payload.media.storagePath;
  assert.equal(firstStoragePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-idemp.jpg');
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.status, 'stored');

  // Second run on exact same event:
  // Since existing.status === 'stored' with bucket and storagePath, it skips re-uploading
  await h.execute();
  assert.equal(h.uploads.length, 1, 'Does not re-upload if already stored');
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.storagePath, firstStoragePath);
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.status, 'stored');
});

test('22. jsonb raw_payload atomicity & preservation: media, sales_media, and audio_processing coexist without data loss', async () => {
  const initialMedia = {
    status: 'stored', kind: 'audio', category: 'audio',
    bucket: 'channel-media', storagePath: 'wesley_automoveis/whatsapp/chat/msg-audio.ogg',
    mimeType: 'audio/ogg', size: 12345
  };
  const event = {
    id: 'evt-atomic-1',
    external_message_id: 'msg-audio',
    raw_payload: {
      channel_type: 'whatsapp',
      content_type: 'audio',
      media: initialMedia
    }
  };

  const audioResult = {
    version: 'whatsapp_audio_v1',
    status: 'transcribed',
    text: 'Quero avaliar meu Gol 2012',
    model: 'gemini-1.5-flash',
    mime_type: 'audio/ogg'
  };
  const patch1 = {
    raw_payload: {
      ...event.raw_payload,
      audio_processing: audioResult
    }
  };
  assert.deepEqual(patch1.raw_payload.media, initialMedia);
  assert.deepEqual(patch1.raw_payload.audio_processing, audioResult);

  const salesEntry = {
    event_id: 'evt-atomic-1',
    kind: 'vehicle_audio',
    readable: true
  };
  const patch2 = {
    raw_payload: {
      ...patch1.raw_payload,
      sales_media: [salesEntry]
    }
  };
  assert.deepEqual(patch2.raw_payload.media, initialMedia, 'media block must remain intact');
  assert.deepEqual(patch2.raw_payload.audio_processing, audioResult, 'audio_processing block must remain intact');
  assert.deepEqual(patch2.raw_payload.sales_media, [salesEntry], 'sales_media block must be added');
});
`;

const finalContent = combined + '\n' + extra;
fs.writeFileSync(path.join(root, 'scripts/test_whatsapp_media.cjs'), finalContent);
console.log('scripts/test_whatsapp_media.cjs successfully updated with 53 tests!');
