const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./pglite_helper.cjs');

const migration = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/029_gemini_global_rate_control.sql'), 'utf8');
let db;

test.before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(migration);
});

test.after(async () => { await db.close(); });
test.beforeEach(async () => {
  await db.exec('truncate public.gemini_rate_control_events, public.gemini_rate_control_leases, public.gemini_rate_control_state restart identity;');
});

async function acquire(lease, overrides = {}) {
  const args = {scope:'shared-project',model:'gemini-test',tokens:100,concurrent:2,rpm:100,tpm:100000,rpd:1000,ttl:30000,cooldown:30000,...overrides};
  const result = await db.query(`select public.magia_gemini_acquire($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result`,
    [args.scope,args.model,lease,args.tokens,args.concurrent,args.rpm,args.tpm,args.rpd,args.ttl,args.cooldown]);
  return result.rows[0].result;
}

async function release(lease, outcome, cooldown = 30000) {
  const result = await db.query(`select public.magia_gemini_release($1,$2,$3,$4,$5) as result`,
    ['shared-project','gemini-test',lease,outcome,cooldown]);
  return result.rows[0].result;
}

test('distributed controller atomically caps concurrent workers', async () => {
  const results = await Promise.all(['lease-a01','lease-a02','lease-a03','lease-a04'].map(id => acquire(id)));
  assert.equal(results.filter(item => item.allowed).length, 2);
  assert.equal(results.filter(item => item.reason === 'concurrency_busy').length, 2);
});

test('RPM uses a rolling 60-second window, not a minute bucket', async () => {
  assert.equal((await acquire('lease-r01',{rpm:2})).allowed, true); await release('lease-r01','success');
  assert.equal((await acquire('lease-r02',{rpm:2})).allowed, true); await release('lease-r02','success');
  assert.equal((await acquire('lease-r03',{rpm:2})).reason, 'rpm_exceeded');
  await db.exec(`update public.gemini_rate_control_events set occurred_at=clock_timestamp()-interval '61 seconds'`);
  assert.equal((await acquire('lease-r04',{rpm:2})).allowed, true);
});

test('TPM and rolling RPD limits are independently enforced', async () => {
  assert.equal((await acquire('lease-t01',{tokens:600,tpm:1000})).allowed, true); await release('lease-t01','success');
  assert.equal((await acquire('lease-t02',{tokens:500,tpm:1000})).reason, 'tpm_exceeded');
  await db.exec('truncate public.gemini_rate_control_events, public.gemini_rate_control_leases, public.gemini_rate_control_state;');
  assert.equal((await acquire('lease-d01',{rpd:1})).allowed, true); await release('lease-d01','success');
  assert.equal((await acquire('lease-d02',{rpd:1})).reason, 'rpd_exceeded');
});

test('expired lease is pruned and cannot permanently consume concurrency', async () => {
  await db.exec(`insert into public.gemini_rate_control_leases(scope,model,lease_id,circuit_generation,expires_at)
    values ('shared-project','gemini-test','expired-lease',0,clock_timestamp()-interval '1 second')`);
  assert.equal((await acquire('lease-e01',{concurrent:1})).allowed, true);
});

test('half-open admits exactly one probe', async () => {
  await acquire('lease-h01');
  await release('lease-h01','rate_limit',1000);
  await db.exec(`update public.gemini_rate_control_state set circuit_open_until=clock_timestamp()-interval '1 millisecond'`);
  const results = await Promise.all([acquire('lease-h02'), acquire('lease-h03')]);
  assert.equal(results.filter(item => item.reason === 'half_open_probe').length, 1);
  assert.equal(results.filter(item => item.reason === 'half_open_busy').length, 1);
});

test('an older success cannot erase a newer circuit generation', async () => {
  await acquire('lease-g01');
  await acquire('lease-g02');
  await release('lease-g02','rate_limit',30000);
  assert.equal((await release('lease-g01','success')).reason, 'success_without_circuit_mutation');
  const state = await db.query(`select circuit_generation,circuit_reason from public.gemini_rate_control_state
    where scope='shared-project' and model='gemini-test'`);
  assert.equal(Number(state.rows[0].circuit_generation), 1);
  assert.equal(state.rows[0].circuit_reason, 'rate_limit');
});

test('only the current half-open probe can close the circuit', async () => {
  await acquire('lease-p01'); await release('lease-p01','rate_limit',1000);
  await db.exec(`update public.gemini_rate_control_state set circuit_open_until=clock_timestamp()-interval '1 millisecond'`);
  const probe = await acquire('lease-p02');
  assert.equal(probe.is_probe, true);
  assert.equal((await release('lease-p02','success')).reason, 'probe_closed_circuit');
  const state = await db.query(`select circuit_reason,probe_lease_id from public.gemini_rate_control_state
    where scope='shared-project' and model='gemini-test'`);
  assert.equal(state.rows[0].circuit_reason, null);
  assert.equal(state.rows[0].probe_lease_id, null);
});

test('a timed-out half-open probe is fenced, cleared and put back into cooldown under concurrency', async () => {
  await acquire('lease-timeout-01');
  await release('lease-timeout-01','rate_limit',1000);
  await db.exec(`update public.gemini_rate_control_state set circuit_open_until=clock_timestamp()-interval '1 millisecond'`);
  assert.equal((await acquire('lease-timeout-02',{cooldown:1000})).reason, 'half_open_probe');

  const [released, contender] = await Promise.all([
    release('lease-timeout-02','network_or_timeout',1000),
    acquire('lease-timeout-03',{cooldown:1000}),
  ]);
  assert.equal(released.reason, 'probe_failure_cooldown');
  assert.equal(contender.allowed, false);
  assert.ok(['half_open_busy','circuit_open'].includes(contender.reason));

  const state = await db.query(`select circuit_generation,circuit_reason,circuit_open_until,probe_lease_id,probe_expires_at
    from public.gemini_rate_control_state where scope='shared-project' and model='gemini-test'`);
  assert.equal(Number(state.rows[0].circuit_generation), 2);
  assert.equal(state.rows[0].circuit_reason, 'network_or_timeout');
  assert.ok(state.rows[0].circuit_open_until);
  assert.equal(state.rows[0].probe_lease_id, null);
  assert.equal(state.rows[0].probe_expires_at, null);
});

test('a normal success resets consecutive upstream failures without racing an acquisition', async () => {
  await acquire('lease-reset-01'); await release('lease-reset-01','upstream_server');
  await acquire('lease-reset-02'); await release('lease-reset-02','upstream_server');
  await acquire('lease-reset-03');
  const [released, acquired] = await Promise.all([
    release('lease-reset-03','success'),
    acquire('lease-reset-04'),
  ]);
  assert.equal(released.reason, 'success_reset_upstream_failures');
  assert.equal(acquired.allowed, true);
  const state = await db.query(`select consecutive_upstream_failures from public.gemini_rate_control_state
    where scope='shared-project' and model='gemini-test'`);
  assert.equal(state.rows[0].consecutive_upstream_failures, 0);
});

test('stale rate-limit and upstream results cannot overwrite a newer circuit generation', async () => {
  await acquire('lease-fence-01',{concurrent:4});
  await acquire('lease-fence-02',{concurrent:4});
  await acquire('lease-fence-03',{concurrent:4});
  await release('lease-fence-01','rate_limit',5000);
  const stale = await Promise.all([
    release('lease-fence-02','rate_limit',90000),
    release('lease-fence-03','upstream_server',90000),
  ]);
  assert.deepEqual(stale.map(item => item.reason), ['stale_generation_ignored','stale_generation_ignored']);
  const state = await db.query(`select circuit_generation,circuit_reason,consecutive_upstream_failures,
      extract(epoch from (circuit_open_until-clock_timestamp()))*1000 as remaining_ms
    from public.gemini_rate_control_state where scope='shared-project' and model='gemini-test'`);
  assert.equal(Number(state.rows[0].circuit_generation), 1);
  assert.equal(state.rows[0].circuit_reason, 'rate_limit');
  assert.equal(state.rows[0].consecutive_upstream_failures, 0);
  assert.ok(Number(state.rows[0].remaining_ms) < 10000);
});

test('an abandoned probe gets one recovery cooldown and then exactly one new probe', async () => {
  await acquire('lease-abandoned-01'); await release('lease-abandoned-01','rate_limit',1000);
  await db.exec(`update public.gemini_rate_control_state set circuit_open_until=clock_timestamp()-interval '1 millisecond'`);
  await acquire('lease-abandoned-02',{cooldown:1000});
  await db.exec(`update public.gemini_rate_control_state
    set probe_expires_at=clock_timestamp()-interval '100 milliseconds';
    update public.gemini_rate_control_leases
    set expires_at=clock_timestamp()-interval '100 milliseconds'
    where lease_id='lease-abandoned-02';`);

  const cooling = await Promise.all([
    acquire('lease-abandoned-03',{cooldown:1000}),
    acquire('lease-abandoned-04',{cooldown:1000}),
    acquire('lease-abandoned-05',{cooldown:1000}),
  ]);
  assert.equal(cooling.filter(item => item.reason === 'probe_timeout_cooldown').length, 1);
  assert.equal(cooling.filter(item => item.allowed === false).length, 3);

  await db.exec(`update public.gemini_rate_control_state set circuit_open_until=clock_timestamp()-interval '1 millisecond'`);
  const recovered = await Promise.all([
    acquire('lease-abandoned-06',{cooldown:1000}),
    acquire('lease-abandoned-07',{cooldown:1000}),
    acquire('lease-abandoned-08',{cooldown:1000}),
  ]);
  assert.equal(recovered.filter(item => item.reason === 'half_open_probe').length, 1);
  assert.equal(recovered.filter(item => item.reason === 'half_open_busy').length, 2);
});

test('concurrent acquisition of the same lease id has one deterministic winner and no SQL error', async () => {
  const results = await Promise.all([
    acquire('lease-duplicate-01'),
    acquire('lease-duplicate-01'),
    acquire('lease-duplicate-01'),
  ]);
  assert.equal(results.filter(item => item.allowed === true).length, 1);
  assert.equal(results.filter(item => item.reason === 'duplicate_lease_id').length, 2);
  const events = await db.query(`select count(*)::integer as count from public.gemini_rate_control_events
    where lease_id='lease-duplicate-01'`);
  assert.equal(events.rows[0].count, 1);
});

test('shared project tenants cannot race in different RPM, TPM or RPD configurations', async () => {
  const variants = [
    {rpm:50,tpm:50000,rpd:500},
    {rpm:60,tpm:60000,rpd:600},
  ];
  const results = await Promise.all(variants.map((config,index) => acquire(`lease-config-0${index+1}`,config)));
  assert.equal(results.filter(item => item.allowed === true).length, 1);
  assert.equal(results.filter(item => item.reason === 'configuration_mismatch').length, 1);

  const winnerIndex = results.findIndex(item => item.allowed === true);
  const winner = variants[winnerIndex];
  const state = await db.query(`select configured_max_rpm,configured_max_tpm,configured_max_rpd
    from public.gemini_rate_control_state where scope='shared-project' and model='gemini-test'`);
  assert.deepEqual(state.rows[0], {
    configured_max_rpm:winner.rpm,
    configured_max_tpm:winner.tpm,
    configured_max_rpd:winner.rpd,
  });
  assert.equal((await acquire('lease-config-03',winner)).allowed, true);
});
