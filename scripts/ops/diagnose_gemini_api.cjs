/**
 * One-request Gemini diagnostic. Dry-run unless --live is explicitly present.
 * It never prints the API key, writes application data, or sends customer data.
 */
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

const apiKey = process.env.GEMINI_API_KEY;
const modelArg = process.argv.find(value => value.startsWith('--model='));
const model = modelArg ? modelArg.slice('--model='.length) : (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
if (!/^gemini-[a-z0-9.-]+$/.test(model)) {
  console.error('ERRO: modelo invalido. Use --model=gemini-...');
  process.exit(1);
}

if (!process.argv.includes('--live')) {
  console.log('MODO SECO (DRY-RUN)');
  console.log('API key configurada:', apiKey ? 'SIM (valor nao exibido)' : 'NAO');
  console.log('Modelo:', model);
  console.log('Uma unica chamada: node scripts/ops/diagnose_gemini_api.cjs --live --model=' + model);
  process.exit(0);
}
if (!apiKey) {
  console.error('ERRO: GEMINI_API_KEY ausente.');
  process.exit(1);
}

function safeProviderError(body) {
  const provider = body?.error && typeof body.error === 'object' ? body.error : {};
  const details = Array.isArray(provider.details) ? provider.details : [];
  return {
    code: Number(provider.code) || null,
    status: String(provider.status || '').slice(0, 80) || null,
    message: String(provider.message || '').slice(0, 500) || null,
    details: details.slice(0, 12).map(detail => ({
      type: String(detail?.['@type'] || '').slice(0, 180),
      reason: String(detail?.reason || '').slice(0, 180) || null,
      retryDelay: String(detail?.retryDelay || '').slice(0, 40) || null,
      violations: Array.isArray(detail?.violations) ? detail.violations.slice(0, 8).map(item => ({
        quotaMetric: String(item?.quotaMetric || '').slice(0, 180) || null,
        quotaId: String(item?.quotaId || '').slice(0, 180) || null,
      })) : [],
    })),
  };
}

async function run() {
  console.log('Executando exatamente uma chamada controlada.');
  console.log('Modelo:', model);
  console.log('API key: configurada (valor nao exibido)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-goog-api-key':apiKey},
      body: JSON.stringify({contents:[{parts:[{text:'ping'}]}],generationConfig:{maxOutputTokens:5}}),
      signal: AbortSignal.timeout(10000),
    });
    const safeHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      if (/^(?:retry-after|x-goog-request-id|x-ratelimit|date|content-type)$/i.test(key)) safeHeaders[key] = value;
    }
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text); } catch (_) {}
    console.log(JSON.stringify({http_status:response.status,duration_ms:Date.now()-started,headers:safeHeaders,
      ...(response.ok ? {ok:true,finish_reason:body?.candidates?.[0]?.finishReason||null,usage:body?.usageMetadata||{}}
        : {ok:false,provider:safeProviderError(body)})}, null, 2));
    if (!response.ok) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ok:false,category:'network_or_timeout',code:String(error?.code||error?.name||'').slice(0,80),
      duration_ms:Date.now()-started}, null, 2));
    process.exitCode = 3;
  }
}

run();
