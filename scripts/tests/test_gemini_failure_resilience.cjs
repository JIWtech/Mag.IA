const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../app/node_modules/typescript');

const root = path.resolve(__dirname, '../..');
const workflowFile = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const generatedFile = path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js');
const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
const node = workflow.nodes.find(item => item.name === 'CORE | Motor conversacional único');
const code = node.parameters.jsCode;
const ast = ts.createSourceFile('core.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(item => [item.name.text, item.getText(ast)]));

function httpHarness(sequence, attempts = 2, envOverrides = {}) {
  const calls = [];
  const shared = {};
  const context = {
    Math,
    Date,
    JSON,
    Buffer,
    URL,
    turn: null,
    chatId: 'chat-test',
    tenantSlug: 'tenant-test',
    todayKey: () => '2026-10-14',
    $getWorkflowStaticData: () => shared,
    setTimeout: (resolve) => resolve(),
    env: (name, fallback) => Object.prototype.hasOwnProperty.call(envOverrides, name)
      ? String(envOverrides[name]) : name === 'GEMINI_RETRY_MAX_ATTEMPTS' ? String(attempts) : fallback,
    helpers: { httpRequest: async request => {
      calls.push(request);
      const next = sequence[Math.min(calls.length - 1, sequence.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    } },
  };
  vm.createContext(context);
  const functionNames = [
    'httpHeaderValue', 'httpErrorHeaders', 'httpProviderBody', 'httpDurationMs', 'httpRetryAfterMs',
    'httpSafeDiagnostic', 'getSharedRuntimeState', 'checkGeminiCircuitBreaker',
    'geminiRateConfig', 'estimateGeminiTokens', 'geminiRateRpc', 'geminiControlError',
    'recordGeminiCircuitFailure', 'recordGeminiSuccess', 'markGeminiPhysicalUsage', 'acquireGeminiConcurrencySlot',
    'releaseGeminiConcurrencySlot', 'httpGeminiMetadata', 'httpJson'
  ];
  for (const name of functionNames) {
    if (functions.has(name)) {
      vm.runInContext(`${functions.get(name)};this.${name}=${name}`, context);
    }
  }
  return { context, calls, shared };
}

function providerError(status, providerStatus, headers = {}, details = []) {
  const error = new Error('provider body must never be persisted');
  error.statusCode = status;
  error.response = { statusCode: status, headers, body: { error: { code: status, status: providerStatus, message: 'private upstream text', details } } };
  return error;
}

async function geminiCall(harness, options = {}) {
  return harness.context.httpJson('POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    { 'x-goog-api-key': 'never-log-this' }, { contents: [] }, options);
}

function scheduleHarness(event, settings = {}) {
  const calls = [];
  const context = {
    event,
    settingsFor: () => ({ follow_up_enabled: true, sales_follow_up: { enabled: true }, ...settings }),
    salesEnabled: () => true,
    cancelPendingFollowUps: async () => calls.push('cancel'),
    httpJson: async (...args) => { calls.push(args); return 3; },
    supabaseUrl: value => `https://db.test${value}`,
    supabaseHeaders: () => ({}),
    chatId: 'chat', firstName: 'Cliente', turn: { messages: [{ name: 'Cliente' }] },
  };
  vm.createContext(context);
  vm.runInContext(`${functions.get('scheduleFollowUps')};this.scheduleFollowUps=scheduleFollowUps`, context);
  return { context, calls };
}

test('1 greeting is deterministic and does not require Gemini', () => {
  assert.match(code, /deterministic_reply:'simple_greeting'/);
  assert.match(code, /!deterministicSimpleReply/);
});

test('2 HTTP 429 is normalized as retryable rate limit', async () => {
  const h = httpHarness([providerError(429, 'RESOURCE_EXHAUSTED')], 1);
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_RATE_LIMIT'
    && error.diagnostic.category === 'rate_limit' && error.diagnostic.retryable === true);
});

test('3 Retry-After is preserved and the opened circuit suppresses an immediate retry', async () => {
  const h = httpHarness([providerError(429, 'RESOURCE_EXHAUSTED', { 'retry-after': '0.001' }), { ok: true }], 2);
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_RATE_LIMIT');
  assert.equal(h.calls.length, 1);
});

test('4 429 without Retry-After opens the circuit and does not amplify calls', async () => {
  const h = httpHarness([providerError(429, 'RESOURCE_EXHAUSTED'), { ok: true }], 2);
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_RATE_LIMIT'
    && error.diagnostic.reason === 'local_circuit_breaker_active');
  assert.equal(h.calls.length, 1);
});

test('5 HTTP 401 and 403 are not retried', async () => {
  for (const [status, providerStatus, expected] of [[401, 'UNAUTHENTICATED', 'authentication'], [403, 'PERMISSION_DENIED', 'permission']]) {
    const h = httpHarness([providerError(status, providerStatus)], 3);
    await assert.rejects(geminiCall(h), error => error.diagnostic.category === expected);
    assert.equal(h.calls.length, 1);
  }
});

test('6 HTTP 500 and 503 retry once and recover', async () => {
  for (const status of [500, 503]) {
    const h = httpHarness([providerError(status, 'UNAVAILABLE'), { recovered: true }], 2);
    assert.deepEqual(await geminiCall(h), { recovered: true });
    assert.equal(h.calls.length, 2);
  }
});

test('7 timeout is normalized without leaking its message', async () => {
  const timeout = new Error('timeout with customer/private data'); timeout.code = 'ETIMEDOUT';
  const h = httpHarness([timeout], 1);
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_NETWORK_OR_TIMEOUT'
    && !JSON.stringify(error.diagnostic).includes('customer/private'));
});

test('8 invalid JSON cannot silently pass dialogue parsing', () => {
  assert.throws(() => JSON.parse('{invalid'), SyntaxError);
  assert.match(functions.get('salesDialogueJson'), /JSON\.parse/);
});

test('9 provider schema rejection is non-retryable and structured', async () => {
  const h = httpHarness([providerError(400, 'INVALID_ARGUMENT')], 3);
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_INVALID_REQUEST'
    && error.diagnostic.retryable === false);
  assert.equal(h.calls.length, 1);
});

test('10 retry attempt limit is enforced', async () => {
  const h = httpHarness([providerError(503, 'UNAVAILABLE')], 3);
  await assert.rejects(geminiCall(h), error => error.diagnostic.attempts === 3);
  assert.equal(h.calls.length, 3);
});

test('11 simultaneous calls keep independent attempt state', async () => {
  const a = httpHarness([providerError(503, 'UNAVAILABLE'), { id: 'a' }], 2);
  const b = httpHarness([providerError(503, 'UNAVAILABLE'), { id: 'b' }], 2);
  const values = await Promise.all([geminiCall(a), geminiCall(b)]);
  assert.deepEqual(values, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(a.calls.length, 2); assert.equal(b.calls.length, 2);
});

test('12 model and year state are preserved by failure merge', () => {
  assert.match(code, /state:salesMergeState\(lead\?\.state\|\|\{\},\{\}\),product:lead\?\.product\|\|null,technical_error:code/);
});

test('13 deferred vehicle photos remain deterministic and preserved', () => {
  assert.match(code, /deterministic_photo_deferral:true/);
  assert.match(code, /Continuamos a avaliação de onde paramos/);
});

test('14 spreadsheet price authority is delegated to the Genesis EXT', () => {
  assert.match(code, /genesis_sheet/);
  assert.match(code, /noria_business_context/);
  assert.doesNotMatch(code, /salesGenesisSheetPriceAuthorized|sheets\.googleapis\.com|\/gviz\//);
});

test('15 financing deposit state remains deterministic', () => {
  assert.match(code, /salesApplyDeterministicDepositState/);
  assert.match(code, /financing_threshold_cents/);
});

test('16 accepted human offer still enters real assignment path', () => {
  assert.match(code, /acceptedHumanOffer/);
  assert.match(code, /await salesAssignConversation/);
});

test('17 failed transfer never claims assignment completed', () => {
  assert.match(code, /Não consegui concluir a transferência agora/);
  assert.match(code, /recovered_by_human:Boolean\(saved\.ai_locked&&salesOwnAssignmentEventId\)/);
});

test('18 processing failure preserves lead state and disables registration', () => {
  assert.match(code, /stage=cfg\.stage_keys\.qualifying;register=false/);
  assert.match(code, /generated\.state=salesMergeState\(lead\?\.state\|\|\{\},\{\}\)/);
});

test('19 generation failure schedules no follow-up and causes no cancellation', async () => {
  const event = { service: 'sales_qualification', handoff: false, raw_payload: { generation_failure: { category: 'rate_limit' }, follow_up_disposition: 'awaiting_customer' } };
  const h = scheduleHarness(event);
  assert.equal(await h.context.scheduleFollowUps({}, { id: 'sent' }, event), 0);
  assert.deepEqual(h.calls, []);
});

test('20 legitimate awaiting-customer reply still schedules follow-up', async () => {
  const event = { service: 'sales_qualification', handoff: false, raw_payload: { follow_up_disposition: 'awaiting_customer' } };
  const h = scheduleHarness(event);
  assert.equal(await h.context.scheduleFollowUps({ tenant: { id: 'tenant' } }, { id: 'sent' }, event), 3);
  assert.equal(h.calls.length, 1);
});

test('21 human lock remains authoritative', () => {
  assert.match(code, /lead\?\.ai_locked\|\|control\.lockedByHuman/);
  assert.match(code, /human_lock:event\.handoff/);
});

test('22 Núbia policy remains isolated', () => {
  assert.match(code, /nb_bronze_v1/);
  assert.match(code, /groundingGuardNubiaFutureAppointment/);
});

test('23 Royal remains untouched and Genesis behavior stays behind its existing tenant gate', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/build/n8n/whatsapp_failure_resilience.cjs'), 'utf8');
  assert.doesNotMatch(source, /royal_4x4/i);
  assert.match(source, /tenantSlug==='wesley_automoveis'/);
  assert.doesNotMatch(source, /tenant_id\s*[:=]\s*['"][0-9a-f-]{36}/i);
});

test('24 generated code compiles as an n8n async body and workflow JSON is importable', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code));
  assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0);
  assert.ok(Object.keys(workflow.connections || {}).length > 0);
});

test('25 build output is idempotent and matches the workflow node', () => {
  const generated = fs.readFileSync(generatedFile, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(generated, code.replace(/\r\n/g, '\n'));
  assert.match(code, /conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14/);
});

test('diagnostics include provider identifiers and quota metric without secrets', async () => {
  const details = [{ violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests' }] }];
  const h = httpHarness([providerError(429, 'RESOURCE_EXHAUSTED', { 'x-goog-request-id': 'request-123' }, details)], 1);
  await assert.rejects(geminiCall(h, { operation: 'sales_generate' }), error => {
    assert.equal(error.diagnostic.provider_request_id, 'request-123');
    assert.equal(error.diagnostic.operation, 'sales_generate');
    assert.equal(error.diagnostic.model, 'gemini-3.5-flash-lite');
    assert.deepEqual([...error.diagnostic.quota_metrics], ['generativelanguage.googleapis.com/generate_content_requests']);
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /never-log-this|private upstream text/);
    return true;
  });
});

test('Gemini call amplification is bounded to generation plus one local-validated composition', () => {
  assert.match(code, /return \{\.\.\.plan,attempts:\[\{attempt:0,issues:\[\]\}\],semantic_source:/);
  assert.match(code, /for\(let i=0;i<1;i\+\+\)/);
  assert.doesNotMatch(code, /const review=await audit\(\{draft,plan,facts,execution\}\)/);
});

test('circuit breaker opens on persistent 429 and fails fast without extra HTTP calls', async () => {
  const details = [{ violations: [{ quotaMetric: 'generate_content_requests_per_minute' }] }];
  const error429 = providerError(429, 'RESOURCE_EXHAUSTED', { 'retry-after': '60' }, details);
  const h = httpHarness([error429], 1);
  await assert.rejects(geminiCall(h));
  assert.equal(h.calls.length, 1);

  await assert.rejects(geminiCall(h), err => {
    assert.equal(err.message, 'GEMINI_RATE_LIMIT');
    assert.equal(err.diagnostic.reason, 'local_circuit_breaker_active');
    assert.ok(err.diagnostic.retry_after_ms > 0);
    return true;
  });
  assert.equal(h.calls.length, 1);
});

test('resilient error extraction extracts provider details from n8n axios cause format', async () => {
  const n8nError = new Error('429 - {"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaMetric":"generate_content_requests_per_minute"}]}]}}');
  n8nError.cause = {
    response: {
      status: 429,
      headers: { 'retry-after': '15', 'x-goog-request-id': 'req-axios-123' },
      data: {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [{ violations: [{ quotaMetric: 'generate_content_requests_per_minute' }] }]
        }
      }
    }
  };
  const h = httpHarness([n8nError], 1);
  await assert.rejects(geminiCall(h), err => {
    assert.equal(err.diagnostic.http_status, 429);
    assert.equal(err.diagnostic.provider_status, 'RESOURCE_EXHAUSTED');
    assert.equal(err.diagnostic.provider_code, 429);
    assert.equal(err.diagnostic.provider_request_id, 'req-axios-123');
    assert.equal(err.diagnostic.retry_after_ms, 15000);
    assert.deepEqual([...err.diagnostic.quota_metrics], ['generate_content_requests_per_minute']);
    return true;
  });
});

test('concurrency limiter regulates simultaneous calls across tenants', async () => {
  let inFlight = 0;
  let maxSeen = 0;
  const h = httpHarness([{ ok: true }], 1);
  h.context.setTimeout = setTimeout;
  h.context.helpers.httpRequest = async () => {
    inFlight++;
    if (inFlight > maxSeen) maxSeen = inFlight;
    await new Promise(r => setTimeout(r, 40));
    inFlight--;
    return { ok: true };
  };
  await Promise.all([geminiCall(h), geminiCall(h), geminiCall(h), geminiCall(h)]);
  assert.ok(maxSeen <= 2, `maxSeen was ${maxSeen}, expected <= 2`);
});

test('concurrency limiter never exceeds its cap after a long queue wait', async () => {
  let inFlight = 0;
  let maxSeen = 0;
  const h = httpHarness([{ ok: true }], 1);
  h.context.setTimeout = setTimeout;
  h.context.helpers.httpRequest = async () => {
    inFlight++;
    maxSeen = Math.max(maxSeen, inFlight);
    await new Promise(r => setTimeout(r, 800));
    inFlight--;
    return { ok: true };
  };
  await Promise.all([geminiCall(h), geminiCall(h), geminiCall(h), geminiCall(h), geminiCall(h)]);
  assert.ok(maxSeen <= 2, `maxSeen was ${maxSeen}, expected <= 2`);
});

test('queued Gemini call observes a circuit opened while it waits', async () => {
  const h = httpHarness([{ ok: true }], 1);
  h.context.setTimeout = setTimeout;
  h.shared.gemini_active_calls = 2;
  const pending = geminiCall(h);
  await new Promise(r => setTimeout(r, 30));
  h.shared.gemini_circuit_open_until = Date.now() + 5000;
  await assert.rejects(pending, error => error.message === 'GEMINI_RATE_LIMIT'
    && error.diagnostic.reason === 'local_circuit_breaker_active');
  assert.equal(h.calls.length, 0);
});

test('local fallback admits only one half-open probe after cooldown', async () => {
  const h = httpHarness([{ok:true}], 1);
  h.context.setTimeout = setTimeout;
  h.shared.gemini_circuit_open_until = Date.now() - 1;
  h.context.helpers.httpRequest = async request => {
    h.calls.push(request);
    await new Promise(resolve => setTimeout(resolve, 25));
    return {ok:true};
  };
  const results = await Promise.allSettled([geminiCall(h), geminiCall(h)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected'
    && item.reason?.diagnostic?.reason === 'local_half_open_busy').length, 1);
  assert.equal(h.calls.length, 1);
});

test('local half-open network failure clears the probe and starts a fresh cooldown', async () => {
  const timeout = new Error('socket timed out');
  timeout.code = 'ETIMEDOUT';
  const h = httpHarness([timeout], 1, {GEMINI_CIRCUIT_COOLDOWN_MS:'2000'});
  h.shared.gemini_circuit_open_until = Date.now() - 1;
  await assert.rejects(geminiCall(h), error => error.diagnostic.category === 'network_or_timeout');
  assert.equal(h.shared.gemini_probe_id, '');
  assert.equal(h.shared.gemini_probe_until, 0);
  assert.ok(h.shared.gemini_circuit_open_until > Date.now());
});

test('greeting in existing lead with unknown intent is deterministic and does not call Gemini', () => {
  assert.match(code, /const isPureGreeting=\/\^\(\?:oi\+\|ol\[aá\]\+\|opa\|bom dia\|boa tarde\|boa noite\)\[!\.,\\s\]\*\$\/iu/);
  assert.match(code, /const simpleGreeting=isPureGreeting && salesModeFor\(greetingState\)==='unknown' && !greetingHasContext/);
  assert.doesNotMatch(code, /simpleGreeting=!history\.length/);
});

test('provider extraction skips empty envelopes, unwraps Buffer arrays and reads RetryInfo', async () => {
  const error = new Error('opaque n8n wrapper');
  error.statusCode = 429;
  error.response = {data:{}};
  error.cause = {response:{status:429,data:Buffer.from(JSON.stringify([{error:{code:429,status:'RESOURCE_EXHAUSTED',
    details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'35s'}]}}]))}};
  const h = httpHarness([error], 1);
  await assert.rejects(geminiCall(h), caught => caught.diagnostic.provider_status === 'RESOURCE_EXHAUSTED'
    && caught.diagnostic.retry_after_ms === 35000);
});

test('each physical provider attempt, including retries, is counted centrally', async () => {
  const h = httpHarness([providerError(503,'UNAVAILABLE'),{ok:true}], 2);
  await geminiCall(h);
  assert.equal(h.shared['gemini_tenant-test_2026-10-14'], 2);
});

test('required distributed mode fails closed before a Gemini request when controller is unavailable', async () => {
  const h = httpHarness([new Error('database unavailable')], 1, {
    GEMINI_RATE_SCOPE:'shared-project',GEMINI_MAX_RPM:10,GEMINI_MAX_TPM:10000,GEMINI_MAX_RPD:100,
    GEMINI_RATE_CONTROL_REQUIRED:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'secret',
  });
  await assert.rejects(geminiCall(h), error => error.message === 'GEMINI_RATE_CONTROL_UNAVAILABLE'
    && error.diagnostic.reason === 'distributed_controller_unavailable');
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /magia_gemini_acquire$/);
});

test('distributed controller receives probe cooldown and an explicit network timeout outcome', async () => {
  const timeout = new Error('socket timed out');
  timeout.code = 'ETIMEDOUT';
  const h = httpHarness([
    {allowed:true,generation:2,is_probe:true},
    timeout,
    {released:true,reason:'probe_failure_cooldown'},
  ], 1, {
    GEMINI_RATE_SCOPE:'shared-project',GEMINI_MAX_RPM:10,GEMINI_MAX_TPM:10000,GEMINI_MAX_RPD:100,
    GEMINI_RATE_CONTROL_REQUIRED:'true',GEMINI_CIRCUIT_COOLDOWN_MS:'45000',
    SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'secret',
  });
  await assert.rejects(geminiCall(h), error => error.diagnostic.category === 'network_or_timeout');
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[0].body.p_probe_cooldown_ms, 45000);
  assert.equal(h.calls[2].body.p_outcome, 'network_or_timeout');
  assert.equal(h.calls[2].body.p_cooldown_ms, 45000);
});

test('audio transcription goes through the same central Gemini controller', () => {
  const source = functions.get('transcribeTurnAudio');
  assert.match(source, /await httpJson\('POST'/);
  assert.match(source, /operation:'audio_transcription'/);
  assert.doesNotMatch(source, /await helpers\.httpRequest\(\{method:'POST',[\s\S]*generativelanguage/);
});

test('salesModeFor infers persisted buy and sell context when stored mode is unknown', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functions.get('salesModeFor')};this.salesModeFor=salesModeFor`, context);
  assert.equal(context.salesModeFor({transaction_mode:'unknown',product_id:'product'}), 'buy');
  assert.equal(context.salesModeFor({transaction_mode:'unknown',sell_vehicle:{model:'Camaro'}}), 'sell');
  assert.equal(context.salesModeFor({transaction_mode:'unknown',product_id:'product',sell_model:'Camaro'}), 'buy_and_sell');
});

test('appointment parsing honors the tenant timezone instead of fixed UTC-3', () => {
  const context = {Intl,Date,normalizeText:value=>String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''),
    settingsFor:value=>value.settings?.settings||{}};
  vm.createContext(context);
  for (const name of ['tenantTimeZone','isoDateInTenantTimezone','parseAppointmentStartAt']) {
    vm.runInContext(`${functions.get(name)};this.${name}=${name}`, context);
  }
  assert.equal(context.parseAppointmentStartAt('2026-01-15','12:00',{settings:{settings:{timezone:'America/Manaus'}}}),
    '2026-01-15T16:00:00.000Z');
});
