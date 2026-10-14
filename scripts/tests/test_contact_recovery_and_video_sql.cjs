const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('./pglite_helper.cjs');

const root = path.resolve(__dirname, '../..');
const preview = fs.readFileSync(path.join(root, 'scripts/sql/preview_genesis_corrupted_contacts.sql'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'scripts/sql/recover_genesis_contact_names.sql'), 'utf8');
const videos = fs.readFileSync(path.join(root, 'scripts/sql/classify_and_reconcile_pending_videos.sql'), 'utf8');

test('SQL uses PostgreSQL word boundaries and preserves a human Wesley name', () => {
  for (const sql of [preview, recovery]) {
    assert.match(sql, /\\m/);
    assert.match(sql, /wesley\\s\+\(\?:autom/);
    assert.doesNotMatch(sql, /\\b\(g\[eê\]nesis\|wesley/);
  }
});

test('contact preview recovers only proven inbound identities and keeps tenant/owner isolation', async () => {
  const db = new PGlite();
  await db.exec(`create table contacts (
    id text primary key, tenant_id text, name text, phone text, external_handle text,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    metadata jsonb default '{}'::jsonb, deleted_at timestamptz, source_channel text
  ); create table channel_events (
    id text primary key, tenant_id text, channel_type text, external_conversation_id text,
    direction text, sender_type text, contact_name text, created_at timestamptz default now()
  )`);
  await db.exec(`insert into contacts (id,tenant_id,name,external_handle,source_channel,metadata) values
    ('safe','74b57037-9349-4a9e-889c-b65fb63c983a','Gênesis Automóveis','55119901@s.whatsapp.net','whatsapp','{}'),
    ('owner','74b57037-9349-4a9e-889c-b65fb63c983a','Gênesis Automóveis','55119902@s.whatsapp.net','whatsapp','{"whatsapp_owner_saved":true}'),
    ('empty','74b57037-9349-4a9e-889c-b65fb63c983a','Gênesis Automóveis','55119903@s.whatsapp.net','whatsapp','{}'),
    ('conflict','74b57037-9349-4a9e-889c-b65fb63c983a','Gênesis Automóveis','55119904@s.whatsapp.net','whatsapp','{}'),
    ('other-tenant','00000000-0000-0000-0000-000000000000','Gênesis Automóveis','55119905@s.whatsapp.net','whatsapp','{}');
    insert into channel_events (id,tenant_id,channel_type,external_conversation_id,direction,sender_type,contact_name,created_at) values
    ('safe-event','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp','55119901@s.whatsapp.net','inbound','contact','Wesley Silva',now()),
    ('owner-event','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp','55119902@s.whatsapp.net','inbound','contact','Maria',now()),
    ('invalid-company','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp','55119903@s.whatsapp.net','inbound','contact','Gênesis Automóveis',now()),
    ('conflict-a','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp','55119904@s.whatsapp.net','inbound','contact','Ana',now()-interval '1 minute'),
    ('conflict-b','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp','55119904@s.whatsapp.net','inbound','contact','Bruno',now()),
    ('other-event','00000000-0000-0000-0000-000000000000','whatsapp','55119905@s.whatsapp.net','inbound','contact','Outro Tenant',now())`);
  const result = await db.query(preview);
  const rows = Object.fromEntries(result.rows.map(row => [row.contact_id, row]));
  assert.equal(rows.safe.recovery_classification, 'SAFE_RECOVERABLE');
  assert.equal(rows.safe.suggested_name, 'Wesley Silva');
  assert.equal(rows.owner.recovery_classification, 'MANUAL_REVIEW_OWNER_SAVED');
  assert.equal(rows.empty.recovery_classification, 'NO_VALID_INBOUND_NAME');
  assert.equal(rows.conflict.recovery_classification, 'AMBIGUOUS_MULTIPLE_NAMES');
  assert.equal(rows['other-tenant'], undefined);
  await db.close();
});

test('video reconciliation predicate never selects pending audio or image', async () => {
  const db = new PGlite();
  await db.exec(`create table channel_events (
    id text primary key, tenant_id text, channel_type text, created_at timestamptz,
    raw_payload jsonb, external_message_id text
  )`);
  await db.exec(`insert into channel_events values
    ('video-old','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp',now()-interval '2 days','{"media":{"kind":"video","status":"pending","size":"0"}}','v1'),
    ('audio-old','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp',now()-interval '2 days','{"media":{"kind":"audio","status":"pending","size":"0"}}','a1'),
    ('image-old','74b57037-9349-4a9e-889c-b65fb63c983a','whatsapp',now()-interval '2 days','{"media":{"kind":"image","status":"pending","size":"0"}}','i1')`);
  const result = await db.query(`select id from channel_events ce where ce.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'
    and ce.channel_type = 'whatsapp' and (ce.raw_payload->'media'->>'kind' = 'video'
      or ce.raw_payload->>'content_type' = 'video' or ce.raw_payload->'source_media'->>'kind' = 'video'
      or ce.raw_payload->'data'->'message' ? 'videoMessage') and ce.raw_payload->'media'->>'status' = 'pending'
    and ce.created_at < now() - interval '24 hours' and nullif(ce.raw_payload->'media'->>'storagePath', '') is null
    and coalesce(nullif(ce.raw_payload->'media'->>'size', '')::bigint, 0) = 0`);
  assert.deepEqual(result.rows.map(row => row.id), ['video-old']);
  await db.close();
});

test('recovery is guarded, tenant-scoped, owner-safe, and rolls back by default', () => {
  assert.match(recovery, /whatsapp_owner_saved/);
  assert.match(recovery, /tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'/);
  assert.match(recovery, /private_ops\.contact_name_recovery_audit/);
  assert.match(recovery, /Recovery validation failed/);
  assert.match(recovery, /ROLLBACK;/);
  assert.doesNotMatch(recovery, /CREATE TABLE IF NOT EXISTS public\._backup/);
});
