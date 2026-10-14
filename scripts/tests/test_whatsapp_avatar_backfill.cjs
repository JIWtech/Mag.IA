const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const sourcePath = path.join(root, 'n8n/code/whatsapp_avatar_backfill.js');
const workflowPath = path.join(root, 'n8n/workflows/Busca de fotos (perfil) conversas antigas.json');
const source = fs.readFileSync(sourcePath, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run({ contacts, evolution, input = {}, env = {} }) {
  const patches = [];
  let evolutionCalls = 0;
  const fn = new AsyncFunction('$env', '$vars', '$input', `return (async function () { ${source} }).call(this);`);
  const helpers = { httpRequest: async request => {
    if (request.url.includes('/rest/v1/contacts') && request.method === 'GET') return contacts;
    if (request.url.includes('/rest/v1/contacts') && request.method === 'PATCH') { patches.push({ url: request.url, body: request.body }); return [{ id: 'ok' }]; }
    if (request.url.includes('/chat/fetchProfilePictureUrl/')) { evolutionCalls += 1; return evolution; }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  }};
  const result = await fn.call({ helpers }, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key', EVOLUTION_API_URL_WESLEY_AUTOMOVEIS: 'https://evolution.test', EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS: 'key', EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS: 'instance', NORIA_AVATAR_REQUEST_DELAY_MS: '1', ...env }, {}, { first: () => ({ json: input }) });
  return { summary: result[0].json, patches, evolutionCalls };
}

function contact(overrides = {}) {
  return { id: 'contact-1', tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a', external_handle: '5511999999999@s.whatsapp.net', avatar_url: null, avatar_fetched_at: null, metadata: { identity: 'keep' }, updated_at: '2026-10-14T10:00:00.000Z', ...overrides };
}

test('avatar backfill never writes contact name/phone and ignores historical event identity', async () => {
  const { patches } = await run({ contacts: [contact()], evolution: { statusCode: 200, body: { profilePictureUrl: 'https://pps.whatsapp.net/photo' } } });
  assert.equal(patches.length, 1);
  assert.equal(Object.hasOwn(patches[0].body, 'name'), false);
  assert.equal(Object.hasOwn(patches[0].body, 'phone'), false);
  assert.equal(patches[0].body.metadata.identity, 'keep');
});

test('fresh positive cache is respected without an Evolution request', async () => {
  const { summary, evolutionCalls, patches } = await run({ contacts: [contact({ avatar_url: 'https://pps.whatsapp.net/photo', avatar_fetched_at: new Date().toISOString() })], evolution: {} });
  assert.equal(summary.positive_cache_used, 1);
  assert.equal(evolutionCalls, 0);
  assert.equal(patches.length, 0);
});

test('single forced refresh scopes the request and renews only the selected avatar', async () => {
  const selected = contact();
  const other = contact({ id: 'contact-2', external_handle: '5511888888888@s.whatsapp.net' });
  const { summary, evolutionCalls, patches } = await run({ contacts: [selected, other], input: { contact_id: 'contact-1', force_refresh: true, reason: 'image_load_error' }, evolution: { statusCode: 200, body: { data: { profilePictureUrl: 'https://pps.whatsapp.net/new' } } } });
  assert.equal(summary.mode, 'single');
  assert.equal(evolutionCalls, 1);
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /id=eq.contact-1/);
  assert.equal(summary.urls_renewed, 1);
});

test('explicit no_photo preserves an existing avatar and creates a short negative cache', async () => {
  const { patches, summary } = await run({ contacts: [contact({ avatar_url: 'https://pps.whatsapp.net/old', avatar_fetched_at: '2020-01-01T00:00:00Z' })], evolution: { statusCode: 200, body: { profilePictureUrl: null } } });
  assert.equal(Object.hasOwn(patches[0].body, 'avatar_url'), false);
  assert.equal(patches[0].body.metadata.whatsapp_avatar_negative_status, 'no_photo');
  assert.equal(summary.confirmed_no_photo, 1);
});

test('expired negative cache is queried again instead of waiting fourteen days', async () => {
  const { evolutionCalls, summary } = await run({ contacts: [contact({ metadata: { whatsapp_avatar_negative_status: 'no_photo', whatsapp_avatar_negative_fetched_at: '2020-01-01T00:00:00Z' } })], evolution: { statusCode: 200, body: { profilePictureUrl: 'https://pps.whatsapp.net/recovered' } } });
  assert.equal(evolutionCalls, 1);
  assert.equal(summary.avatars_saved, 1);
});

test('temporary Evolution failure never clears an existing photo and is backoff-classified', async () => {
  const { patches, summary } = await run({ contacts: [contact({ avatar_url: 'https://pps.whatsapp.net/old', avatar_fetched_at: '2020-01-01T00:00:00Z' })], evolution: { statusCode: 429, body: {} } });
  assert.equal(Object.hasOwn(patches[0].body, 'avatar_url'), false);
  assert.equal(patches[0].body.metadata.whatsapp_avatar_last_error_source, 'evolution_http_429');
  assert.equal(summary.confirmed_no_photo, 0);
});

test('batch limit is conservative and workflow JSON is generated from the canonical source', async () => {
  const { summary, evolutionCalls } = await run({ contacts: [contact(), contact({ id: 'contact-2', external_handle: '5511888888888@s.whatsapp.net' })], input: { limit: 1 }, evolution: { statusCode: 200, body: { profilePictureUrl: 'https://pps.whatsapp.net/photo' } } });
  assert.equal(summary.candidates, 1);
  assert.equal(evolutionCalls, 1);
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  assert.equal(workflow.nodes.find(node => node.id === 'b86637ce-1e0a-42d4-ab2a-174b17fe4f1d').parameters.jsCode, source.replace(/\r\n/g, '\n'));
});
