'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const cases = require('./evaluation-cases.cjs');

const root = path.resolve(__dirname, '../..');
const outDir = __dirname;
const maxCalls = Math.max(1, Number(process.env.NORIA_GEMINI_EVAL_MAX_CALLS || 40));
const caseLimit = Math.max(1, Number(process.env.NORIA_GEMINI_EVAL_CASE_LIMIT || cases.length));
const smokeOnly = process.argv.includes('--smoke');
const env = loadEnv(path.join(root, '.env'));
const apiKey = env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING');

function loadEnv(file) {
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return result;
}

async function getLiveSettings() {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('SUPABASE_READ_ENV_MISSING');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const tenantResponse = await fetch(`${base}/rest/v1/tenants?select=id,slug,status&slug=eq.wesley_automoveis&limit=1`, { headers });
  if (!tenantResponse.ok) throw new Error(`TENANT_SETTINGS_READ_${tenantResponse.status}`);
  const tenant = (await tenantResponse.json())[0];
  if (!tenant || tenant.status !== 'active') throw new Error('GENESIS_TENANT_NOT_ACTIVE');
  const settingsResponse = await fetch(`${base}/rest/v1/tenant_settings?select=settings,timezone&tenant_id=eq.${encodeURIComponent(tenant.id)}&limit=1`, { headers });
  if (!settingsResponse.ok) throw new Error(`TENANT_SETTINGS_READ_${settingsResponse.status}`);
  const row = (await settingsResponse.json())[0];
  if (!row?.settings?.system_prompt || !row.settings.ai_model) throw new Error('GENESIS_AI_SETTINGS_INCOMPLETE');
  return { tenant, settings: row.settings, timezone: row.timezone || row.settings.timezone || 'America/Sao_Paulo' };
}

function makeCoreDriver() {
  const testFile = path.join(root, 'scripts/tests/test_whatsapp_sales.cjs');
  const source = fs.readFileSync(testFile, 'utf8');
  const boundary = source.indexOf('\nasync function completedBuyAndSellCatalogChoice');
  if (boundary < 0) throw new Error('SALES_TEST_DRIVER_BOUNDARY_MISSING');
  let prefix = source.slice(0, boundary);
  if (!prefix.includes('async function run({texts=')) throw new Error('SALES_TEST_RUN_BOUNDARY_MISSING');
  prefix = prefix.replace('async function run({texts=', 'async function run({realGemini=false,liveSettings=null,geminiInvoker=null,texts=');
  const settingsBoundary = '  const extensionText=texts.join(\' \');';
  if (!prefix.includes(settingsBoundary)) throw new Error('SALES_TEST_SETTINGS_BOUNDARY_MISSING');
  // Preserve the real tenant policy. Overwriting collect_documents with the
  // test driver's default false previously caused spurious CORE failures.
  prefix = prefix.replace(settingsBoundary, `  if(liveSettings){\n    Object.assign(settings,liveSettings);\n    settings.sales={...sales,...(liveSettings.sales||{})};\n  }\n${settingsBoundary}`);
  const providerBoundary = "    if(u.hostname==='generativelanguage.googleapis.com'){";
  if (!prefix.includes(providerBoundary)) throw new Error('SALES_TEST_GEMINI_BOUNDARY_MISSING');
  prefix = prefix.replace(providerBoundary, `${providerBoundary}\n      if(realGemini){generated++;return geminiInvoker({url,method,body});}`);
  const requestBoundary = "    assert.ok(!/appointments|appointment_/.test(u.pathname),'Sales cannot access appointments');";
  if (!prefix.includes(requestBoundary)) throw new Error('SALES_TEST_REQUEST_BOUNDARY_MISSING');
  prefix = prefix.replace(requestBoundary, `    if(table==='magia_contact_exclusion_status')return {blocked:false,reason:'not_excluded'};\n${requestBoundary}`);
  prefix += '\nmodule.exports={run,blank,inventory};\n';
  const sandbox = { module:{exports:{}}, exports:{}, require, __filename:testFile, __dirname:path.dirname(testFile), console, Buffer, URL, setTimeout, clearTimeout, structuredClone };
  vm.runInNewContext(prefix, sandbox, { filename:'genesis-real-eval-driver.cjs' });
  return sandbox.module.exports;
}

function normalizedInventory(baseInventory) {
  const engine = require(path.join(root, 'clients/wesley_automoveis/genesisCommercialEngine.cjs'));
  const rows = baseInventory.map(row => ({...row,status:'listed',offerable:true,availability_verified:false,price_source:'genesis_sheet'}));
  rows.push(
    {id:'genesis-mercedes-c180-2015',brand:'MERCEDES-BENZ',model:'C180',year:2015,color:'PRETO',fuel:'GASOLINA',km:98000,price_cents:9498000,status:'listed',offerable:true,availability_verified:false,price_source:'genesis_sheet'},
    {id:'genesis-crosser-sold-2021',brand:'YAMAHA',model:'CROSSER SOLD',year:2021,color:'PRETO',fuel:'FLEX',km:70000,price_cents:1498000,status:'sold',offerable:false,availability_verified:false,price_source:'genesis_sheet'},
    {id:'genesis-reserved-vehicle',brand:'FIAT',model:'ARGO RESERVADO',year:2020,color:'BRANCO',fuel:'FLEX',km:50000,price_cents:4490000,status:'reserved',offerable:false,availability_verified:false,price_source:'genesis_sheet'},
    {id:'genesis-unverified-vehicle',brand:'CHEVROLET',model:'ONIX NÃO VERIFICADO',year:2022,color:'CINZA',fuel:'FLEX',km:35000,price_cents:5990000,status:'unverified',offerable:false,availability_verified:false,price_source:'genesis_sheet'}
  );
  return rows.map(row => ({...row,id:row.id || [row.brand,row.model,row.year,row.color].map(engine.normalizeText).join('|'),name:row.name || `${row.brand} ${row.model}`}));
}

function operationFor(body) {
  const instruction = String(body?.system_instruction?.parts?.[0]?.text || '');
  if (instruction.startsWith('NORIA_DIALOGUE_WRITE')) return 'dialogue_write';
  if (instruction.startsWith('NORIA_DIALOGUE_AUDIT')) return 'dialogue_audit';
  if (instruction.startsWith('NORIA_RELATION_AUDIT')) return 'relation_audit';
  if (instruction.startsWith('NORIA_SPOKEN_AVAILABILITY')) return 'spoken_availability';
  if (instruction.includes('Transcreva fielmente')) return 'audio_transcription';
  return 'sales_generate';
}

function parseCandidate(payload) {
  try {
    const text = payload?.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
    return text ? JSON.parse(text) : null;
  } catch (_) { return null; }
}

function extractSemanticValidator(coreSource) {
  const extract = name => {
    const start = coreSource.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`CORE_FUNCTION_MISSING_${name}`);
    let brace = coreSource.indexOf('{', start), depth = 0;
    for (let i=brace;i<coreSource.length;i++) {
      if (coreSource[i] === '{') depth++;
      else if (coreSource[i] === '}' && --depth === 0) return coreSource.slice(start, i+1);
    }
    throw new Error(`CORE_FUNCTION_UNCLOSED_${name}`);
  };
  return new Function(`${extract('salesSemanticFallback')}\n${extract('salesValidateSemanticIntent')}\nreturn salesValidateSemanticIntent;`)();
}

function assertionsFor(expect, semantic, validated, finalReply, savedState) {
  const checks = [];
  const add = (name, pass, actual, expected, severity='semantic') => checks.push({name,pass:Boolean(pass),actual,expected,severity});
  if (expect.primary_any) add('primary_intent', expect.primary_any.includes(semantic?.primary_intent), semantic?.primary_intent, expect.primary_any);
  if (expect.secondary_any) add('secondary_intents', expect.secondary_any.some(value => semantic?.secondary_intents?.includes(value)), semantic?.secondary_intents, expect.secondary_any);
  if (expect.topics_any) add('topics', expect.topics_any.some(value => semantic?.topics?.some(topic => String(topic).toLowerCase().includes(value))), semantic?.topics, expect.topics_any);
  for (const key of ['price_min_cents','price_max_cents']) if (key in expect) add(key, semantic?.catalog?.[key] === expect[key], semantic?.catalog?.[key], expect[key]);
  if ('category' in expect) add('catalog_category', semantic?.catalog?.category === expect.category, semantic?.catalog?.category, expect.category);
  if ('catalog_requested' in expect) add('catalog_requested', semantic?.catalog?.requested === expect.catalog_requested, semantic?.catalog?.requested, expect.catalog_requested);
  if ('selected_ordinal' in expect) add('selected_ordinal', semantic?.references?.selected_ordinal === expect.selected_ordinal, semantic?.references?.selected_ordinal, expect.selected_ordinal);
  if (expect.requires_reference) add('reference_evidence', Boolean(semantic?.references?.evidence_ids?.length), semantic?.references, 'evidence-backed reference');
  if ('changes_preference' in expect) add('changes_preference', semantic?.conversation?.changes_preference === expect.changes_preference, semantic?.conversation?.changes_preference, expect.changes_preference);
  if ('requires_clarification' in expect) add('requires_clarification', semantic?.conversation?.requires_clarification === expect.requires_clarification, semantic?.conversation?.requires_clarification, expect.requires_clarification);
  if ('transaction_mode' in expect) add('transaction_mode', savedState?.transaction_mode === expect.transaction_mode, savedState?.transaction_mode, expect.transaction_mode);
  if (expect.must_not_total_budget) add('deposit_not_total_budget', semantic?.catalog?.price_max_cents !== expect.must_not_total_budget, semantic?.catalog?.price_max_cents, `not ${expect.must_not_total_budget}`,'safety');
  if (expect.must_not_handoff) add('no_forced_handoff', savedState?.ai_locked !== true, savedState?.ai_locked, false,'safety');
  if (expect.must_not_credit_promise) add('no_credit_promise', !/(cr[eé]dito|financiamento).{0,30}(aprovad|garantid)|vai conseguir|com certeza/i.test(finalReply), finalReply, 'no approval promise','safety');
  for (const pattern of expect.forbid_reply || []) add(`reply_forbids_${pattern}`, !new RegExp(pattern,'i').test(finalReply), finalReply, `must not contain ${pattern}`,'safety');
  add('semantic_schema_valid', validated?.valid === true, validated?.validation_errors || null, true,'schema');
  return checks;
}

(async () => {
  const startedAt = new Date().toISOString();
  const live = await getLiveSettings();
  const coreSource = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
  const validateSemantic = extractSemanticValidator(coreSource);
  const driver = makeCoreDriver();
  const inventoryRows = normalizedInventory(driver.inventory);
  const callLog = [];
  let limitReached = false;
  const geminiInvoker = async ({url,method,body}) => {
    if (callLog.length >= maxCalls) { limitReached = true; const error = new Error('EVALUATION_CALL_LIMIT_REACHED'); error.statusCode=400; throw error; }
    const operation = operationFor(body), started = Date.now(), attempt = callLog.length + 1;
    let response, payload, errorText = '';
    try {
      response = await fetch(url,{method,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
      payload = await response.json().catch(()=>null);
      if (!response.ok) { errorText = String(payload?.error?.status || payload?.error?.message || `HTTP_${response.status}`).slice(0,180); const error=new Error(`GEMINI_HTTP_${response.status}`);error.statusCode=response.status;error.response={status:response.status,data:payload};throw error; }
      return payload;
    } finally {
      const parsed = payload ? parseCandidate(payload) : null;
      callLog.push({attempt,operation,http_status:response?.status || null,latency_ms:Date.now()-started,error:errorText||null,
        usage:payload?.usageMetadata||null,finish_reason:payload?.candidates?.[0]?.finishReason||null,
        semantic_intent:operation==='sales_generate'?parsed?.semantic_intent||null:undefined,
        dialogue_plan:operation==='sales_generate'?parsed?.dialogue_plan||null:undefined});
    }
  };

  const priorityRank = {critical:0,high:1,normal:2};
  const selectedCases = smokeOnly
    ? cases.filter(item => item.id === 'S01')
    : [...cases].sort((a,b)=>(priorityRank[a.priority] ?? 9)-(priorityRank[b.priority] ?? 9)).slice(0,caseLimit);
  const results = [];
  for (const testCase of selectedCases) {
    if (callLog.length >= maxCalls || limitReached) break;
    let history = [], lead = null, caseChecks = [], finalReply = '', caseCallsStart = callLog.length, blocked = false;
    const turns = [];
    for (let index=0; index<testCase.turns.length; index++) {
      if (callLog.length >= maxCalls || limitReached) { blocked=true; break; }
      const turn = testCase.turns[index], eventId = `${testCase.id.toLowerCase()}-e${index+1}`;
      if ((testCase.id === 'D01' || testCase.id === 'D02' || testCase.id === 'D04' || testCase.id === 'D06' || testCase.id === 'D07' || testCase.id === 'D08') && !history.length) {
        const listed = inventoryRows.filter(row=>row.offerable!==false).slice(0,3);
        history.push({id:`${testCase.id}-catalog`,direction:'outbound',ai_provider:'sales_core',message_text:listed.map((row,i)=>`${i+1}. ${row.name}`).join('\n'),created_at:new Date(Date.now()-60000).toISOString(),raw_payload:{catalog_context:{contract:'noria_catalog_context_v1',session_id:'initial',displayed_at:new Date(Date.now()-60000).toISOString(),source:'fixture',products:listed.map(row=>({id:row.id}))}}});
      }
      if (testCase.id === 'S02' && !history.length) history.push({id:'s02-catalog',direction:'outbound',ai_provider:'sales_core',message_text:'1. YAMAHA CROSSER SOLD 2021',raw_payload:{catalog_context:{contract:'noria_catalog_context_v1',session_id:'initial',displayed_at:new Date(Date.now()-60000).toISOString(),source:'fixture',products:[{id:'genesis-crosser-sold-2021'}]}}});
      const before = callLog.length;
      let run;
      try {
        run = await driver.run({realGemini:true,liveSettings:live.settings,geminiInvoker,texts:[turn.message],messageIds:[{id:`m-${eventId}`,event_id:eventId}],inventoryRows,
          tenantSlug:'wesley_automoveis',history,lead,contactName:'Cliente Teste',audioEnabled:live.settings.whatsapp_audio_enabled===true,
          collect:live.settings.sales?.collect_documents===true});
      } catch (error) {
        turns.push({index:index+1,message:turn.message,error:String(error.message||error)});blocked=true;break;
      }
      const primary = callLog.slice(before).find(call=>call.operation==='sales_generate');
      const semantic = primary?.semantic_intent || null;
      const evidenceIds = history.filter(row=>row.direction==='inbound').map(row=>String(row.id||row.event_id)).concat(eventId);
      const validated = validateSemantic(semantic, inventoryRows, evidenceIds);
      const outbound = run.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
      finalReply = run.sent[0] || outbound?.body?.message_text || '';
      const saved = run.saved.find(item=>item.p_state) || null;
      const savedState = saved?.p_state || lead?.state || {};
      const checks = assertionsFor(turn.expect||{},semantic,validated,finalReply,{...savedState,ai_locked:run.result?.handoff===true});
      caseChecks.push(...checks);
      turns.push({index:index+1,message:turn.message,expected:turn.expect,model:live.settings.ai_model,semantic_intent:semantic,semantic_validation:validated,
        core_result:run.result,request_trace:run.calls.map(call=>{try{const parsed=new URL(call.url);return `${call.method||'GET'} ${parsed.hostname}${parsed.pathname}`;}catch(_){return String(call.url).slice(0,160);}}),
        executor:{state:savedState,product:saved?.p_product||null,registered:saved?.p_register===true,handoff:run.result?.handoff===true},final_reply:finalReply,checks,calls:callLog.slice(before).map(call=>call.attempt)});
      history.push({id:eventId,event_id:eventId,direction:'inbound',message_text:turn.message,text:turn.message,created_at:new Date().toISOString(),raw_payload:{}});
      if (outbound) history.push({id:`${testCase.id.toLowerCase()}-a${index+1}`,direction:'outbound',ai_provider:'sales_core',message_text:finalReply,created_at:new Date().toISOString(),raw_payload:outbound.body?.raw_payload||{}});
      if (saved) lead={id:'lead-eval',revision:(lead?.revision||0)+1,stage_key:saved.p_stage||'sales_qualifying',state:savedState,product:saved.p_product||null,ai_locked:false};
    }
    const failed = caseChecks.filter(check=>!check.pass), safetyFailed=failed.some(check=>check.severity==='safety'||check.severity==='schema');
    const status = blocked?'BLOCKED':failed.length?(safetyFailed?'FAIL':'PARTIAL'):'PASS';
    results.push({id:testCase.id,category:testCase.category,priority:testCase.priority,status,justification:blocked?'Execution stopped by call limit or runtime error':failed.length?`${failed.length} assertion(s) failed`:'All explicit assertions passed',turns,calls:callLog.slice(caseCallsStart).map(call=>call.attempt)});
  }

  const countBy = key => results.reduce((acc,item)=>(acc[item[key]]=(acc[item[key]]||0)+1,acc),{});
  const tokenTotals = callLog.reduce((acc,call)=>{for(const [key,value] of Object.entries(call.usage||{}))if(typeof value==='number')acc[key]=(acc[key]||0)+value;return acc;},{});
  const metrics = {started_at:startedAt,finished_at:new Date().toISOString(),model:live.settings.ai_model,prompt_revision:live.settings.prompt_revision||null,
    prompt_sha256:crypto.createHash('sha256').update(String(live.settings.system_prompt)).digest('hex').toUpperCase(),prepared_cases:cases.length,
    executed_cases:results.length,max_calls:maxCalls,real_calls:callLog.length,call_limit_reached:limitReached,
    call_budget_exhausted:callLog.length>=maxCalls,remaining_cases:cases.length-results.length,
    status_counts:countBy('status'),category_counts:countBy('category'),
    operation_counts:callLog.reduce((acc,item)=>(acc[item.operation]=(acc[item.operation]||0)+1,acc),{}),token_totals:tokenTotals,
    latency_ms:{min:callLog.length?Math.min(...callLog.map(c=>c.latency_ms)):null,max:callLog.length?Math.max(...callLog.map(c=>c.latency_ms)):null,average:callLog.length?Math.round(callLog.reduce((a,c)=>a+c.latency_ms,0)/callLog.length):null},
    http_errors:callLog.filter(call=>call.http_status!==200).length,schema_errors:results.flatMap(r=>r.turns).filter(t=>t.semantic_validation?.valid===false).length};
  fs.writeFileSync(path.join(outDir,'evaluation-cases.json'),JSON.stringify(cases,null,2));
  fs.writeFileSync(path.join(outDir,'evaluation-results.json'),JSON.stringify({environment:{tenant_slug:live.tenant.slug,model:live.settings.ai_model,prompt_revision:live.settings.prompt_revision||null,production_side_effects:false,supabase_access:'tenant settings read-only; inventory fixture'},results,calls:callLog},null,2));
  fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(metrics,null,2));
  const auditedMetrics = require('./audit-results.cjs').auditFiles();
  console.log(JSON.stringify(auditedMetrics,null,2));
})().catch(error => { console.error(String(error?.stack||error)); process.exitCode=1; });
