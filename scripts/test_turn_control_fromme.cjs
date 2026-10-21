// Turnos perdidos por TURN_CONTROL_ORIGIN_REQUIRED: resposta manual do operador pelo WhatsApp do celular.
// Roda as funções SQL REAIS (publicadas em 2026-10-21, ver supabase/tests/fixtures/turn_control_prod_2026_10_21.sql)
// num Postgres 16 descartável via Docker, prova a falha e prova a correção da migração pendente.
// Rodar: node --test scripts/test_turn_control_fromme.cjs   (requer Docker em execução)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const PROD = fs.readFileSync(path.join(root, 'supabase/tests/fixtures/turn_control_prod_2026_10_21.sql'), 'utf8');
const FIX = fs.readFileSync(path.join(root, 'supabase/migrations_pending_review/turn_control_fromme_manual_reply_v1.sql'), 'utf8');
const container = 'noria_turn_control_test_' + process.pid;

const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 180000 });
function psql(sql) {
  const r = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAtX'], sql);
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'psql failed').trim());
  return r.stdout.trim();
}
const tryPsql = sql => { try { return { ok: true, out: psql(sql) }; } catch (error) { return { ok: false, error: error.message }; } };

// Only the columns the four functions read. auth.uid() reads the JWT subject like Supabase.
const SCHEMA = `
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table tenants(id uuid primary key);
create table tenant_members(tenant_id uuid, user_id uuid, status text, role text);
create table tenant_settings(tenant_id uuid primary key, settings jsonb);
create table channel_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, tenant_slug text, channel_type text,
  external_conversation_id text, external_message_id text, direction text, sender_type text, service text, ai_provider text,
  handoff boolean default false, message_text text, delivery_status text, raw_payload jsonb default '{}', created_at timestamptz default clock_timestamp());
create table conversation_turn_queue(tenant_id uuid, channel_type text, chat_id text, token uuid, claimed jsonb, claimed_at timestamptz,
  boundary_id text, instance_name text);
create table sales_leads(id uuid default gen_random_uuid(), tenant_id uuid, channel_type text, chat_id text, session_id text,
  ai_locked boolean, stage_key text, revision int default 1);
create table conversation_turn_ingress_sources(id uuid primary key, tenant_id uuid, instance_name text, enabled boolean, principal_id uuid);
create table conversation_turn_ingress_facts(source_id uuid, tenant_id uuid, chat_id text, instance_name text, external_message_id text,
  body_sha256 text, from_me boolean, owner_saved boolean, business_account boolean, phone_jid text, received_at timestamptz default clock_timestamp());
create table conversation_turn_suppression_authorizations(tenant_id uuid, chat_id text, turn_token uuid, claimed jsonb, kind text, actor_id uuid, created_at timestamptz);
create table conversation_turn_delivery_attempts(tenant_id uuid, channel_type text, chat_id text, session_id text, status text,
  outbound_event_id uuid, provider_message_id text, turn_token uuid);
create table appointments(id uuid, tenant_id uuid, channel_type text, external_conversation_id text, status text, metadata jsonb);
create table conversation_turn_control_origins(event_id uuid primary key references channel_events(id), tenant_id uuid not null references tenants(id),
  actor_id uuid not null references auth.users(id), event_snapshot jsonb not null, source_kind text not null default 'authenticated_operator',
  attested_at timestamptz not null default clock_timestamp());
`;
const TENANT = '11111111-1111-4111-8111-111111111111', SOURCE = '22222222-2222-4222-8222-222222222222', PRINCIPAL = '33333333-3333-4333-8333-333333333333';
const TOKEN = '44444444-4444-4444-8444-444444444444', CHAT = '5521999990000@s.whatsapp.net';
const SEED = `
insert into tenants values ('${TENANT}');
insert into auth.users values ('${PRINCIPAL}');
insert into tenant_settings values ('${TENANT}', '{"ai_enabled": true}');
insert into conversation_turn_ingress_sources values ('${SOURCE}', '${TENANT}', 'genesis', true, '${PRINCIPAL}');
`;
// The fromMe echo exactly as the CORE node "Capturar Resposta Manual WhatsApp" records it.
const fromMeReply = (messageId, attested, ageDays = 0) => `
${attested ? `insert into conversation_turn_ingress_facts(source_id,tenant_id,chat_id,instance_name,external_message_id,body_sha256,from_me)
  values ('${SOURCE}','${TENANT}','${CHAT}','genesis','${messageId}',repeat('a',64),true);` : ''}
insert into channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,sender_type,service,ai_provider,handoff,message_text,delivery_status,raw_payload,created_at)
  values ('${TENANT}','wesley_automoveis','whatsapp','${CHAT}','${messageId}','outbound','agent','manual_reply','human_operator',false,'Qual o km ?','sent',
    '{"outbound_origin":"whatsapp_fromMe","magia_operator":{"source":"whatsapp_fromMe","operator_name":"Atendente"}}', clock_timestamp() - interval '${ageDays} days');
`;
// A legacy assignment recorded before the origin ledger (no origin, no delivery proof).
const legacyAssignment = ageDays => `
insert into channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,sender_type,service,ai_provider,handoff,message_text,created_at)
  values ('${TENANT}','wesley_automoveis','whatsapp','${CHAT}','assign_legacy','outbound','system','conversation_assigned','sales_operator',false,'Conversa atribuida a Wesley', clock_timestamp() - interval '${ageDays} days');
`;
// The customer's next message, claimed by the turn queue.
const customerTurn = messageId => `
insert into channel_events(id,tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,sender_type,service,message_text)
  values ('55555555-5555-4555-8555-555555555555','${TENANT}','wesley_automoveis','whatsapp','${CHAT}','${messageId}','inbound','customer','sales_qualification','1.6 com GNV');
insert into conversation_turn_queue values ('${TENANT}','whatsapp','${CHAT}','${TOKEN}',
  '[{"id":"${messageId}","event_id":"55555555-5555-4555-8555-555555555555"}]', clock_timestamp(), 'initial', 'genesis');
`;
const SUPPRESSION = `select magia_turn_suppression_status('${TENANT}','${CHAT}','${TOKEN}')::text;`;
const reset = `drop schema public cascade; drop schema if exists auth cascade; create schema public;`;
function fresh(functions, scenario) { psql(reset + SCHEMA + functions + `
create trigger noria_capture_authenticated_control after insert on channel_events for each row execute function magia_capture_authenticated_control();
` + SEED + scenario); }

let available = true;
test.before(() => {
  const up = docker(['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=x', 'postgres:16-alpine']);
  if (up.status !== 0) { available = false; return; }
  for (let i = 0; i < 60; i += 1) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0 && tryPsql('select 1').ok) return;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  available = false;
});
test.after(() => { docker(['rm', '-f', container]); });

test('versão publicada: resposta manual pelo celular derruba o próximo turno do cliente (TURN_CONTROL_ORIGIN_REQUIRED)', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD, fromMeReply('A5F1', true) + customerTurn('IN1'));
  assert.equal(psql('select count(*) from conversation_turn_control_origins'), '0', 'nenhuma origem registrada para o eco fromMe');
  const result = tryPsql(SUPPRESSION);
  assert.equal(result.ok, false);
  assert.match(result.error, /TURN_CONTROL_ORIGIN_REQUIRED/);
});

test('correção: eco fromMe autenticado registra origem e a IA cede a vez ao operador sem erro técnico', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD + FIX, fromMeReply('A5F1', true) + customerTurn('IN1'));
  assert.equal(psql(`select source_kind||'|'||actor_id from conversation_turn_control_origins`), 'authenticated_provider_outbound|' + PRINCIPAL);
  const evidence = JSON.parse(psql(SUPPRESSION)).evidence;
  assert.equal(evidence.human_control?.kind, 'human_control', JSON.stringify(evidence));
});

test('backfill: resposta manual já gravada antes da correção ganha origem com a mesma prova', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD, fromMeReply('A5F2', true));
  assert.equal(psql('select count(*) from conversation_turn_control_origins'), '0');
  psql(FIX + customerTurn('IN2'));
  assert.equal(psql('select count(*) from conversation_turn_control_origins'), '1');
  assert.equal(JSON.parse(psql(SUPPRESSION)).evidence.human_control?.kind, 'human_control');
});

test('segurança: resposta manual sem fato de ingresso autenticado continua sem origem e retida', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD + FIX, fromMeReply('A5F3', false) + customerTurn('IN3'));
  assert.equal(psql('select count(*) from conversation_turn_control_origins'), '0', 'sem prova não há origem');
  assert.match(tryPsql(SUPPRESSION).error || '', /TURN_CONTROL_ORIGIN_REQUIRED/);
});

test('legado sem prova com mais de 7 dias: a IA volta a atender (resposta manual e atribuição)', t => {
  if (!available) return t.skip('Docker indisponível');
  for (const scenario of [fromMeReply('A5F5', false, 8), legacyAssignment(8)]) {
    fresh(PROD + FIX, scenario + customerTurn('IN5'));
    const result = tryPsql(SUPPRESSION);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(JSON.parse(result.out).evidence, {}, 'nenhuma retenção: o turno segue para a IA');
  }
});

test('legado sem prova com até 7 dias continua retido (resposta manual e atribuição)', t => {
  if (!available) return t.skip('Docker indisponível');
  for (const scenario of [fromMeReply('A5F6', false, 6), legacyAssignment(6)]) {
    fresh(PROD + FIX, scenario + customerTurn('IN6'));
    assert.match(tryPsql(SUPPRESSION).error || '', /TURN_CONTROL_ORIGIN_REQUIRED/);
  }
});

test('versão publicada: legado sem prova antigo também derrubava o turno', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD, legacyAssignment(30) + customerTurn('IN7'));
  assert.match(tryPsql(SUPPRESSION).error || '', /TURN_CONTROL_ORIGIN_REQUIRED/);
});

test('controle comprovado não expira: resposta manual autenticada antiga mantém o operador no controle', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD + FIX, fromMeReply('A5F8', true, 20) + customerTurn('IN8'));
  assert.equal(JSON.parse(psql(SUPPRESSION)).evidence.human_control?.kind, 'human_control');
});

test('segurança: eco de mensagem da própria IA não vira controle humano', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD + FIX, `
insert into channel_events(tenant_id,channel_type,external_conversation_id,external_message_id,direction,sender_type,service,ai_provider)
  values ('${TENANT}','whatsapp','${CHAT}','A5F4','outbound','assistant','sales_qualification','sales_core');` + fromMeReply('A5F4', true));
  assert.equal(psql('select count(*) from conversation_turn_control_origins'), '0');
});

test('o fixture confere com as funções publicadas (sem divergência de texto)', t => {
  if (!available) return t.skip('Docker indisponível');
  fresh(PROD, '');
  const hashes = psql(`select string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid)), ',' order by p.proname) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.proname in ('magia_capture_authenticated_control','magia_turn_control_evidence','magia_turn_suppression_status','magia_control_event_projection')`);
  // Hashes de pg_get_functiondef em NORIA-prod, 2026-10-21.
  const expected = process.env.TURN_CONTROL_PROD_HASHES || 'magia_capture_authenticated_control:5f7cb91f8acffbea837eabf68e638c53,'
    + 'magia_control_event_projection:6bbb270d067925a48c01b914cdb327de,magia_turn_control_evidence:d2ebac4c806950aa41637f177d2a0a36,'
    + 'magia_turn_suppression_status:d65a610269696ce3e23c017758ce2d1e';
  assert.equal(hashes, expected);
});
