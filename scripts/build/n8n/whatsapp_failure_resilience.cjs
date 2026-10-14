const HTTP_HELPERS_AND_FUNCTION = String.raw`
function httpHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || headers.get(name.toLowerCase()) || '');
  const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function httpErrorHeaders(error) {
  const candidates=[error?.cause?.response?.headers,error?.response?.headers,error?.context?.headers,
    error?.error?.response?.headers,error?.headers,error?.cause?.headers];
  for(const headers of candidates){
    if(!headers||typeof headers!=='object')continue;
    if(typeof headers.get==='function'||Object.keys(headers).length)return headers;
  }
  return {};
}

function httpProviderBody(error) {
  const candidates = [
    error?.response?.data,
    error?.response?.body,
    error?.cause?.response?.data,
    error?.cause?.response?.body,
    error?.cause?.data,
    error?.cause?.body,
    error?.context?.data,
    error?.context?.body,
    error?.body,
    error?.data,
    error?.error?.response?.data,
    error?.error?.response?.body,
    error?.error?.body,
  ];
  let fallback = null;
  const unwrap = raw => {
    if (!raw) return null;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return unwrap(raw.toString('utf8'));
    if (typeof raw === 'string') {
      const value = raw.trim();
      if (!value || value.length > 100000) return null;
      if (value.startsWith('{') || value.startsWith('[')) {
        try { return unwrap(JSON.parse(value)); } catch (_) {}
      }
      const match = value.match(/\{[\s\S]*"error"\s*:\s*\{[\s\S]*\}[\s\S]*\}/);
      if (match) { try { return unwrap(JSON.parse(match[0])); } catch (_) {} }
      return null;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) { const parsed = unwrap(item); if (parsed?.error) return parsed; }
      return null;
    }
    if (typeof raw === 'object') {
      if (!Object.keys(raw).length) return null;
      if (raw.error && typeof raw.error === 'object') return raw;
      const nested = unwrap(raw.data) || unwrap(raw.body);
      if (nested?.error) return nested;
      return raw;
    }
    return null;
  };
  for (const raw of candidates) {
    const parsed = unwrap(raw);
    if (parsed?.error) return parsed;
    if (parsed && !fallback) fallback = parsed;
  }
  for (const text of [error?.description, error?.message, error?.cause?.message]) {
    if (typeof text === 'string') {
      const match = text.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (match) {
        try { const parsed = unwrap(JSON.parse(match[0])); if (parsed) return parsed; } catch (_) {}
      }
    }
  }
  return fallback || {};
}

function httpDurationMs(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return null;
  return Math.max(0, Math.ceil(Number(match[1]) * (match[2]?.toLowerCase() === 'ms' ? 1 : 1000)));
}

function httpRetryAfterMs(headers, details = [], now = Date.now()) {
  const value = httpHeaderValue(headers, 'retry-after').trim();
  if (value) {
    if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1000));
    const at = Date.parse(value);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  for (const detail of Array.isArray(details) ? details : []) {
    const parsed = httpDurationMs(detail?.retryDelay ?? detail?.retry_delay ?? detail?.metadata?.retryDelay);
    if (parsed !== null) return parsed;
  }
  return null;
}

function httpSafeDiagnostic(error, metadata = {}) {
  const body = httpProviderBody(error);
  const providerError = body?.error && typeof body.error === 'object' ? body.error : {};
  const headers = httpErrorHeaders(error);
  const rawStatus = error?.statusCode ?? error?.status ?? error?.httpCode ?? error?.response?.statusCode
    ?? error?.response?.status ?? error?.cause?.response?.statusCode ?? error?.cause?.response?.status
    ?? error?.cause?.statusCode ?? error?.cause?.status ?? error?.context?.statusCode
    ?? providerError.code ?? null;
  let numericStatus = Number(rawStatus);
  if (!Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) {
    const msgMatch = String(error?.message || '').match(/\b([1-5]\d\d)\b/);
    if (msgMatch) numericStatus = Number(msgMatch[1]);
  }
  const httpStatus = Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599 ? numericStatus : null;
  const providerCode = Number.isInteger(Number(providerError.code)) ? Number(providerError.code) : null;
  const providerStatus = /^[A-Z][A-Z0-9_]{1,80}$/.test(String(providerError.status || ''))
    ? String(providerError.status) : null;
  const networkCandidate = String(error?.code || error?.cause?.code || '').toUpperCase();
  const networkCode = /^(?:ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ABORT_ERR)$/.test(networkCandidate)
    ? networkCandidate : null;
  const message = [error?.message,error?.description,providerError?.message].filter(Boolean).join(' ').toLowerCase();
  let category = 'unknown';
  if (httpStatus === 429 || providerStatus === 'RESOURCE_EXHAUSTED' || /quota|resource has been exhausted|too many requests/i.test(message)) category = 'rate_limit';
  else if (httpStatus === 401 || providerStatus === 'UNAUTHENTICATED') category = 'authentication';
  else if (httpStatus === 403 || providerStatus === 'PERMISSION_DENIED') category = /quota|billing|exceeded/i.test(message)?'rate_limit':'permission';
  else if (httpStatus === 404 || providerStatus === 'NOT_FOUND') category = 'model_unavailable';
  else if (httpStatus === 400 || providerStatus === 'INVALID_ARGUMENT') category = 'invalid_request_or_schema';
  else if (httpStatus && httpStatus >= 500) category = 'upstream_server';
  else if (networkCode || /timeout|timed out|socket hang up/.test(message)) category = 'network_or_timeout';

  const details = Array.isArray(providerError.details) ? providerError.details : [];
  const retryAfterMs = httpRetryAfterMs(headers, details);
  const requestId = httpHeaderValue(headers, 'x-goog-request-id') || httpHeaderValue(headers, 'x-request-id') || null;
  const quotaMetrics = [...new Set(details.flatMap(detail => {
    const violations = Array.isArray(detail?.violations) ? detail.violations : [];
    return [detail?.quotaMetric || detail?.quotaId || detail?.metadata?.quota_metric,
      ...violations.map(item => item?.quotaMetric || item?.quotaId || item?.subject)]
      .map(item => String(item || '').slice(0, 180)).filter(Boolean);
  }))].slice(0, 8);
  const metricsText = (quotaMetrics.join(' ') + ' ' + message).toLowerCase();
  const limitDimension = category !== 'rate_limit' ? null
    : /per_day|requests_per_day|rpd/.test(metricsText) ? 'rpd'
    : /token|tokens_per_minute|tpm/.test(metricsText) ? 'tpm'
    : /per_minute|requests_per_minute|rpm/.test(metricsText) ? 'rpm'
    : 'unspecified_quota';
  return {
    category,
    http_status: httpStatus,
    provider_code: providerCode,
    provider_status: providerStatus,
    network_code: networkCode,
    model: metadata.model || null,
    operation: metadata.operation || 'http_request',
    duration_ms: Number(metadata.duration_ms || 0),
    attempts: Number(metadata.attempts || 1),
    retryable: ['rate_limit', 'upstream_server', 'network_or_timeout'].includes(category)
      && !['rpd'].includes(limitDimension),
    retry_after_ms: retryAfterMs,
    provider_request_id: requestId ? String(requestId).slice(0, 180) : null,
    quota_metrics: quotaMetrics,
    ...(limitDimension ? { limit_dimension: limitDimension } : {}),
    ...(metadata.rate_control_mode ? { rate_control_mode: metadata.rate_control_mode } : {}),
  };
}

function getSharedRuntimeState() {
  try {
    if (typeof $getWorkflowStaticData === 'function') {
      return $getWorkflowStaticData('global');
    }
  } catch (_) {}
  if (typeof globalThis !== 'undefined') {
    return globalThis.__NORIA_SHARED_RUNTIME__ || (globalThis.__NORIA_SHARED_RUNTIME__ = {});
  }
  return {};
}

function geminiRateConfig() {
  const scope = String(env('GEMINI_RATE_SCOPE', '') || '').trim();
  const maxRpm = Number(env('GEMINI_MAX_RPM', '0'));
  const maxTpm = Number(env('GEMINI_MAX_TPM', '0'));
  const maxRpd = Number(env('GEMINI_MAX_RPD', '0'));
  const required = String(env('GEMINI_RATE_CONTROL_REQUIRED', 'false')).toLowerCase() === 'true';
  const distributed = /^[a-zA-Z0-9._:-]{1,120}$/.test(scope)
    && [maxRpm, maxTpm, maxRpd].every(value => Number.isFinite(value) && value > 0);
  return { scope, maxRpm, maxTpm, maxRpd, required, distributed };
}

function estimateGeminiTokens(payload) {
  try {
    const chars = JSON.stringify(payload || {}).length;
    const output = Number(payload?.generationConfig?.maxOutputTokens || 512);
    return Math.max(1, Math.ceil(chars / 3.5) + Math.min(Math.max(output, 1), 8192));
  } catch (_) { return 1000; }
}

async function geminiRateRpc(name, body) {
  const base = String(env('SUPABASE_URL', '') || '').replace(/\/$/, '');
  const key = String(env('SUPABASE_SERVICE_ROLE_KEY', '') || '');
  if (!base || !key) throw new Error('GEMINI_RATE_CONTROL_DATABASE_UNAVAILABLE');
  return helpers.httpRequest({method:'POST',url:base+'/rest/v1/rpc/'+name,
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body,json:true,timeout:3000});
}

function geminiControlError(reason, retryAfterMs = null, model = null, mode = 'supabase_atomic') {
  const internalLimit = ['rpm_exceeded','tpm_exceeded','rpd_exceeded'].includes(reason);
  const circuit = ['circuit_open','half_open_busy','probe_timeout_cooldown','local_half_open_busy'].includes(reason);
  const concurrency = reason === 'concurrency_busy';
  const error = new Error(internalLimit ? 'GEMINI_INTERNAL_RATE_LIMIT'
    : circuit ? 'GEMINI_CIRCUIT_OPEN'
    : concurrency ? 'GEMINI_CONCURRENCY_BUSY' : 'GEMINI_RATE_CONTROL_UNAVAILABLE');
  error.diagnostic = {
    category: internalLimit ? 'internal_rate_limit' : circuit ? 'circuit_breaker'
      : concurrency ? 'local_backpressure' : 'rate_control_unavailable',
    http_status: null, provider_status: null, provider_code: null, model,
    operation: 'rate_control', duration_ms: 0, attempts: 0, retryable: false,
    retry_after_ms: Number.isFinite(Number(retryAfterMs)) ? Number(retryAfterMs) : null,
    quota_metrics: [], reason, rate_control_mode: mode,
  };
  return error;
}

function checkGeminiCircuitBreaker(model = null) {
  const shared = getSharedRuntimeState();
  const openUntil = Number(shared.gemini_circuit_open_until || 0);
  const now = Date.now();
  if (openUntil > now) {
    const waitMs = openUntil - now;
    const error = new Error('GEMINI_RATE_LIMIT');
    error.diagnostic = {
      category: 'rate_limit',
      http_status: null,
      provider_status: null,
      provider_code: null,
      model,
      operation: 'circuit_breaker',
      duration_ms: 0,
      attempts: 0,
      retryable: false,
      retry_after_ms: waitMs,
      quota_metrics: shared.gemini_circuit_quota_metrics || [],
      reason: 'local_circuit_breaker_active',
      rate_control_mode: 'local_fallback'
    };
    return error;
  }
  if (openUntil > 0 && Number(shared.gemini_probe_until || 0) > now) {
    return geminiControlError('local_half_open_busy', Number(shared.gemini_probe_until)-now, model, 'local_fallback');
  }
  return null;
}

function recordGeminiCircuitFailure(diagnostic) {
  if (diagnostic?.category !== 'rate_limit') return;
  const shared = getSharedRuntimeState();
  const cooldownMs = Number(env('GEMINI_CIRCUIT_COOLDOWN_MS', '30000'));
  const waitMs = Math.max(1000, Number(diagnostic.retry_after_ms) || cooldownMs);
  shared.gemini_circuit_open_until = Date.now() + Math.min(waitMs, 300000);
  shared.gemini_probe_id = '';
  shared.gemini_probe_until = 0;
  if (Array.isArray(diagnostic.quota_metrics) && diagnostic.quota_metrics.length > 0) {
    shared.gemini_circuit_quota_metrics = diagnostic.quota_metrics;
  }
}

function recordGeminiSuccess(lease = null) {
  const shared = getSharedRuntimeState();
  if (lease?.is_probe && shared.gemini_probe_id === lease.lease_id) {
    shared.gemini_circuit_open_until = 0;
    shared.gemini_probe_id = '';
    shared.gemini_probe_until = 0;
  }
}

async function acquireGeminiConcurrencySlot(options = {}) {
  const config = geminiRateConfig();
  const model = String(options.model || 'default');
  const leaseTtlMs = Math.max(20000, Math.min(Number(env('GEMINI_LEASE_TTL_MS', '30000')) || 30000, 120000));
  const probeCooldownMs = Math.max(1000, Math.min(Number(env('GEMINI_CIRCUIT_COOLDOWN_MS', '30000')) || 30000, 300000));
  const leaseId = String((turn?.token || chatId || 'call') + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 12));
  if (config.distributed) {
    let result;
    try {
      result = await geminiRateRpc('magia_gemini_acquire', {
        p_scope:config.scope,p_model:model,p_lease_id:leaseId,
        p_estimated_tokens:Math.max(1,Math.ceil(Number(options.estimatedTokens)||1000)),
        p_max_concurrent:Math.max(1,Math.min(Number(env('GEMINI_MAX_CONCURRENT_CALLS','2'))||2,20)),
        p_max_rpm:config.maxRpm,p_max_tpm:config.maxTpm,p_max_rpd:config.maxRpd,
        p_lease_ttl_ms:leaseTtlMs,p_probe_cooldown_ms:probeCooldownMs,
      });
    } catch (_) {
      if (config.required) throw geminiControlError('distributed_controller_unavailable', null, model);
      result = null;
    }
    if (result) {
      if (result.allowed !== true) throw geminiControlError(String(result.reason||'denied'),result.retry_after_ms,model);
      return {mode:'supabase_atomic',scope:config.scope,model,lease_id:leaseId,
        generation:Number(result.generation||0),is_probe:result.is_probe===true,lease_ttl_ms:leaseTtlMs};
    }
  } else if (config.required) {
    throw geminiControlError('distributed_controller_not_configured', null, model, 'unconfigured');
  }

  const shared = getSharedRuntimeState();
  const configuredMax = Number(env('GEMINI_MAX_CONCURRENT_CALLS', '2'));
  const maxConcurrent = Math.max(1, Math.min(Number.isFinite(configuredMax) ? configuredMax : 2, 20));
  const configuredWaitMs = Number(env('GEMINI_CONCURRENCY_WAIT_MS', '12000'));
  const maxWaitMs = Math.max(250, Math.min(Number.isFinite(configuredWaitMs) ? configuredWaitMs : 12000, 30000));
  const started = Date.now();
  while (Math.max(0, Number(shared.gemini_active_calls) || 0) >= maxConcurrent) {
    const circuitError = checkGeminiCircuitBreaker();
    if (circuitError) throw circuitError;
    if (Date.now() - started >= maxWaitMs) {
      const error = new Error('GEMINI_CONCURRENCY_BUSY');
      error.diagnostic = {
        category: 'local_backpressure',
        http_status: null,
        provider_status: null,
        provider_code: null,
        model: null,
        operation: 'concurrency_limiter',
        duration_ms: Date.now() - started,
        attempts: 0,
        retryable: false,
        retry_after_ms: null,
        quota_metrics: [],
        reason: 'concurrency_wait_exhausted'
      };
      throw error;
    }
    await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 30)));
  }
  let isProbe=false;
  if (Number(shared.gemini_circuit_open_until||0)>0
      && Number(shared.gemini_circuit_open_until)<=Date.now()) {
    if (Number(shared.gemini_probe_until||0)>Date.now()) {
      throw geminiControlError('local_half_open_busy',Number(shared.gemini_probe_until)-Date.now(),model,'local_fallback');
    }
    isProbe=true;
    shared.gemini_probe_id=leaseId;
    shared.gemini_probe_until=Date.now()+leaseTtlMs;
  }
  shared.gemini_active_calls = Math.max(0, Number(shared.gemini_active_calls) || 0) + 1;
  return {mode:config.distributed?'distributed_unavailable_local_fallback':'local_only_unconfigured',model,
    lease_id:leaseId,is_probe:isProbe,lease_ttl_ms:leaseTtlMs};
}

async function releaseGeminiConcurrencySlot(lease, outcome = 'released', diagnostic = null) {
  if (lease?.mode === 'supabase_atomic') {
    const mapped = outcome === 'success' ? 'success'
      : diagnostic?.category === 'rate_limit' ? 'rate_limit'
      : diagnostic?.category === 'upstream_server' ? 'upstream_server'
      : diagnostic?.category === 'network_or_timeout' ? 'network_or_timeout' : 'released';
    try {
      await geminiRateRpc('magia_gemini_release', {p_scope:lease.scope,p_model:lease.model,
        p_lease_id:lease.lease_id,p_outcome:mapped,
        p_cooldown_ms:Math.max(1000,Math.min(Number(diagnostic?.retry_after_ms)||Number(env('GEMINI_CIRCUIT_COOLDOWN_MS','30000'))||30000,300000))});
    } catch (_) {}
    return;
  }
  const shared = getSharedRuntimeState();
  shared.gemini_active_calls = Math.max(0, (shared.gemini_active_calls || 1) - 1);
  if (lease?.is_probe && outcome !== 'success' && shared.gemini_probe_id === lease.lease_id) {
    const cooldownMs = Math.max(1000, Math.min(Number(diagnostic?.retry_after_ms)
      || Number(env('GEMINI_CIRCUIT_COOLDOWN_MS','30000')) || 30000, 300000));
    shared.gemini_circuit_open_until = Date.now() + cooldownMs;
    shared.gemini_probe_id = '';
    shared.gemini_probe_until = 0;
  }
}

function httpGeminiMetadata(url, payload, options = {}) {
  const match = String(url || '').match(/\/models\/([^/:?]+):/);
  const instruction = String(payload?.system_instruction?.parts?.[0]?.text || '');
  let operation = options.operation || 'gemini_generate';
  if (instruction.startsWith('NORIA_DIALOGUE_PLAN')) operation = 'dialogue_plan';
  else if (instruction.startsWith('NORIA_DIALOGUE_WRITE')) operation = 'dialogue_compose';
  else if (instruction.startsWith('NORIA_DIALOGUE_AUDIT')) operation = 'dialogue_audit';
  else if (payload?.contents?.some?.(content => content?.parts?.some?.(part => part?.inlineData))) operation = 'gemini_media';
  return { model: options.model || match?.[1] || null, operation };
}

async function httpJson(method, url, headers = {}, payload = null, options = {}) {
  const isGemini = /^https:\/\/generativelanguage\.googleapis\.com\//.test(String(url || ''));
  if (isGemini) {
    const circuitError = checkGeminiCircuitBreaker();
    if (circuitError) throw circuitError;
  }
  const metadata = isGemini ? httpGeminiMetadata(url, payload, options) : { model: null, operation: options.operation || 'http_request' };
  const configuredAttempts = Number(env('GEMINI_RETRY_MAX_ATTEMPTS', '2'));
  const maxAttempts = isGemini && options.retry !== false
    ? Math.max(1, Math.min(Number.isFinite(configuredAttempts) ? configuredAttempts : 2, 3)) : 1;
  const totalBudgetMs = isGemini ? 12000 : 0;
  const startedAt = Date.now();
  let lastDiagnostic = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const callStartedAt = Date.now();
    let lease = null;
    try {
      if (isGemini) {
        const circuitError = checkGeminiCircuitBreaker(metadata.model);
        if (circuitError) throw circuitError;
        lease = await acquireGeminiConcurrencySlot({model:metadata.model,estimatedTokens:estimateGeminiTokens(payload)});
        markGeminiPhysicalUsage();
      }
      const response = await helpers.httpRequest({
        method,
        url,
        headers,
        ...(payload === null ? {} : { body: payload }),
        json: true,
        timeout: isGemini ? Math.max(1000, Math.min(15000, totalBudgetMs - (Date.now() - startedAt))) : 45000,
      });
      if (isGemini) {
        const completedLease=lease;
        await releaseGeminiConcurrencySlot(completedLease, 'success');
        recordGeminiSuccess(completedLease);
        lease = null;
      }
      return response;
    } catch (error) {
      if (!isGemini) throw error;
      lastDiagnostic = error?.diagnostic && typeof error.diagnostic === 'object'
        ? { ...error.diagnostic, model: error.diagnostic.model || metadata.model,
          operation: error.diagnostic.operation || metadata.operation,
          rate_control_mode:error.diagnostic.rate_control_mode||lease?.mode||'none',
          duration_ms: Number(error.diagnostic.duration_ms || Date.now() - callStartedAt), attempts: attempt }
        : httpSafeDiagnostic(error, {
          ...metadata,
          duration_ms: Date.now() - callStartedAt,
          attempts: attempt,rate_control_mode:lease?.mode||'none',
         });
      if (lease) {
        await releaseGeminiConcurrencySlot(lease, 'failure', lastDiagnostic);
        lease = null;
      }
      if (lastDiagnostic.category === 'rate_limit') {
        recordGeminiCircuitFailure(lastDiagnostic);
      }
      const elapsed = Date.now() - startedAt;
      if (lastDiagnostic.reason === 'local_circuit_breaker_active'
          || lastDiagnostic.category === 'circuit_breaker'
          || lastDiagnostic.category === 'internal_rate_limit'
          || lastDiagnostic.category === 'rate_control_unavailable'
          || !lastDiagnostic.retryable || attempt >= maxAttempts || elapsed >= totalBudgetMs) {
        const wrapped = new Error(lastDiagnostic.category === 'rate_limit' ? 'GEMINI_RATE_LIMIT'
          : lastDiagnostic.category === 'internal_rate_limit' ? 'GEMINI_INTERNAL_RATE_LIMIT'
          : lastDiagnostic.category === 'circuit_breaker' ? 'GEMINI_CIRCUIT_OPEN'
          : lastDiagnostic.category === 'rate_control_unavailable' ? 'GEMINI_RATE_CONTROL_UNAVAILABLE'
          : lastDiagnostic.category === 'local_backpressure' ? 'GEMINI_CONCURRENCY_BUSY'
          : lastDiagnostic.category === 'authentication' ? 'GEMINI_AUTHENTICATION_FAILED'
          : lastDiagnostic.category === 'permission' ? 'GEMINI_PERMISSION_DENIED'
          : lastDiagnostic.category === 'model_unavailable' ? 'GEMINI_MODEL_UNAVAILABLE'
          : lastDiagnostic.category === 'invalid_request_or_schema' ? 'GEMINI_INVALID_REQUEST'
          : lastDiagnostic.category === 'upstream_server' ? 'GEMINI_UPSTREAM_UNAVAILABLE'
          : lastDiagnostic.category === 'network_or_timeout' ? 'GEMINI_NETWORK_OR_TIMEOUT'
          : 'HTTP_REQUEST_FAILED');
        wrapped.diagnostic = lastDiagnostic;
        throw wrapped;
      }
      const baseDelay = Math.min(250 * (2 ** (attempt - 1)), 2000);
      const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(baseDelay * 0.25)));
      const requestedDelay = lastDiagnostic.retry_after_ms === null ? baseDelay + jitter : lastDiagnostic.retry_after_ms;
      const remaining = totalBudgetMs - elapsed;
      if (requestedDelay > remaining) {
        const wrapped = new Error(lastDiagnostic.category === 'rate_limit' ? 'GEMINI_RATE_LIMIT' : 'GEMINI_RETRY_BUDGET_EXHAUSTED');
        wrapped.diagnostic = lastDiagnostic;
        throw wrapped;
      }
      await new Promise(resolve => setTimeout(resolve, requestedDelay));
    }
  }
  const wrapped = new Error('HTTP_REQUEST_FAILED');
  wrapped.diagnostic = lastDiagnostic;
  throw wrapped;
}
`;

const SAFE_FAILURE_DIAGNOSTICS = String.raw`
function salesSafeFailureDiagnostics(error, phase) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object'
    ? error.diagnostic : httpSafeDiagnostic(error, { operation: phase });
  return { ...diagnostic, phase, operation: diagnostic.operation || phase };
}
`;

const SALES_MODE_FOR = String.raw`
function salesModeFor(state = {}) {
  const mode = String(state.transaction_mode || '').trim();
  if (['buy','sell','buy_and_sell','after_sales'].includes(mode)) return mode;
  if (state.intent === 'after_sales') return 'after_sales';
  const hasSell = Boolean(state.sell_vehicle?.model || state.sell_model);
  const hasBuy = Boolean(state.buy_interest?.model || state.product_id);
  if (hasSell && hasBuy) return 'buy_and_sell';
  if (hasSell) return 'sell';
  if (hasBuy) return 'buy';
  return ['buy','sell'].includes(state.intent) ? state.intent : 'unknown';
}
`;

const MARK_USAGE = String.raw`
function markUsage() {
  // Legacy call sites are intentionally inert. Physical Gemini HTTP attempts,
  // including retries and truncation retries, are counted centrally by httpJson.
}
`;

const MARK_PHYSICAL_USAGE = String.raw`
function markGeminiPhysicalUsage() {
  try {
    const data = $getWorkflowStaticData('global');
    const key = 'gemini_' + tenantSlug + '_' + todayKey();
    data[key] = Number(data[key] || 0) + 1;
  } catch (_) {}
}
`;

const PARSE_APPOINTMENT_START = String.raw`
function parseAppointmentStartAt(dateValue, timeValue, context = {}) {
  const rawDateText = String(dateValue || '').trim();
  const dateText = normalizeText(rawDateText);
  const timeMatch = normalizeText(timeValue).match(/(\d{1,2})(?::|h)?(\d{2})?/);
  if (!dateText || !timeMatch) return null;
  let normalizedDate = rawDateText;
  if (['hoje','hj'].includes(dateText)) normalizedDate = isoDateInTenantTimezone(0, context);
  else if (dateText === 'amanha') normalizedDate = isoDateInTenantTimezone(1, context);
  else if (dateText.includes('depois de amanha')) normalizedDate = isoDateInTenantTimezone(2, context);
  const iso = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = normalizedDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  let year, month, day;
  if (iso) [year,month,day] = iso.slice(1).map(Number);
  else if (br) {
    day=Number(br[1]);month=Number(br[2]);
    year=br[3]?Number(br[3]):Number(new Intl.DateTimeFormat('en-CA',{timeZone:tenantTimeZone(context),year:'numeric'}).format(new Date()));
    if (year < 100) year += 2000;
  } else return null;
  const hour=Number(timeMatch[1]), minute=Number(timeMatch[2]||0);
  if (![year,month,day,hour,minute].every(Number.isFinite)
      || month<1||month>12||day<1||day>31||hour<0||hour>23||minute<0||minute>59) return null;
  const zone=tenantTimeZone(context);
  const target=Date.UTC(year,month-1,day,hour,minute,0);
  let candidate=target;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const rendered=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    candidate += target-rendered;
  }
  const check=Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  if (check.year!==year||check.month!==month||check.day!==day||check.hour!==hour||check.minute!==minute) return null;
  return new Date(candidate).toISOString();
}
`;

function replaceFunction(code, ts, name, replacement) {
  const ast = ts.createSourceFile('core.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (!node) throw new Error(`Missing function ${name}`);
  return code.slice(0, node.getStart(ast)) + replacement.trim() + code.slice(node.end);
}

function replaceOnce(code, before, after, label) {
  const first = code.indexOf(before);
  if (first < 0 || code.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one ${label}`);
  return code.slice(0, first) + after + code.slice(first + before.length);
}

function applyConfirmedV213Corrections(source, ts) {
  let code = source;
  code = replaceFunction(code, ts, 'salesModeFor', SALES_MODE_FOR);
  code = replaceFunction(code, ts, 'markUsage', MARK_USAGE);
  if (code.includes('function markGeminiPhysicalUsage()')) {
    code = replaceFunction(code, ts, 'markGeminiPhysicalUsage', MARK_PHYSICAL_USAGE);
  } else {
    code = replaceOnce(code, MARK_USAGE.trim(), MARK_USAGE.trim() + '\n\n' + MARK_PHYSICAL_USAGE.trim(), 'physical usage counter insertion');
  }
  code = replaceFunction(code, ts, 'parseAppointmentStartAt', PARSE_APPOINTMENT_START);

  const legacyAudioCall =
    "    markUsage();\n    let body;\n    try {\n      body = await helpers.httpRequest({method:'POST',\n        url:'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',\n        headers:{'Content-Type':'application/json','x-goog-api-key':env('GEMINI_API_KEY')},json:true,timeout:25000,\n        body:{system_instruction:";
  if (code.includes(legacyAudioCall)) code = replaceOnce(code,
    legacyAudioCall,
    "    let body;\n    try {\n      body = await httpJson('POST',\n        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',\n        {'Content-Type':'application/json','x-goog-api-key':env('GEMINI_API_KEY')},\n        {system_instruction:",
    'audio through central Gemini control');
  const legacyAudioEnd =
    "            responseSchema:{type:'OBJECT',properties:{intelligible:{type:'BOOLEAN'},text:{type:'STRING'}},required:['intelligible','text']}}}});";
  if (code.includes(legacyAudioEnd)) code = replaceOnce(code,
    legacyAudioEnd,
    "            responseSchema:{type:'OBJECT',properties:{intelligible:{type:'BOOLEAN'},text:{type:'STRING'}},required:['intelligible','text']}}},\n        {operation:'audio_transcription',model,retry:true});",
    'audio central call options');

  const legacyGroundedCatch =
    "  } catch (error) {\n    return {text:'Vou chamar uma pessoa da equipe para continuar seu atendimento com seguran\\u00e7a, sem pedir que voc\\u00ea repita tudo. [HUMANO_SOLICITADO]',\n      model,usage:body?.usageMetadata||{},state:null,audit:{...audit,blocked_reason:String(error.message).slice(0,160)}};";
  if (code.includes(legacyGroundedCatch)) code = replaceOnce(code,
    legacyGroundedCatch,
    "  } catch (error) {\n    if (error?.diagnostic || /^GEMINI_/.test(String(error?.message || ''))) {\n      return {text:'Tive uma dificuldade tempor\\u00e1ria para consultar o atendimento. Pode tentar novamente em alguns instantes?',\n        model,usage:body?.usageMetadata||{},state:previousState,transient_failure:salesSafeFailureDiagnostics(error,'grounded_generate'),\n        audit:{...audit,blocked_reason:'transient_provider_failure'}};\n    }\n    return {text:'Vou chamar uma pessoa da equipe para continuar seu atendimento com seguran\\u00e7a, sem pedir que voc\\u00ea repita tudo. [HUMANO_SOLICITADO]',\n      model,usage:body?.usageMetadata||{},state:null,audit:{...audit,blocked_reason:String(error.message).slice(0,160)}};",
    'Nubia transient failure does not invent handoff');
  const legacyTelemetry =
    "    responseText = generated.text; event.ai_provider = 'gemini'; event.ai_model = generated.model; event.ai_usage = generated.usage;";
  if (code.includes(legacyTelemetry)) code = replaceOnce(code,
    legacyTelemetry,
    "    responseText = generated.text; event.ai_provider = generated.transient_failure?'gemini_degraded':'gemini'; event.ai_model = generated.model; event.ai_usage = generated.usage;\n    if (generated.transient_failure) { event.ai_error='GEMINI_TRANSIENT_FAILURE'; event.raw_payload.generation_failure=generated.transient_failure; event.raw_payload.ai_processing_ok=false; }",
    'Nubia transient failure telemetry');

  const greetingBefore = "  const simpleGreeting=isPureGreeting && salesModeFor(lead?.state||{})==='unknown';";
  const greetingAfter = "  const greetingState=lead?.state||{};\n  const greetingHasContext=Boolean(greetingState.product_id||greetingState.buy_interest?.model||greetingState.sell_vehicle?.model\n    ||greetingState.sell_model||greetingState.pending_requirement||greetingState.optional_human_offer\n    ||turn.messages.some(item=>item?.raw?.referral||item?.raw?.catalog_referral||/^\\[(?:image|audio|video|document|sticker)\\]/i.test(String(item?.text||''))));\n  const simpleGreeting=isPureGreeting && salesModeFor(greetingState)==='unknown' && !greetingHasContext;";
  if (code.includes(greetingBefore)) code = replaceOnce(code, greetingBefore, greetingAfter, 'context-safe deterministic greeting');

  code = code.replaceAll('conversation_core_v2_1_22_gemini_429_resilience_2026_10_13',
    'conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14');
  return code;
}

function applyFailureResilience(source, ts) {
  let code = source;
  code = replaceFunction(code, ts, 'httpJson', HTTP_HELPERS_AND_FUNCTION);
  code = replaceFunction(code, ts, 'salesSafeFailureDiagnostics', SAFE_FAILURE_DIAGNOSTICS);

  let dialogueJson;
  {
    const ast = ts.createSourceFile('core.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    dialogueJson = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'salesDialogueJson').getText(ast);
  }
  dialogueJson = replaceOnce(dialogueJson, 'responseMimeType:\'application/json\',responseSchema:schema}});',
    "responseMimeType:'application/json',responseSchema:schema}}, {operation:role.toLowerCase(),model,retry:true});", 'dialogue http options');
  code = replaceFunction(code, ts, 'salesDialogueJson', dialogueJson);

  // The first Gemini result already contains a structured dialogue plan. Validate it
  // locally and avoid extra provider calls merely to reclassify the same turn.
  code = replaceOnce(code,
    "    const review=await salesDialogueJson(context,'NORIA_DIALOGUE_PLAN_AUDIT',",
    "    return {...checked,attempts:[{attempt:0,issues:[]}]}\n    const review=await salesDialogueJson(context,'NORIA_DIALOGUE_PLAN_AUDIT',",
    'validated dialogue plan short circuit');

  // Composition keeps the deterministic fact/amount validator, with one bounded
  // write. Provider-based self-audits and three repair loops multiplied RPM.
  code = replaceOnce(code, 'for(let i=0;i<3;i++){', 'for(let i=0;i<1;i++){', 'dialogue compose attempt limit');
  code = replaceOnce(code,
    "      if(!issues.length){\n        const review=await audit({draft,plan,facts,execution});\n        issues=validateReview(review,facts);\n      }",
    "      // Claims, request coverage and monetary values are validated locally.\n      // Avoid a second Gemini call that audits the response it just produced.",
    'provider dialogue audit removal');

  // A greeting with no active commercial state is safe and deterministic,
  // regardless of previous history length (recontacts or existing leads with unknown intent).
  code = replaceOnce(code,
    "  let naturalPlan=null,naturalPlanError=null;\n  let directCatalogAnswer=null;",
    "  let naturalPlan=null,naturalPlanError=null;\n  let deterministicSimpleReply=false;\n  let directCatalogAnswer=null;",
    'deterministic flag');
  code = replaceOnce(code,
    "  if (genesisPhotoDeferral) {\n    generated={action:'reply',reason:'none',reply:'Combinado! Pode enviar as fotos quando puder. Continuamos a avaliação de onde paramos.',",
    "  const isPureGreeting=/^(?:oi+|ol[aá]+|opa|bom dia|boa tarde|boa noite)[!.,\\s]*$/iu.test(currentTurnText.trim());\n  const simpleGreeting=isPureGreeting && salesModeFor(lead?.state||{})==='unknown';\n  if (simpleGreeting) {\n    deterministicSimpleReply=true;\n    generated={action:'reply',reason:'none',reply:'Olá! Como posso ajudar? Você quer comprar, vender ou tirar uma dúvida sobre um veículo?',\n      state:salesMergeState(lead?.state||{},{}),product:lead?.product||null};\n    event.raw_payload={...(event.raw_payload||{}),deterministic_reply:'simple_greeting'};\n  } else if (genesisPhotoDeferral) {\n    generated={action:'reply',reason:'none',reply:'Combinado! Pode enviar as fotos quando puder. Continuamos a avaliação de onde paramos.',",
    'deterministic greeting');
  code = replaceOnce(code,
    "  if(tenantSlug==='wesley_automoveis'&&!generated.technical_error&&!generated.media_notice&&!genesisPhotoDeferral){",
    "  if(tenantSlug==='wesley_automoveis'&&!generated.technical_error&&!generated.media_notice&&!genesisPhotoDeferral&&!deterministicSimpleReply){",
    'skip plan for deterministic greeting');
  code = replaceOnce(code,
    "  if(tenantSlug==='wesley_automoveis'){\n    if(generated.technical_error){reply='Estou com uma dificuldade temporária para consultar o atendimento. Posso pedir para um atendente ajudar?';catalogPhotoToSend=null;}",
    "  if(tenantSlug==='wesley_automoveis'){\n    if(deterministicSimpleReply){reply=generated.reply;pendingRequirement='';followUpDisposition='not_applicable';optionalHumanOffer=null;catalogPhotoToSend=null;}\n    if(generated.technical_error){reply='Estou com uma dificuldade temporária para consultar o atendimento. Posso pedir para um atendente ajudar?';catalogPhotoToSend=null;}",
    'preserve deterministic greeting');

  // Technical fallbacks are not commercial questions and must never create jobs.
  code = code.replaceAll("followUpDisposition='awaiting_customer';\n    optionalHumanOffer={reason:'temporary_processing_failure'};",
    "followUpDisposition='technical_failure';\n    optionalHumanOffer={reason:'temporary_processing_failure'};");
  code = replaceOnce(code,
    "  const settings = settingsFor(context);\n  if (salesEnabled(context)) {\n    const disposition = event.raw_payload?.follow_up_disposition;",
    "  const settings = settingsFor(context);\n  if (event.raw_payload?.generation_failure || event.raw_payload?.dialogue_plan_failure\n      || event.raw_payload?.technical_error_code || event.raw_payload?.ai_processing_ok === false) return 0;\n  if (salesEnabled(context)) {\n    const disposition = event.raw_payload?.follow_up_disposition;",
    'follow-up technical failure guard');

  code = replaceOnce(code,
    "      ...(generated.technical_error?{technical_error_code:generated.technical_error}:{}),",
    "      ...(generated.technical_error?{technical_error_code:generated.technical_error}:{}),\n      ai_processing_ok:!generated.technical_error&&!naturalPlanError,",
    'event processing status');
  code = replaceOnce(code,
    "  await complete('done');return {ok:true,...sent,lead_id:saved.id,handoff:saved.ai_locked};",
    "  const aiProcessingOk=!generated.technical_error&&!naturalPlanError;\n  await complete('done');return {ok:true,workflow_ok:true,delivery_ok:sent.sent===true,ai_processing_ok:aiProcessingOk,\n    error_code:aiProcessingOk?null:(generated.technical_error||naturalPlanError||event.ai_error||'SALES_PROCESSING_FAILED'),\n    recovered_by_human:Boolean(saved.ai_locked&&salesOwnAssignmentEventId),...sent,lead_id:saved.id,handoff:saved.ai_locked};",
    'structured sales result');

  code = code.replaceAll('conversation_core_v2_1_21_failure_resilience_2026_10_13',
    'conversation_core_v2_1_22_gemini_429_resilience_2026_10_13');
  return applyConfirmedV213Corrections(code, ts);
}

function refreshFailureRuntime(source, ts) {
  const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const firstHelper = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'httpHeaderValue');
  const httpJson = [...ast.statements].reverse().find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'httpJson');
  if (!firstHelper || !httpJson || firstHelper.getStart(ast) >= httpJson.end) throw new Error('Invalid resilient HTTP runtime');
  let code = source.slice(0, firstHelper.getStart(ast)) + HTTP_HELPERS_AND_FUNCTION.trim() + source.slice(httpJson.end);
  code = replaceFunction(code, ts, 'salesSafeFailureDiagnostics', SAFE_FAILURE_DIAGNOSTICS);

  // Também garante atualização da saudação sem a trava de !history.length
  code = code.replace(
    "const simpleGreeting=!history.length && salesModeFor(lead?.state||{})==='unknown'\n    && /^(?:oi+|ol[aá]+|opa|bom dia|boa tarde|boa noite)[!.,\\s]*$/iu.test(currentTurnText.trim());",
    "const isPureGreeting=/^(?:oi+|ol[aá]+|opa|bom dia|boa tarde|boa noite)[!.,\\s]*$/iu.test(currentTurnText.trim());\n  const simpleGreeting=isPureGreeting && salesModeFor(lead?.state||{})==='unknown';"
  );
  return applyConfirmedV213Corrections(code, ts);
}

module.exports = { applyFailureResilience, refreshFailureRuntime, HTTP_HELPERS_AND_FUNCTION, SAFE_FAILURE_DIAGNOSTICS };
