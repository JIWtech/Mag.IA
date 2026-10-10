import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearMediaUrlCache,
  enrichMediaUrls,
  getMediaUrlFromCache,
} from '../../src/services/media/mediaUrlService.js';
import { clearMediaUrlCache as clearMediaUrlCacheFromFacade } from '../../src/dataService.js';

function storedEvent(id, path = id) {
  return {
    id,
    direction: 'inbound',
    raw_payload: {
      media: {
        status: 'stored',
        bucket: 'media',
        storagePath: path,
        kind: 'image',
        mimeType: 'image/png',
      },
    },
  };
}

test('uses a single cache, expires signed URLs, and clears it', async () => {
  clearMediaUrlCache();
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  let calls = 0;
  const supabase = { storage: { from: () => ({
    createSignedUrl: async () => ({ data: { signedUrl: `signed-${++calls}` }, error: null }),
  }) } };

  try {
    const first = await enrichMediaUrls([storedEvent('one')], supabase);
    const second = await enrichMediaUrls([storedEvent('two', 'one')], supabase);
    assert.equal(first[0].raw_payload.media.url, 'signed-1');
    assert.equal(second[0].raw_payload.media.url, 'signed-1');
    assert.equal(getMediaUrlFromCache('media:one'), 'signed-1');
    assert.equal(calls, 1);

    now = (86400 - 300) * 1000;
    const expired = await enrichMediaUrls([storedEvent('three', 'one')], supabase);
    assert.equal(expired[0].raw_payload.media.url, 'signed-2');
    assert.equal(calls, 2);
    clearMediaUrlCacheFromFacade();
    assert.equal(getMediaUrlFromCache('media:one'), null);
  } finally {
    Date.now = originalNow;
    clearMediaUrlCache();
  }
});

test('retries transient signing failures and falls back to base64 downloads', async () => {
  clearMediaUrlCache();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  let attempts = 0;
  const retrySupabase = { storage: { from: () => ({
    createSignedUrl: async () => (++attempts === 1
      ? { data: null, error: { status: 503, message: 'temporary' } }
      : { data: { signedUrl: 'retried-url' }, error: null }),
  }) } };
  const downloadSupabase = { storage: { from: () => ({
    createSignedUrl: undefined,
    download: async () => ({ data: new Blob(['aGk='], { type: 'text/plain' }), error: null }),
  }) } };

  try {
    const retried = await enrichMediaUrls([storedEvent('retry')], retrySupabase);
    assert.equal(retried[0].raw_payload.media.url, 'retried-url');
    assert.equal(attempts, 2);

    const base64 = storedEvent('base64');
    base64.raw_payload.media.encoding = 'base64';
    const downloaded = await enrichMediaUrls([base64], downloadSupabase);
    assert.equal(downloaded[0].raw_payload.media.url, 'data:image/png;base64,aGk=');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    clearMediaUrlCache();
  }
});

test('limits unique media resolution to four concurrent storage requests', async () => {
  clearMediaUrlCache();
  let active = 0;
  let maximum = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const supabase = { storage: { from: () => ({
    createSignedUrl: async (path) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return { data: { signedUrl: `signed-${path}` }, error: null };
    },
  }) } };
  const pending = enrichMediaUrls(['a', 'b', 'c', 'd', 'e'].map((id) => storedEvent(id)), supabase);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 4);
  release();
  const enriched = await pending;
  assert.deepEqual(enriched.map((event) => event.raw_payload.media.url), ['signed-a', 'signed-b', 'signed-c', 'signed-d', 'signed-e']);
  clearMediaUrlCache();
});
