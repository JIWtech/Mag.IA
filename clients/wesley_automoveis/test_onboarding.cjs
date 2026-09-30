'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES
  || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'), '@electric-sql/pglite'));
const { scoreDeposit, purchaseEligibility } = require('./regras_sdr.cjs');
const owner = '8fb2bc06-94d5-4abe-83b2-1aed41a346ae';
const sql = fs.readFileSync(path.join(__dirname, '01_cadastro_inativo.sql'), 'utf8');
const confirmedSql = fs.readFileSync(path.join(__dirname, '03_dados_confirmados.sql'), 'utf8');

async function fixture(withOwner = true) {
  const db = new PGlite();
  const core = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/001_core_multi_tenant.sql'), 'utf8');
  // PGlite provides gen_random_uuid without the optional pgcrypto extension.
  await db.exec(core.replace('create extension if not exists "pgcrypto";', ''));
  const auth = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/008_auth_multi_tenant_policies.sql'), 'utf8');
  await db.exec('create schema auth; create table auth.users(id uuid primary key,email text);');
  await db.exec(auth.slice(0, auth.indexOf('alter table tenant_members')));
  if (withOwner) await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'owner@example.invalid']);
  await db.exec(`insert into tenant_settings(tenant_id,settings)
    select id,'{"unchanged":true}'::jsonb from tenants;
    insert into tenants(slug,name) values('clinica_nubia_oficial','Fixture Nubia');
    insert into tenant_settings(tenant_id,settings) select id,'{"ai_enabled":true,"sentinel":"preserve"}'::jsonb
    from tenants where slug='clinica_nubia_oficial';`);
  return db;
}

test('Wesley bootstrap is disabled, scoped and does not overwrite settings on rerun', async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from tenant_settings order by tenant_id')).rows;
    await db.exec(sql);
    const rows = (await db.query("select t.id,s.settings from tenants t join tenant_settings s on s.tenant_id=t.id where t.slug='wesley_automoveis'")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].settings.ai_enabled, false);
    assert.equal(rows[0].settings.payment_signal_enabled, false);
    assert.equal(rows[0].settings.whatsapp_processing_mode, undefined);
    const membership = (await db.query('select user_id,role from tenant_members where tenant_id=$1', [rows[0].id])).rows;
    assert.deepEqual(membership, [{ user_id: owner, role: 'owner' }]);
    assert.deepEqual((await db.query('select * from tenant_settings where tenant_id<>$1 order by tenant_id', [rows[0].id])).rows, before);
    assert.equal((await db.query('select count(*)::int n from channels')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from ai_prompt_versions')).rows[0].n, 0);
    await db.query("update tenant_settings set settings=settings || '{\"later_change\":true}'::jsonb where tenant_id=$1", [rows[0].id]);
    const saved = (await db.query('select * from tenant_settings order by tenant_id')).rows;
    await db.exec(sql);
    assert.deepEqual((await db.query('select * from tenant_settings order by tenant_id')).rows, saved);
  } finally { await db.close(); }
});

test('missing Auth UID rolls back without creating Wesley', async () => {
  const db = await fixture(false);
  try {
    await assert.rejects(db.exec(sql), /no rows/);
    await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int n from tenants where slug='wesley_automoveis'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('slug collision never replaces existing tenant settings', async () => {
  const db = await fixture();
  try {
    await db.exec("insert into tenants(slug,name) values('wesley_automoveis','Existing company');");
    await assert.rejects(db.exec(sql), /Slug existente/);
    await db.exec('rollback');
    assert.equal((await db.query("select name from tenants where slug='wesley_automoveis'")).rows[0].name, 'Existing company');
    assert.equal((await db.query('select count(*)::int n from tenant_members')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('existing membership is not silently removed or extended', async () => {
  const db = await fixture();
  try {
    await db.query("insert into tenant_members(tenant_id,user_id,role) select id,$1,'owner' from tenants where slug='teste'", [owner]);
    await assert.rejects(db.exec(sql), /outra empresa/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from tenant_members')).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from tenants where slug='wesley_automoveis'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('hot score uses exact cents and does not approve credit', () => {
  assert.deepEqual(scoreDeposit(4298000, 1289400), { status: 'hot_candidate', hot: true });
  assert.equal(scoreDeposit(4298000, 1289399).hot, false);
  assert.equal(scoreDeposit(4298000, 0).status, 'standard_qualification');
  for (const [price, amount] of [[null,100], [0,0], [100,-1], [100,101], [100,'30'], [100,30.1]]) {
    assert.equal(scoreDeposit(price, amount).status, 'needs_clarification');
  }
});

test('confirmed setup keeps AI off, channel pending, weekdays unknown and other tenants unchanged', async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from tenant_settings order by tenant_id')).rows;
    await db.exec(sql);
    await db.exec(confirmedSql);
    await db.exec(confirmedSql);
    const config = (await db.query("select s.* from tenant_settings s join tenants t on t.id=s.tenant_id where t.slug='wesley_automoveis'")).rows[0];
    assert.equal(config.settings.ai_enabled, false);
    assert.equal(config.business_hours.days, null);
    assert.deepEqual(config.settings.business_facts.vehicle_types, ['carro','moto']);
    assert.equal(config.settings.onboarding_confirmations.document_storage_requested, true);
    assert.equal(config.settings.onboarding_confirmations.document_pipeline_ready, false);
    const channels = (await db.query('select * from channels where tenant_id=$1', [config.tenant_id])).rows;
    assert.equal(channels.length, 1);
    assert.equal(channels[0].status, 'pending');
    assert.equal(channels[0].external_id, 'wesley-carros');
    assert.equal(channels[0].config.phone, '5521992923139');
    assert.deepEqual((await db.query('select * from tenant_settings where tenant_id<>$1 order by tenant_id', [config.tenant_id])).rows, before);
  } finally { await db.close(); }
});

test('confirmed setup rejects another tenant instance and never disables an active channel', async () => {
  const db = await fixture();
  try {
    await db.exec(sql);
    await db.exec("insert into channels(tenant_id,type,name,external_id,status) select id,'whatsapp','Fixture channel','wesley-carros','active' from tenants where slug='teste';");
    await assert.rejects(db.exec(confirmedSql), /outro tenant/);
    await db.exec('rollback');
    assert.equal((await db.query("select status from channels where external_id='wesley-carros'")).rows[0].status, 'active');
    await db.exec("delete from channels where external_id='wesley-carros';");
    await db.exec(confirmedSql);
    await db.exec("update channels set status='active' where external_id='wesley-carros';");
    await assert.rejects(db.exec(confirmedSql), /fora da preparacao/);
    await db.exec('rollback');
    assert.equal((await db.query("select status from channels where external_id='wesley-carros'")).rows[0].status, 'active');
  } finally { await db.close(); }
});

test('purchase rules reject excluded brands/years, never invent appraisal prices', () => {
  assert.equal(purchaseEligibility({ brand: 'Citroën', model: 'C3', year: 2020 }).status, 'rejected');
  assert.equal(purchaseEligibility({ brand: ' Peugeot ', model: '208', year: 2020 }).status, 'rejected');
  assert.equal(purchaseEligibility({ brand: 'Fiat', model: 'Uno', year: 1994 }).status, 'rejected');
  assert.deepEqual(purchaseEligibility({ brand: 'Fiat', model: 'Uno Mille', year: 1995 }), { status: 'eligible_for_human_appraisal', preferred: true });
  assert.equal(purchaseEligibility({ brand: 'VW', model: 'Golf', year: 2010 }).preferred, false);
  assert.equal(purchaseEligibility({ brand: 'Fiat', model: 'Uno' }).status, 'needs_clarification');
  assert.equal(purchaseEligibility({ brand: 'Honda', model: 'PCX', year: 2023, kind: 'motorcycle' }).status, 'human_review');
});

test('reference inventory preserves both PCX rows and is not live availability', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'estoque_referencia.json'), 'utf8'));
  assert.equal(inventory.vehicles.length, 6);
  assert.deepEqual(inventory.vehicles.filter(v => v.model === 'PCX').map(v => v.year), [2023, 2018]);
  assert.ok(inventory.vehicles.every(v => Number.isSafeInteger(v.price_cents) && v.status === undefined));
});
