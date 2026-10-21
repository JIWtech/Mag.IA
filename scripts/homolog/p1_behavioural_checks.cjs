// Behavioural checks for the P1 defects of the Gênesis audit. They run the real CORE and EXT code through the homologation
// executor and read the effects back from the simulated database and provider. They are not regex checks on the source.
//
//   node scripts/homolog/p1_behavioural_checks.cjs
//
// A check that cannot run its scenario FAILS. Nothing is reported as passed because a precondition was missing.
//
// Mixed-version runs (P1-04) need a snapshot of the previous publication. HOMOLOG_PREVIOUS_SOURCE_ROOT points to one. Without it
// the snapshot is built here from git HEAD (identity node, CORE router node) and from the current CORE/EXT with only their contract
// constants reverted. If neither is possible the check fails with SNAPSHOT_UNAVAILABLE.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const ts = require(path.resolve(__dirname, '../../app/node_modules/typescript'));
const exec = require('./genesis_executor.cjs');

const repo = path.resolve(__dirname, '../..');
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'genesis_scenarios.json'), 'utf8'));
const byName = prefix => scenarios.scenarios.find(item => item.name.startsWith(prefix));
const settings = exec.loadSettings();
const results = [];
const record = (id, name, ok, detail) => results.push({ id, name, ok: Boolean(ok), detail });
const clone = value => JSON.parse(JSON.stringify(value));

// What stopped a turn, read from the turn itself: a thrown error, or the failure the CORE recorded on the turn.
function refusal(result) {
  const step = result.steps[0] || {};
  return step.stopped || step.state?.turn_failures?.[0] || step.final?.error_code || 'no refusal';
}

function run(scenario, extra = {}) {
  return exec.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: extra.settings || settings, inventory: scenarios.inventory, seed: extra.seed, turnOptions: extra.turnOptions });
}

// Effects a commercial action or a send would leave behind.
function effects(world) {
  return {
    sends: world.log.simulated_sends.length,
    leads: world.tables.sales_leads.length,
    commercial_rpcs: world.log.blocked.length,
    outbound_events: world.tables.channel_events.filter(row => row.direction === 'outbound' && row.sender_type === 'assistant').length,
    delivery_attempts: world.tables.conversation_turn_delivery_attempts.length,
  };
}
const noEffects = e => e.sends === 0 && e.leads === 0 && e.commercial_rpcs === 0 && e.outbound_events === 0 && e.delivery_attempts === 0;
const queueOf = world => world.tables.conversation_turn_queue.find(row => row.chat_id === exec.CHAT_ID) || null;

// Runs fn with CORE and/or EXT sources taken from other roots.
async function withRoots({ core = null, ext = null }, fn) {
  const saved = { core: process.env.HOMOLOG_CORE_SOURCE_ROOT, ext: process.env.HOMOLOG_EXT_SOURCE_ROOT };
  if (core) process.env.HOMOLOG_CORE_SOURCE_ROOT = core; else delete process.env.HOMOLOG_CORE_SOURCE_ROOT;
  if (ext) process.env.HOMOLOG_EXT_SOURCE_ROOT = ext; else delete process.env.HOMOLOG_EXT_SOURCE_ROOT;
  try { return await fn(); } finally {
    for (const [key, name] of [['core', 'HOMOLOG_CORE_SOURCE_ROOT'], ['ext', 'HOMOLOG_EXT_SOURCE_ROOT']]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
  }
}

// Evaluates the EXT's own function as written in the EXT source, so the EXT rule is tested exactly as deployed.
function extFunction(name) {
  const file = path.join(exec.sourceRootFor(exec.EXT_FILE), exec.EXT_FILE);
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node) return null;
  const context = vm.createContext({});
  vm.runInContext(node.getText(ast), context);
  return vm.runInContext(name, context);
}

// Runs the same single-turn scenario with a given decision adjustment and returns what the CORE did with it.
async function finaliseWith(tamperDecision) {
  const world = exec.createWorld({ mode: 'fixtures', geminiKey: null, settings, inventory: scenarios.inventory,
    scenarioResponses: { primary: [exec.cannedPrimaryBody({ reply: 'Quer conhecer a CG 160?', semantic_intent: { primary_intent: 'purchase', topics: ['inventory'], catalog: { requested: true, evidence_ids: ['in-1'] }, confidence: 'high' } })], other: [] } });
  let error = null, finalized = null;
  try { ({ finalized } = await exec.runCustomerTurn(world, 'Quero a CG 160.', 0, { tamperDecision })); } catch (caught) { error = String(caught.message || caught); }
  // The CORE isolates a turn failure: it is recorded on the turn and returned, not always thrown. Both are evidence.
  error = error || finalized?.error_code || world.log.failures.map(item => item.error).join(',') || null;
  return { error, world, ...effects(world) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot of the previous publication (P1-04). Explicit failure when it cannot be produced.
// ---------------------------------------------------------------------------------------------------------------------

function gitHead(file) {
  const out = cp.spawnSync('git', ['show', 'HEAD:' + file], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error('SNAPSHOT_UNAVAILABLE: git show HEAD:' + file + ' failed');
  return out.stdout;
}

function replaceOnce(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error('SNAPSHOT_UNAVAILABLE: ' + label + ' not found exactly once in the current source');
  return text.replace(from, to);
}

let snapshotCache = null;
async function previousSnapshot() {
  if (snapshotCache) return snapshotCache;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-previous-'));
  fs.mkdirSync(path.join(tmp, 'n8n', 'sources'), { recursive: true });
  const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
  const write = (file, text) => fs.writeFileSync(path.join(tmp, file), text);
  let origin;
  const provided = process.env.HOMOLOG_PREVIOUS_SOURCE_ROOT;
  if (provided) {
    for (const file of [exec.CORE_FILE, exec.EXT_FILE, exec.IDENTITY_FILE]) {
      const source = path.join(path.resolve(provided), file);
      if (!fs.existsSync(source)) throw new Error('SNAPSHOT_UNAVAILABLE: HOMOLOG_PREVIOUS_SOURCE_ROOT lacks ' + file);
      write(file, fs.readFileSync(source, 'utf8'));
    }
    origin = 'HOMOLOG_PREVIOUS_SOURCE_ROOT';
  } else {
    // The previous EXT identity is the one in git HEAD (it accepts only 1.0). CORE and EXT of HEAD predate the executor's
    // declarations, so they are the current files with their contract constants set back to the previous values.
    write(exec.IDENTITY_FILE, gitHead(exec.IDENTITY_FILE));
    write(exec.CORE_FILE, replaceOnce(replaceOnce(read(exec.CORE_FILE), "const NORIA_GENESIS_CONTRACT_VERSION = '2.0';", "const NORIA_GENESIS_CONTRACT_VERSION = '1.0';", 'CORE contract version'),
      "'genesis_extension_commercial_decide_v4'", "'genesis_extension_commercial_decide_v3'", 'CORE decision provenance'));
    write(exec.EXT_FILE, replaceOnce(replaceOnce(read(exec.EXT_FILE), "const NORIA_GENESIS_CONTRACT_VERSION = '2.0';", "const NORIA_GENESIS_CONTRACT_VERSION = '1.0';", 'EXT contract version'),
      "provenance: 'genesis_extension_commercial_decide_v4'", "provenance: 'genesis_extension_commercial_decide_v3'", 'EXT decision provenance'));
    origin = 'git HEAD identity + current CORE/EXT with contract constants reverted';
  }
  // The previous CORE workflow's router node, as published at git HEAD: the version it puts on the EXT identity request.
  const previousRouterVersion = await exec.routerContractVersion(gitHead(exec.CORE_WORKFLOW_FILE));
  // The previous CORE also lacked the cutover classification (a version refusal was a permanent failure).
  const clause = '\n      || (CONTRACT_CUTOVER_PATTERN.test(errorCode) && !sendAttempted);';
  const coreText = fs.readFileSync(path.join(tmp, exec.CORE_FILE), 'utf8');
  if (provided) { write('core.pre-fix.js', coreText); } else {
    write('core.pre-fix.js', replaceOnce(coreText, clause, ';', 'CORE cutover classification'));
  }
  const preFixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-previous-core-'));
  fs.mkdirSync(path.join(preFixRoot, 'n8n', 'sources'), { recursive: true });
  fs.copyFileSync(path.join(tmp, 'core.pre-fix.js'), path.join(preFixRoot, exec.CORE_FILE));
  for (const file of [exec.EXT_FILE, exec.IDENTITY_FILE]) fs.copyFileSync(path.join(tmp, file), path.join(preFixRoot, file));
  snapshotCache = { root: tmp, preFixCoreRoot: preFixRoot, origin, previousRouterVersion };
  return snapshotCache;
}

function cleanupSnapshots() {
  if (!snapshotCache) return;
  fs.rmSync(snapshotCache.root, { recursive: true, force: true });
  fs.rmSync(snapshotCache.preFixCoreRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------------

async function main() {
  // P1-01: a contract that does not validate changes neither the intent nor the transaction mode.
  {
    const r = await run(byName('P1-01'));
    const after = r.steps[1]?.state || {};
    record('P1-01', 'invalid contract keeps the persisted intent and transaction mode',
      after.lead_state_intent === 'buy' && after.lead_state_transaction_mode === 'buy' && !r.steps[1].stopped,
      { intent: after.lead_state_intent, transaction_mode: after.lead_state_transaction_mode, stopped: r.steps[1].stopped || null });
  }

  // P1-02: evidence from an earlier message identifies a product, but does not authorise a new selection.
  {
    const currentTurnSemantic = extFunction('currentTurnSemantic');
    const semantic = { valid: true, references: { product_role: 'selected', evidence_ids: ['in-1'], product_references: [{ product_id: 'p', role: 'selected', evidence_ids: ['in-1'] }] },
      customer_disposition: { value: 'active', evidence_ids: [] }, offer_response: { value: 'none', evidence_ids: [], offer_ref: '' } };
    const oldOnly = currentTurnSemantic ? currentTurnSemantic(semantic, [{ id: 'in-2', event_id: 'in-2' }]) : null;
    const currentToo = currentTurnSemantic ? currentTurnSemantic(semantic, [{ id: 'in-1', event_id: 'in-1' }]) : null;
    const r = await run(byName('P1-02 '));
    // Three turns: (1) the product is identified (mentioned) with current evidence; (2) a message with no new choice carries
    // only the old evidence, now marked as a selection by the model: no commercial selection; (3) the customer really picks it.
    const three = await run(byName('P1-02b'));
    const picked = three.steps.map(step => step.state?.lead_product_id ?? null);
    const turn1Reply = three.steps[0]?.state?.outbound_texts?.at(-1) || '';
    record('P1-02', 'an old message cannot select a product; the same product is selected only with current evidence',
      Boolean(currentTurnSemantic) && oldOnly.references.product_role === 'mentioned' && oldOnly.references.product_references[0].role === 'mentioned'
      && currentToo.references.product_role === 'selected' && (r.steps[1]?.state.lead_product_id ?? '') === ''
      && three.steps.length === 3 && !three.steps.some(step => step.stopped) && !three.failures.length
      && picked[0] === '' && picked[1] === '' && picked[2] === 'honda|cg160|2018|' && /CG 160/.test(turn1Reply),
      { ext_guard_declared: Boolean(currentTurnSemantic), ext_old_role: oldOnly?.references.product_role ?? null, ext_current_role: currentToo?.references.product_role ?? null,
        product_after_turns: picked, turn1_reply_identifies_product: /CG 160/.test(turn1Reply), stopped: three.steps.find(step => step.stopped)?.stopped || null });
  }

  // P1-03: the Gemini contract identifies the disposition; the EXT policy decides what happens to pending follow-ups; the CORE executes.
  {
    const job = world => world.tables.follow_up_jobs.push({ id: 'job-1', tenant_id: exec.TENANT_ID, channel_type: 'whatsapp', external_conversation_id: exec.CHAT_ID, status: 'pending' });
    const withActions = actions => { const copy = clone(settings); copy.sales_follow_up = { ...copy.sales_follow_up, disposition_actions: actions }; return copy; };
    const cases = [
      // Without a configured policy no disposition cancels anything: the EXT has no built-in commercial action.
      ['declined', 'P1-03 ', null, 'pending', 'undecided'],
      ['closed_by_customer', 'P1-03c', null, 'pending', 'undecided'],
      ['deferred_by_customer', 'P1-03b', null, 'pending', 'undecided'],
      // With the tenant policy the EXT authorises and the CORE executes.
      ['declined', 'P1-03 ', { declined: 'cancel' }, 'cancelled', 'cancel'],
      ['closed_by_customer', 'P1-03c', { closed_by_customer: 'cancel' }, 'cancelled', 'cancel'],
      ['deferred_by_customer', 'P1-03b', { deferred_by_customer: 'cancel' }, 'cancelled', 'cancel'],
      ['deferred_by_customer', 'P1-03b', { deferred_by_customer: 'keep' }, 'pending', 'keep'],
      ['declined', 'P1-03 ', { declined: 'keep' }, 'pending', 'keep'],
      // A value the EXT does not define is ignored, not interpreted.
      ['deferred_by_customer', 'P1-03b', { deferred_by_customer: 'reschedule' }, 'pending', 'undecided'],
      // A policy for another disposition does not leak into this one.
      ['declined', 'P1-03 ', { closed_by_customer: 'cancel' }, 'pending', 'undecided'],
    ];
    const observed = [];
    for (const [disposition, prefix, actions, expectedJob, expectedAction] of cases) {
      const r = await run(byName(prefix), { settings: actions ? withActions(actions) : settings, seed: job });
      const outbound = r.world.tables.channel_events.filter(row => row.direction === 'outbound' && row.sender_type === 'assistant').at(-1);
      observed.push({ disposition, policy: actions, disposition_recorded: r.steps.at(-1)?.state.follow_up_disposition, job: r.world.tables.follow_up_jobs[0]?.status, action: outbound?.raw_payload?.follow_up_policy_action ?? null,
        ok: r.steps.at(-1)?.state.follow_up_disposition === disposition && r.world.tables.follow_up_jobs[0]?.status === expectedJob && outbound?.raw_payload?.follow_up_policy_action === expectedAction });
    }
    // The CORE cancels nothing the EXT did not authorise: even with a tenant policy, a decision that arrives without it leaves the job pending.
    const stripped = await run(byName('P1-03 '), { settings: withActions({ declined: 'cancel' }), seed: job, turnOptions: { tamperDecision: d => ({ ...d, commercial_decision: { ...d.commercial_decision, follow_up_policy: undefined } }) } });
    const strippedJob = stripped.world.tables.follow_up_jobs[0]?.status;
    // Operational cancellation is not a commercial disposition: a human handoff still cancels the pending job, with no policy configured.
    const handoff = await run({ name: 'handoff', turns: [
      { text: 'Quero a CG 160.', gemini: { reply: 'Temos a CG 160.', semantic_intent: { primary_intent: 'purchase', topics: ['inventory'], catalog: { requested: true, evidence_ids: ['in-1'] }, confidence: 'high' } } },
      { text: 'Quero falar com um atendente.', gemini: { reply: 'Certo.', dialogue_plan: { human_requested: true, handoff_reason: 'human_requested' },
        semantic_intent: { primary_intent: 'human_handoff', topics: ['human'], confidence: 'high' } } }] }, { seed: job });
    const handoffJob = handoff.world.tables.follow_up_jobs[0]?.status;
    // The EXT policy for the three dispositions, read from the EXT function as deployed.
    const policyFn = extFunction('followUpDispositionPolicy');
    const policy = policyFn ? policyFn(settings) : null;
    record('P1-03', 'declined, closed_by_customer and deferred_by_customer are applied through the EXT follow-up policy; the CORE only executes it',
      observed.every(item => item.ok) && handoffJob === 'cancelled' && strippedJob === 'pending' && Object.values(policy?.actions || {}).length === 3 && Object.values(policy.actions).every(value => value === 'undecided'),
      { observed, job_when_decision_has_no_policy: strippedJob, job_after_human_handoff: handoffJob, ext_default_actions: policy?.actions ?? null });
  }

  // P1-04: a CORE and an EXT of different versions never execute a commercial action or a send.
  {
    let detail, ok = false;
    try {
      const snap = await previousSnapshot();
      const one = byName('S0');
      const current = await run(one);
      const currentOk = current.steps[0]?.decision_status === 'ok' && effects(current.world).sends === 1 && current.steps[0]?.final?.ok === true;
      // 1. CORE new + EXT old. The router of the new CORE sends 2.0 to the previous EXT identity.
      const newCoreOldExt = await withRoots({ ext: snap.root }, () => run(one));
      // 2. CORE old + EXT new, through the previous CORE's own router (1.0) to the new EXT identity.
      const oldCoreNewExt = await withRoots({ core: snap.preFixCoreRoot }, () => run(one, { turnOptions: { routerVersion: snap.previousRouterVersion } }));
      // 2b. EXT replaced between the bootstrap and the decision: the previous CORE asks the new EXT to decide with 1.0.
      const oldCoreDecision = await withRoots({ core: snap.preFixCoreRoot }, () => run(one, { turnOptions: { routerVersion: '2.0' } }));
      // 3. Decisions of another provenance or version presented to the current CORE.
      const tampered = {
        provenance_v3: await finaliseWith(d => ({ ...d, commercial_decision: { ...d.commercial_decision, provenance: 'genesis_extension_commercial_decide_v3' } })),
        contract_version_1: await finaliseWith(d => ({ ...d, commercial_decision: { ...d.commercial_decision, noria_contract_version: '1.0' } })),
      };
      const runs = { new_core_old_ext: newCoreOldExt, old_core_new_ext: oldCoreNewExt, old_core_decision_with_new_ext: oldCoreDecision };
      const refused = Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, { refusal: refusal(value), ...effects(value.world) }]));
      const tamperedSummary = Object.fromEntries(Object.entries(tampered).map(([key, value]) => [key, { refusal: value.error, sends: value.sends, leads: value.leads, outbound_events: value.outbound_events }]));
      ok = currentOk
        && /NORIA_EXTENSAO_TENANT_INCORRETO/.test(refused.new_core_old_ext.refusal) && noEffects(refused.new_core_old_ext)
        && /NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH/.test(refused.old_core_new_ext.refusal) && noEffects(refused.old_core_new_ext)
        && /COMMERCIAL_CONTRACT_VERSION_MISMATCH/.test(refused.old_core_decision_with_new_ext.refusal)
        && refused.old_core_decision_with_new_ext.sends === 0 && refused.old_core_decision_with_new_ext.leads === 0 && refused.old_core_decision_with_new_ext.delivery_attempts === 0
        && Object.values(tampered).every(item => /COMMERCIAL_DECISION_PROVENANCE_INVALID/.test(item.error || '') && item.sends === 0 && item.leads === 0 && item.outbound_events === 0);
      detail = { snapshot: snap.origin, previous_router_version: snap.previousRouterVersion, new_core_new_ext: { decision: current.steps[0]?.decision_status, sends: effects(current.world).sends }, mixed: refused, tampered: tamperedSummary };
    } catch (error) {
      detail = { error: String(error.message || error) };
    }
    record('P1-04', 'versions mixed in every direction, and a tampered provenance or version, are refused before any commercial effect or send', ok, detail);
  }

  // P1-04 wiring: the version the CORE workflow router puts on the EXT identity request is the version the identity accepts.
  {
    let detail, ok = false;
    try {
      const gen = await exec.routerContractVersion();
      const accepted = await run(byName('S0'));
      ok = gen === '2.0' && accepted.steps[0]?.decision_status === 'ok' && !accepted.steps[0].stopped;
      detail = { router_version_for_genesis: gen, identity_accepts: ok };
    } catch (error) { detail = { error: String(error.message || error) }; }
    record('P1-04w', 'the CORE workflow router sends the contract version the Gênesis EXT identity accepts', ok, detail);
  }

  // Cutover recovery (P1-04): what the real queue contract does when the publication gap hits a claimed turn.
  {
    let detail, ok = false, failedTerms = [];
    try {
      const snap = await previousSnapshot();
      const one = byName('S0');
      const retries = [];
      // CORE published first: the new CORE meets the previous EXT. The turn is refused before any effect and goes back to the queue.
      const first = await withRoots({ ext: snap.root }, () => run(one, { turnOptions: { continueOnExtError: true } }));
      const world = first.world;
      const q1 = clone(queueOf(world));
      const afterFirst = { phase: q1.phase, attempt_count: q1.attempt_count, next_attempt_at_set: Boolean(q1.next_attempt_at), claimed_event_ids: (q1.claimed || []).map(item => item.event_id), error: q1.last_error_code, ...effects(world) };
      // The deploy finishes. The retry backoff elapses (the simulator has no clock), the queue is claimed again, and the turn runs on matching versions.
      queueOf(world).next_attempt_at = new Date(Date.now() - 1000).toISOString();
      const claim = exec.RPC.magia_claim_turn(world, { p_tenant: exec.TENANT_ID, p_chat: exec.CHAT_ID });
      world.responses.primary.push(exec.cannedPrimaryBody({ reply: 'Olá! Como posso ajudar?' }));
      let resumed = null, resumeError = null;
      try { resumed = await exec.runCustomerTurn(world, 'Oi', 0, { resume: true }); } catch (error) { resumeError = String(error.message || error); }
      const q2 = clone(queueOf(world));
      const afterRecovery = { claimed: claim.claimed, claim_attempt_count: claim.attempt_count, message_ids: (claim.messages || []).map(item => item.event_id), finalized_ok: resumed?.finalized?.ok ?? null,
        phase: q2.phase, token: q2.token, claimed_left: (q2.claimed || []).length, error: resumeError, ...effects(world) };
      retries.push(afterRecovery);

      // Bootstrap mismatch, before magia_claim_turn: the first Execute (EXT identity) refuses and nothing touches the queue.
      const w0 = exec.createWorld({ mode: 'fixtures', geminiKey: null, settings, inventory: scenarios.inventory, scenarioResponses: { primary: [], other: [] } });
      w0.tables.conversation_turn_queue.push({ tenant_id: exec.TENANT_ID, channel_type: 'whatsapp', chat_id: exec.CHAT_ID, phase: 'ready', token: null, claimed: [], pending: [{ event_id: 'in-1' }], retry_batch_id: null, attempt_count: 0 });
      const queueBefore = JSON.stringify(queueOf(w0));
      // The recovery trigger fires every 10 s: repeat the refusal as it would repeat during a long gap.
      let bootstrapRefusal = null, refusals = 0;
      await withRoots({ ext: snap.root }, async () => {
        for (let cycle = 0; cycle < 6; cycle += 1) {
          try { await exec.runNode(exec.IDENTITY_FILE, { json: { tenant_slug: 'wesley_automoveis', tenant_id: exec.TENANT_ID, instance: 'homolog', remoteJid: exec.CHAT_ID, noria_extension: 'genesis', noria_contract_version: '2.0' }, world: w0 }); }
          catch (error) { bootstrapRefusal = String(error.message); refusals += 1; }
        }
      });
      const bootstrap = { refusal: bootstrapRefusal, refusals, queue_unchanged: JSON.stringify(queueOf(w0)) === queueBefore, attempt_count: queueOf(w0).attempt_count, writes: w0.log.writes.length, rpcs: w0.log.writes.filter(item => item.rpc).length, sends: w0.log.simulated_sends.length };

      // The gap outlasts the retry budget: the turn stops in review, with no send and no delivery attempt.
      const budget = await withRoots({ ext: snap.root }, async () => {
        const w = (await run(one, { turnOptions: { continueOnExtError: true } })).world;
        for (let attempt = 2; attempt <= 3; attempt += 1) {
          queueOf(w).next_attempt_at = new Date(Date.now() - 1000).toISOString();
          const c = exec.RPC.magia_claim_turn(w, { p_tenant: exec.TENANT_ID, p_chat: exec.CHAT_ID });
          if (!c.claimed) break;
          w.responses.primary.push(exec.cannedPrimaryBody({}));
          await exec.runCustomerTurn(w, 'Oi', 0, { resume: true, continueOnExtError: true });
        }
        const exhausted = exec.RPC.magia_claim_turn(w, { p_tenant: exec.TENANT_ID, p_chat: exec.CHAT_ID });
        return { phase: queueOf(w).phase, last_error: queueOf(w).last_error_code, attempt_count: queueOf(w).attempt_count, next_claim: exhausted, ...effects(w) };
      });

      // EXT published first (the order the previous runbook gave): the previous CORE has no cutover classification, so the refusal is permanent.
      const extFirst = await withRoots({ core: snap.preFixCoreRoot }, () => run(one, { turnOptions: { routerVersion: '2.0', continueOnExtError: true } }));
      const qExtFirst = queueOf(extFirst.world);

      // A turn already past delivery is never restarted by this path: with an open attempt a failure is `uncertain`.
      const decisionSwap = await finaliseWith(d => ({ ...d, commercial_decision: { ...d.commercial_decision, provenance: 'genesis_extension_commercial_decide_v3' } }));
      const qSwap = queueOf(decisionSwap.world);

      const terms = {
        bootstrap_mismatch_before_claim_leaves_message_pending: /NORIA_EXTENSAO_TENANT_INCORRETO/.test(bootstrap.refusal || '') && bootstrap.refusals === 6 && bootstrap.queue_unchanged && bootstrap.attempt_count === 0 && bootstrap.writes === 0 && bootstrap.sends === 0,
        first_back_in_queue: afterFirst.phase === 'ready' && afterFirst.attempt_count === 1 && afterFirst.next_attempt_at_set && afterFirst.claimed_event_ids.join() === 'in-1',
        first_no_effects: afterFirst.sends === 0 && afterFirst.leads === 0 && afterFirst.delivery_attempts === 0 && afterFirst.outbound_events === 0,
        reclaimed_same_messages: afterRecovery.claimed === true && afterRecovery.claim_attempt_count === 2 && afterRecovery.message_ids.join() === 'in-1',
        delivered_once: afterRecovery.finalized_ok === true && afterRecovery.sends === 1 && afterRecovery.outbound_events === 1 && afterRecovery.delivery_attempts === 1,
        queue_cleared: afterRecovery.phase === 'ready' && afterRecovery.token === null && afterRecovery.claimed_left === 0,
        budget_exhausted_to_review: budget.phase === 'review' && budget.last_error !== null && budget.next_claim.claimed === false,
        budget_no_effects: budget.sends === 0 && budget.delivery_attempts === 0 && budget.leads === 0,
        ext_first_is_permanent_review: qExtFirst.phase === 'review' && /COMMERCIAL_CONTRACT_VERSION_MISMATCH/.test(qExtFirst.last_error_code || ''),
        mid_turn_swap_retryable_no_effects: qSwap.phase === 'ready' && decisionSwap.sends === 0 && decisionSwap.leads === 0 && decisionSwap.delivery_attempts === 0,
      };
      ok = Object.values(terms).every(Boolean);
      failedTerms = Object.entries(terms).filter(([, value]) => !value).map(([key]) => key);
      detail = { failed_terms: failedTerms, bootstrap_before_claim: bootstrap, core_first_gap: afterFirst, after_deploy_completes: afterRecovery, gap_outlasts_retry_budget: budget,
        ext_first_gap_with_previous_core: { phase: qExtFirst.phase, last_error: qExtFirst.last_error_code, ...effects(extFirst.world) },
        decision_swapped_mid_turn_with_current_core: { phase: qSwap.phase, last_error: qSwap.last_error_code, sends: decisionSwap.sends, leads: decisionSwap.leads } };
    } catch (error) { detail = { error: String(error.stack || error.message || error).slice(0, 600) }; }
    record('P1-04r', 'cutover gap: refusal before the claim leaves the message pending; after the claim the turn returns to the queue without loss or duplication, and stops in review once the retry budget is spent', ok, detail);
  }

  // P1-05: the executor walks the real pipeline, stops on a missing dependency, blocks every external effect and follows the published queue contract.
  {
    const walk = await run(byName('P1-01'));
    const step = walk.steps[0];
    const walked = step.decision_status === 'ok' && step.final?.ok === true && step.state.delivery_confirmed === true && step.state.simulated_sends === 1
      && queueOf(walk.world)?.phase === 'ready' && queueOf(walk.world)?.token === null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-missing-'));
    fs.mkdirSync(path.join(tmp, 'n8n', 'sources'), { recursive: true });
    const coreSource = fs.readFileSync(path.join(exec.sourceRootFor(exec.CORE_FILE), exec.CORE_FILE), 'utf8').replace('function salesGenerate(', 'function salesGenerateRemoved(');
    fs.writeFileSync(path.join(tmp, exec.CORE_FILE), coreSource);
    process.env.HOMOLOG_CORE_SOURCE_ROOT = tmp;
    let missingMessage = null;
    try { exec.assertDeclarations(exec.CORE_FILE); } catch (error) { missingMessage = String(error.message); }
    delete process.env.HOMOLOG_CORE_SOURCE_ROOT;
    fs.rmSync(tmp, { recursive: true, force: true });
    const world = exec.createWorld({ mode: 'fixtures', geminiKey: null, settings, inventory: scenarios.inventory, scenarioResponses: { primary: [], other: [] } });
    const http = exec.makeHttpRequest(world);
    const attempt = async options => { try { await http(options); return 'allowed'; } catch (error) { return String(error.message).split(':')[0]; } };
    const unknownTable = await attempt({ method: 'GET', url: 'https://homolog-supabase.invalid/rest/v1/tabela_inexistente' });
    const unknownRpc = await attempt({ method: 'POST', url: 'https://homolog-supabase.invalid/rest/v1/rpc/magia_inexistente' });
    const externalWhatsApp = await attempt({ method: 'POST', url: 'https://graph.facebook.com/v20.0/message' });
    const externalSupabase = await attempt({ method: 'GET', url: 'https://example-project.supabase.co/rest/v1/tenants' });
    const countTokens = await attempt({ method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:countTokens', body: {} });
    const env = { ...process.env };
    delete env.HOMOLOG_GEMINI_AUTHORIZED; delete env.HOMOLOG_GEMINI_KEY;
    const real = cp.spawnSync(process.execPath, [path.join(__dirname, 'genesis_executor.cjs'), '--mode=real'], { env, encoding: 'utf8' });
    const gated = real.status !== 0 && /REAL_MODE_NOT_AUTHORIZED/.test(real.stderr + real.stdout);
    const blocked = unknownTable === 'HOMOLOG_MISSING_DEPENDENCY' && unknownRpc === 'HOMOLOG_MISSING_DEPENDENCY'
      && externalWhatsApp === 'HOMOLOG_BLOCKED' && externalSupabase === 'HOMOLOG_BLOCKED' && countTokens === 'HOMOLOG_BLOCKED';
    record('P1-05', 'executor walks prepare, EXT decision, finalize and delivery; stops on missing dependencies; blocks external effects',
      walked && /HOMOLOG_MISSING_DEPENDENCY/.test(missingMessage || '') && blocked && gated,
      { walked_chain: walked, missing_declaration: missingMessage ? missingMessage.slice(0, 100) : null,
        transport: { unknownTable, unknownRpc, externalWhatsApp, externalSupabase, countTokens }, real_mode_gate: gated });
  }

  // P1-05 fidelity: the simulated lifecycle RPCs follow the transitions of the functions published in Supabase.
  {
    const T = exec.TENANT_ID, C = exec.CHAT_ID;
    const fresh = (overrides = {}) => {
      const w = exec.createWorld({ mode: 'fixtures', geminiKey: null, settings, inventory: scenarios.inventory, scenarioResponses: { primary: [], other: [] } });
      w.tables.conversation_turn_queue.push({ tenant_id: T, channel_type: 'whatsapp', chat_id: C, token: 'tok', phase: 'processing', boundary_id: 'initial', claimed: [{ event_id: 'e1' }], pending: [],
        retry_batch_id: 'b1', attempt_count: 1, retry_max_attempts: 3, retry_base_seconds: 30, retry_cap_seconds: 900, current_delivery_id: null, next_attempt_at: null, last_error_code: null,
        review_required_at: null, lease_until: new Date(Date.now() + 120000).toISOString(), ...overrides });
      return w;
    };
    const P = (extra = {}) => ({ p_tenant: T, p_chat: C, p_token: 'tok', ...extra });
    const throws = fn => { try { fn(); return null; } catch (error) { return error.response?.data?.message || String(error.message); } };
    const R = exec.RPC;
    const checks = {};
    // commit: only from processing, with a live lease; it moves the turn to sending.
    { const w = fresh(); const a = R.magia_commit_turn(w, P()); const again = R.magia_commit_turn(w, P());
      checks.commit_processing_to_sending = a.committed === true && queueOf(w).phase === 'sending' && again.committed === false && again.reason === 'lost_lease'; }
    { const w = fresh({ lease_until: new Date(Date.now() - 1000).toISOString() }); checks.commit_expired_lease = R.magia_commit_turn(w, P()).reason === 'lost_lease'; }
    { const w = fresh({ pending: [{ event_id: 'e2' }] }); const r = R.magia_commit_turn(w, P()); checks.commit_new_messages = r.committed === false && r.reason === 'new_messages' && queueOf(w).phase === 'processing'; }
    // begin: only from sending, once.
    { const w = fresh(); checks.begin_requires_sending = throws(() => R.magia_begin_turn_delivery(w, P())) === 'STALE_DELIVERY_ATTEMPT';
      R.magia_commit_turn(w, P()); const b = R.magia_begin_turn_delivery(w, P()); const again = R.magia_begin_turn_delivery(w, P());
      checks.begin_once = b.dispatch_allowed === true && queueOf(w).current_delivery_id === b.id && again.dispatch_allowed === false && again.reason === 'delivery_already_started' && w.tables.conversation_turn_delivery_attempts.length === 1; }
    // confirm: attempt, event, provider id and receipt must agree.
    { const w = fresh(); R.magia_commit_turn(w, P()); const b = R.magia_begin_turn_delivery(w, P());
      const event = (extra = {}) => { const row = { id: 'ev-' + (++w.seq), tenant_id: T, channel_type: 'whatsapp', external_conversation_id: C, direction: 'outbound', sender_type: 'assistant', external_message_id: 'MSG-1', raw_payload: { delivery_attempt_id: b.id }, ...extra }; w.tables.channel_events.push(row); return row; };
      const wrongProvider = event({ external_message_id: 'OTHER' }), wrongAttempt = event({ raw_payload: { delivery_attempt_id: 'another' } }), wrongSender = event({ sender_type: 'system' }), good = event();
      const conf = (e, extra = {}) => R.magia_confirm_turn_delivery(w, P({ p_attempt: b.id, p_provider_message: 'MSG-1', p_outbound_event: e.id, ...extra }));
      checks.confirm_rejects_mismatches = [wrongProvider, wrongAttempt, wrongSender].every(e => conf(e).reason === 'delivery_evidence_mismatch')
        && conf(good, { p_attempt: 'other-attempt' }).reason === 'stale_delivery' && conf(good, { p_token: 'wrong' }).reason === 'stale_delivery' && conf(good, { p_provider_message: '' }).reason === 'delivery_evidence_mismatch';
      // finish done before confirmation must reconcile; after confirmation it clears the queue.
      checks.finish_done_needs_confirmation = throws(() => R.magia_finish_turn(w, P({ p_outcome: 'done' }))) === 'DELIVERY_RECONCILIATION_REQUIRED' && queueOf(w).phase === 'sending';
      const ok = conf(good); const fin = R.magia_finish_turn(w, P({ p_outcome: 'done' }));
      checks.confirm_then_finish = ok.confirmed === true && fin.finished === true && fin.outcome === 'done' && queueOf(w).phase === 'ready' && queueOf(w).token === null && queueOf(w).current_delivery_id === null; }
    // finish without any delivery: unresolved turns need review; terminal evidence is not available to the simulator.
    { const w = fresh(); checks.finish_done_in_processing = throws(() => R.magia_finish_turn(w, P({ p_outcome: 'done' }))) === 'UNRESOLVED_TURN_REQUIRES_REVIEW'; }
    { const w = fresh(); R.magia_commit_turn(w, P()); const r = R.magia_finish_turn(w, P({ p_outcome: 'cancelled' })); checks.finish_without_evidence_fails_turn = r.outcome === 'review' && /permanent/.test(r.reason) && queueOf(w).last_error_code === 'TERMINAL_EVIDENCE_MISSING:cancelled'; }
    { const w = fresh(); checks.finish_invalid_outcome = throws(() => R.magia_finish_turn(w, P({ p_outcome: 'bogus' }))) === 'Invalid outcome';
      checks.finish_retry_after_commit = (R.magia_commit_turn(w, P()), throws(() => R.magia_finish_turn(w, P({ p_outcome: 'retry' })))) === 'Cannot retry committed turn'; }
    { const w = fresh({ pending: [{ event_id: 'e2' }] }); const r = R.magia_finish_turn(w, P({ p_outcome: 'retry' })); checks.finish_retry_coalesces = r.reason === 'new_messages_coalesced' && r.retry_queued === true && queueOf(w).phase === 'ready' && queueOf(w).attempt_count === 0; }
    // fail: retry with backoff, budget, permanent failure, delivery attempt => uncertain, and idempotence on held turns.
    { const w = fresh(); const r = R.magia_fail_turn(w, P({ p_error: 'x', p_retryable: true })); const q = queueOf(w);
      checks.fail_retryable_ready = r.outcome === 'ready' && r.retry_queued === true && q.phase === 'ready' && Date.parse(q.next_attempt_at) > Date.now() && q.claimed.length === 1 && q.token === 'tok'; }
    { const w = fresh({ attempt_count: 3 }); const r = R.magia_fail_turn(w, P({ p_error: 'x', p_retryable: true })); checks.fail_budget_exhausted = r.outcome === 'review' && r.reason === 'retry_budget_exhausted'; }
    { const w = fresh(); const r = R.magia_fail_turn(w, P({ p_error: 'x', p_retryable: false })); checks.fail_permanent_review = r.outcome === 'review' && r.reason === 'permanent_or_unclassified_failure'; }
    { const w = fresh({ retry_batch_id: null }); const r = R.magia_fail_turn(w, P({ p_error: 'x', p_retryable: true })); checks.fail_untracked_batch_review = r.outcome === 'review' && r.reason === 'legacy_untracked_batch'; }
    { const w = fresh(); R.magia_commit_turn(w, P()); R.magia_begin_turn_delivery(w, P());
      const r = R.magia_fail_turn(w, P({ p_error: 'provider timeout', p_retryable: true }));
      const claim = R.magia_claim_turn(w, { p_tenant: T, p_chat: C });
      const again = R.magia_fail_turn(w, P({ p_error: 'later', p_retryable: true }));
      checks.fail_after_attempt_is_uncertain = r.outcome === 'uncertain' && r.retry_queued === false && w.tables.conversation_turn_delivery_attempts[0].status === 'uncertain'
        && claim.claimed === false && claim.reason === 'delivery_uncertain' && again.outcome === 'uncertain' && queueOf(w).last_error_code === 'provider timeout'
        && throws(() => R.magia_finish_turn(w, P({ p_outcome: 'done' }))) === 'DELIVERY_RECONCILIATION_REQUIRED'; }
    { const w = fresh(); const r = R.magia_fail_turn(w, P({ p_token: 'stale', p_error: 'x' })); checks.fail_stale_token = r.finished === false && r.reason === 'stale_token'; }
    const failedChecks = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
    record('P1-05f', 'simulated commit, begin, confirm, finish and fail follow the transitions of the published Supabase functions', failedChecks.length === 0 && Object.keys(checks).length >= 15,
      { checked: Object.keys(checks).length, failed: failedChecks });
  }

  cleanupSnapshots();
  let failed = 0;
  for (const item of results) {
    if (!item.ok) failed += 1;
    console.log((item.ok ? 'PASS ' : 'FAIL ') + item.id + '  ' + item.name);
    console.log('       ' + JSON.stringify(item.detail).slice(0, 1400));
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' P1 behavioural checks pass.');
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { cleanupSnapshots(); console.error(error.stack || error.message); process.exitCode = 2; });
