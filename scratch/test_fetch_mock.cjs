const assert = require('assert');

// Test how mocking globalThis.fetch works
const origFetch = globalThis.fetch;

async function testFetchMock() {
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 200,
        text: async () => '{"Key":"stored"}',
      };
    }
    if (options.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-length': String(options.body ? options.body.length : 122127)
        })
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const res = await globalThis.fetch('https://db.test/storage/v1/object/channel-media/test.jpg', {
      method: 'POST',
      body: Buffer.from([0xff, 0xd8, 0xff])
    });
    assert.equal(res.ok, true);
    assert.equal(captured.options.body[0], 0xff);
    console.log('Mock fetch works successfully!');
  } finally {
    globalThis.fetch = origFetch;
  }
}

testFetchMock().catch(console.error);
