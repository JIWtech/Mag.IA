const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../../app/node_modules/typescript');
const { applyFailureResilience, refreshFailureRuntime } = require('./whatsapp_failure_resilience.cjs');
const { applyCommercialRegressions } = require('./whatsapp_commercial_regressions.cjs');
const { applySemanticIntent } = require('./whatsapp_semantic_intent.cjs');

// The generated runtime must start from the operationally reviewed Hotfix12
// Core. Reassembling it from the legacy Telegram baseline silently discarded
// catalog-reference, campaign and safe-dedup fixes.
const root = path.resolve(__dirname, '../../..');
const hotfixFile = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(hotfixFile, 'utf8'));
const coreNode = workflow.nodes.find((node) => (
  node.name === 'CORE | Motor conversacional único' && typeof node?.parameters?.jsCode === 'string'
));
const legacyRevision = 'conversation_core_v2_1_21_failure_resilience_2026_10_13';
const sourceRevision = 'conversation_core_v2_1_22_gemini_429_resilience_2026_10_13';
const revision = 'conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14';

if (!coreNode) throw Error(`Conversation core missing from ${hotfixFile}`);
if (![legacyRevision, sourceRevision, revision].some(value => coreNode.parameters.jsCode.includes(value))) {
  throw Error('Unexpected conversation core revision');
}

const catalogProductColumns = 'tenant_id,instance_name,product_id,retailer_id,title,description,currency,regular_price_cents,sale_price_cents,effective_price_cents,price_source,availability,visibility,image_url,image_urls,collection_id,matched_inventory_id,match_status,active,price_evidence_source,price_observed_at,synced_at,updated_at';
const catalogStateColumns = 'tenant_id,instance_name,status,last_attempt_at,last_success_at,product_count,reported_count,truncated,error_code,endpoint,updated_at';

// The source of truth remains the reviewed Hotfix12 node.  URLs are literals
// inside an n8n Code node, so use a guarded source transformation rather than
// a silent first-match replace: every expected endpoint must occur exactly once
// and the output is parsed before it can be written.
function replaceCatalogProjection(source, table, columns) {
  const literal = `/rest/v1/${table}?select=*`;
  const projected = `/rest/v1/${table}?select=${columns}`;
  const at = source.indexOf(literal);
  const duplicate = at < 0 ? -1 : source.indexOf(literal, at + literal.length);
  if (at < 0) {
    const projectedAt = source.indexOf(projected);
    const projectedDuplicate = projectedAt < 0 ? -1 : source.indexOf(projected, projectedAt + projected.length);
    if (projectedAt >= 0 && projectedDuplicate < 0) return source;
    throw Error(`Expected exactly one ${table} catalog projection in Hotfix12`);
  }
  if (duplicate >= 0) throw Error(`Expected exactly one ${table} select=* URL in Hotfix12`);
  return source.slice(0, at) + `/rest/v1/${table}?select=${columns}` + source.slice(at + literal.length);
}

let code = coreNode.parameters.jsCode;
// EXT workflows declare passthrough inputs.  An empty `defineBelow` mapping
// replaces the item with `{}` in n8n, losing the validated tenant envelope.
// Remove the stale UI mapping rather than manufacturing fields or coercing
// types: passthrough preserves the complete original payload and its types.
for (const node of workflow.nodes) {
  if (['CORE | Executar EXT Royal 4x4 (CONFIGURAR ID)', 'Executar EXT Nubia (PREENCHER ID)'].includes(node.name)
      && node.type === 'n8n-nodes-base.executeWorkflow') {
    delete node.parameters.workflowInputs;
  }
}
// Genesis has a second, bounded EXT call after the queue claim.  A Code node
// cannot invoke a sub-workflow itself, so this node prepares only trusted
// state and hands it to an explicit Execute Workflow node. It never sends,
// persists commercial decisions, or retries a claim.
const genesisPrepareName = 'CORE | Preparar dispatch Genesis';
const genesisDispatchName = 'CORE | Executar EXT Genesis por turno';
const genesisPrepareCode = `const input = $json || {};
const policy = input.noria_client_policy || {};
if (input.tenant_slug !== 'wesley_automoveis' || policy.contract !== 'noria_policy_v2'
  || policy.tenant_id !== input.tenant_id || policy.tenant_slug !== input.tenant_slug) throw new Error('NORIA_TURN_DISPATCH_POLICY_INVALID');
const base = String($env.SUPABASE_URL || '').replace(/\\/$/, ''), key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_TURN_DISPATCH_DB_UNAVAILABLE');
const headers={apikey:key,Authorization:'Bearer '+key};
const post=(endpoint,body)=>this.helpers.httpRequest({method:'POST',url:base+'/rest/v1/'+endpoint,headers,body,json:true,timeout:7000});
const get=endpoint=>this.helpers.httpRequest({method:'GET',url:base+'/rest/v1/'+endpoint,headers,json:true,timeout:7000});
let claim=null;
try {
const claimResult=await post('rpc/magia_claim_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid});
claim=claimResult;
if (!claim?.claimed) return {json:{...input,noria_preclaimed_turn:claim,noria_dispatch_phase:'turn',noria_dispatch_skip:'queue_empty'}};
const sessionId=String(claim.boundary_id||'');
const messages=Array.isArray(claim.messages)?claim.messages:[];
if (!sessionId || !messages.length || !String(claim.token||'')) throw new Error('NORIA_TURN_DISPATCH_CLAIM_INVALID');
const leadRows=await get('sales_leads?select=id,stage_key,ai_locked,revision,state,product,session_id&tenant_id=eq.'+encodeURIComponent(input.tenant_id)+'&channel_type=eq.whatsapp&chat_id=eq.'+encodeURIComponent(input.remoteJid)+'&session_id=eq.'+encodeURIComponent(sessionId)+'&limit=1');
const lead=Array.isArray(leadRows)?leadRows[0]||null:null;
const eventRows=await get('channel_events?select=id,raw_payload,created_at,delivery_status&tenant_id=eq.'+encodeURIComponent(input.tenant_id)+'&channel_type=eq.whatsapp&external_conversation_id=eq.'+encodeURIComponent(input.remoteJid)+'&direction=eq.outbound&delivery_status=eq.sent&order=created_at.desc,id.desc&limit=31');
const catalogEvent=(Array.isArray(eventRows)?eventRows:[]).find(row=>{
  const raw=row?.raw_payload||{}, context=raw.catalog_context;
  const delivered=row.delivery_status==='sent' && raw.conversation_session_id===sessionId;
  const currentContext=context && context.contract==='noria_catalog_context_v1'
    && context.session_id===sessionId && Array.isArray(context.products) && context.products.every(product=>String(product?.id||''));
  // A legacy id-only payload needs durable proof of this exact session and a
  // confirmed outbound event; a bare array must never cross session boundaries.
  const verifiedLegacy=Array.isArray(raw.catalog_item_ids) && raw.catalog_item_ids.length>0
    && Array.isArray(raw.grouped_message_ids) && raw.grouped_message_ids.length>0;
  return delivered && (currentContext || verifiedLegacy);
});
const catalogContext=catalogEvent?.raw_payload?.catalog_context
  || (catalogEvent?.raw_payload?.catalog_item_ids
    ? {contract:'noria_catalog_context_v1',session_id:sessionId,displayed_at:catalogEvent.created_at||null,source:'verified_channel_event_catalog_item_ids_v1',products:catalogEvent.raw_payload.catalog_item_ids.map(id=>({id:String(id)}))}
    : {products:[],displayed_at:null,source:'none'});
const requestId=String(messages.at(-1)?.event_id||messages.at(-1)?.id||'')+':'+String(claim.token);
return {json:{...input,noria_dispatch_phase:'turn',noria_preclaimed_turn:claim,noria_dispatch_skip:lead?.ai_locked===true?'human_locked':'',contract:'noria_business_operation_v1',operation:'conversation.evaluate',payload:{contract:'noria_business_operation_v1',operation:'conversation.evaluate',tenant_id:input.tenant_id,tenant_slug:input.tenant_slug,session_id:sessionId,request_id:requestId,turn:{message:messages.map(m=>String(m?.text||'')).join('\\n\\n'),grouped_messages:messages.map(m=>({id:m?.id||'',event_id:m?.event_id||'',text:String(m?.text||'')}))},commercial_state:{stage_key:lead?.stage_key||'',ai_locked:lead?.ai_locked===true,revision:Number(lead?.revision||0),state:lead?.state||{},product:lead?.product||null},catalog_context:catalogContext}}};
} catch (error) {
  // Return the claim through the existing queue contract. This makes a failed
  // pre-dispatch retryable instead of leaving a processing lease behind.
  if (claim?.claimed && String(claim.token||'')) {
    try { await post('rpc/magia_finish_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid,p_token:claim.token,p_outcome:'retry'}); } catch (_) {}
  }
  return {json:{...input,noria_preclaimed_turn:{claimed:false,reason:'dispatch_preparation_failed'},noria_dispatch_phase:'turn',noria_dispatch_skip:'preparation_failed',noria_dispatch_error:{code:'TURN_DISPATCH_PREPARATION_FAILED',retryable:true}}};
}`;
new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', genesisPrepareCode);
let prepareNode = workflow.nodes.find(node => node.name === genesisPrepareName);
if (!prepareNode) {
  prepareNode = { id:'e31dc69b-23e6-4f95-8f42-dac70d6c7b10', name:genesisPrepareName,
    type:'n8n-nodes-base.code', typeVersion:2, position:[1260,780],
    parameters:{mode:'runOnceForEachItem',jsCode:genesisPrepareCode} };
  workflow.nodes.push(prepareNode);
} else prepareNode.parameters.jsCode = genesisPrepareCode;
let dispatchNode = workflow.nodes.find(node => node.name === genesisDispatchName);
if (!dispatchNode) {
  dispatchNode = { id:'df82dc23-3ad7-442a-9275-d0d1fb80891f', name:genesisDispatchName,
    type:'n8n-nodes-base.executeWorkflow', typeVersion:1.2, position:[1480,780],
    parameters:{workflowId:{__rl:true,value:'fXGorIlPbyf9Qtsp',mode:'id',cachedResultUrl:'/workflow/fXGorIlPbyf9Qtsp'},mode:'each',options:{waitForSubWorkflow:true}} };
  workflow.nodes.push(dispatchNode);
}
// Let the CORE observe a sub-workflow execution failure and return the
// already-claimed messages through magia_finish_turn('retry').
dispatchNode.onError = 'continueRegularOutput';
workflow.connections[genesisPrepareName] = { main: [[{node:genesisDispatchName,type:'main',index:0}]] };
workflow.connections[genesisDispatchName] = { main: [[{node:coreNode.name,type:'main',index:0}]] };
if (workflow.connections['CORE | Executar EXT Gênesis']) workflow.connections['CORE | Executar EXT Gênesis'] = { main: [[{node:genesisPrepareName,type:'main',index:0}]] };
const resolverNode = workflow.nodes.find(node => node.name === 'CORE - Resolver extensão do tenant');
if (resolverNode?.parameters?.jsCode && !resolverNode.parameters.jsCode.includes("noria_dispatch_phase: 'bootstrap'")) {
  resolverNode.parameters.jsCode = resolverNode.parameters.jsCode.replace("noria_router: 'core_3wf_v1'", "noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap'");
}
code = code.includes(legacyRevision) ? applyFailureResilience(code, ts) : refreshFailureRuntime(code, ts);
code = applyCommercialRegressions(code, ts);
code = applySemanticIntent(code);
// A failed post-claim EXT execution has no provider side effect. Preserve the
// queue message for the next worker instead of treating it as a terminal core
// processing failure. The generic stale fence remains terminal.
const extDispatchRetryOld = "    const outcome = sendAttempted ? 'uncertain' : 'failed';";
const extDispatchRetryNew = "    const outcome = sendAttempted ? 'uncertain'\n      : String(error?.message || '') === 'NORIA_EXT_DISPATCH_UNAVAILABLE' ? 'retry' : 'failed';";
if (code.includes(extDispatchRetryOld)) code = code.replace(extDispatchRetryOld, extDispatchRetryNew);
else if (!code.includes('NORIA_EXT_DISPATCH_UNAVAILABLE')) throw Error('EXT dispatch recovery insertion point missing');
// "Disponível" must describe only the list shown, never guarantee stock.
// Keep the familiar catalog lead while retaining the explicit confirmation
// caveat required for announced (not verified) vehicles.
const advertisedCatalogIntroOld = "if (advertised) intro='Estes são veículos anunciados pela loja (disponibilidade a confirmar):';";
const advertisedCatalogIntroNew = "if (advertised) intro='Hoje temos estas opções de veículos disponíveis para consulta (disponibilidade a confirmar):';";
if (code.includes(advertisedCatalogIntroOld)) code = code.replace(advertisedCatalogIntroOld, advertisedCatalogIntroNew);
else if (!code.includes(advertisedCatalogIntroNew)) throw Error('Advertised catalog intro insertion point missing');
// Preserve validated commercial evidence returned by an extension when the
// shared CORE reloads live tenant settings.  This is deliberately a guarded
// transformation because the reviewed workflow remains the base source.
const businessContextMarker = '// core-extension-business-context-v1';
if (!code.includes(businessContextMarker)) {
  const contextReturn = '  return { tenant, settings: settingRows[0], agent: agentRows[0] || {}, channel: channelRows[0] };';
  const contextReplacement = `  ${businessContextMarker}
  const businessContext = inputJson.noria_business_context;
  if (businessContext !== undefined && (!businessContext || typeof businessContext !== 'object'
    || businessContext.contract !== 'noria_business_result_v1'
    || businessContext.tenant_slug !== tenantSlug)) throw new Error('NORIA_BUSINESS_CONTEXT_INVALID');
  return { tenant, settings: settingRows[0], agent: agentRows[0] || {}, channel: channelRows[0],
    client_policy: tenantBusinessRules, noria_client_policy: tenantBusinessRules,
    noria_business_context: businessContext || null, business_context: businessContext || null };`;
  if (!code.includes(contextReturn)) throw Error('Tenant context return insertion point missing');
  code = code.replace(contextReturn, contextReplacement);
}
const preclaimedTurnMarker = '// core-preclaimed-turn-dispatch-v1';
const claimReplacement = `  ${preclaimedTurnMarker}
  const preclaimed = inputJson.noria_preclaimed_turn;
  if (preclaimed !== undefined) {
    if (!preclaimed || typeof preclaimed !== 'object') throw new Error('NORIA_PRECLAIMED_TURN_INVALID');
    turn = preclaimed;
    if (turn.claimed === true) {
      if (!Array.isArray(turn.messages) || !String(turn.token || '') || !String(turn.boundary_id || '')) throw new Error('NORIA_PRECLAIMED_TURN_INVALID');
      const dispatched = inputJson.noria_business_context;
      if (!dispatched || typeof dispatched !== 'object') {
        if (inputJson.error) throw new Error('NORIA_EXT_DISPATCH_UNAVAILABLE');
        throw new Error('NORIA_TURN_DISPATCH_STALE');
      }
      if (dispatched.phase === 'bootstrap' || dispatched.session_id !== turn.boundary_id
        || !String(dispatched.request_id || '').endsWith(':' + String(turn.token))) throw new Error('NORIA_TURN_DISPATCH_STALE');
    }
  } else {
    turn = await queueRpc('claim');
  }
  if (!turn.claimed) return { ok: true, skipped: true, reason: turn.reason };`;
if (!code.includes(preclaimedTurnMarker)) {
  const claimNeedle = "  turn = await queueRpc('claim');\n  if (!turn.claimed) return { ok: true, skipped: true, reason: turn.reason };";
  if (!code.includes(claimNeedle)) throw Error('Queue claim insertion point missing');
  code = code.replace(claimNeedle, claimReplacement);
} else {
  const existingStart = code.indexOf(preclaimedTurnMarker);
  const existingEnd = code.indexOf("\n  if (!turn.claimed) return { ok: true, skipped: true, reason: turn.reason };", existingStart);
  if (existingEnd < 0) throw Error('Existing preclaimed turn dispatch boundary missing');
  const end = existingEnd + "\n  if (!turn.claimed) return { ok: true, skipped: true, reason: turn.reason };".length;
  code = code.slice(0, existingStart - 2) + claimReplacement + code.slice(end);
}
code = replaceCatalogProjection(code, 'whatsapp_catalog_products', catalogProductColumns);
code = replaceCatalogProjection(code, 'whatsapp_catalog_sync_state', catalogStateColumns);
// Deterministic Genesis priority: a current WhatsApp catalog selection plus an
// availability question is a purchase focus, regardless of older sell state.
const catalogPriorityNeedle = "  const intentDecision=salesApplyIntentEvidence(lead?.state||{},currentIntentAmbiguity?salesMergeState(lead?.state||{},{}):(generated.state||{}),history,turn.messages);";
const catalogPriorityMarker = '  // catalog-current-turn-priority';
const catalogPriorityReplacement = `${catalogPriorityNeedle}\n${catalogPriorityMarker}\n  const currentCatalog=salesExplicitCurrentCatalogReferral(turn.messages);\n  if (directCatalogAnswer&&currentCatalog) {\n    const wasSelling=['sell','buy_and_sell'].includes(salesModeFor(lead?.state||{}));\n    intentDecision.state.transaction_mode=wasSelling?'buy_and_sell':'buy';\n    intentDecision.state.intent='buy';\n    intentDecision.state.intent_evidence_id=currentCatalog.event_id;\n    if (directCatalogAnswer.matched_product) {\n      intentDecision.state.product_id=directCatalogAnswer.matched_product.id;\n      intentDecision.state.product_evidence=currentCatalog.event_id;\n      intentDecision.state.product_variant_evidence=currentCatalog.event_id;\n    }\n  }`;
if (!code.includes(catalogPriorityMarker)) {
  if (!code.includes(catalogPriorityNeedle)) throw Error('Catalog priority insertion point missing from Hotfix12');
  code = code.replace(catalogPriorityNeedle, catalogPriorityReplacement);
}
// Other deterministic guards may merge state after intent resolution. Apply the
// current-turn catalog priority at the final commercial-state boundary as well,
// so a historical sale remains a trade-in instead of retaking the reply focus.
const catalogPriorityFinalMarker = '  // catalog-current-turn-priority-final';
const catalogPriorityFinalNeedle = "  const s=generated.state;\n  const mode=salesModeFor(s);";
if (!code.includes(catalogPriorityFinalMarker)) {
  const catalogPriorityFinalReplacement = `  ${catalogPriorityFinalMarker}\n  if (directCatalogAnswer&&currentCatalog) {\n    const wasSelling=['sell','buy_and_sell'].includes(salesModeFor(lead?.state||{}));\n    const product=directCatalogAnswer.matched_product;\n    generated.state.transaction_mode=wasSelling?'buy_and_sell':'buy';\n    generated.state.intent='buy';\n    generated.state.intent_evidence_id=currentCatalog.event_id;\n    if (product) {\n      generated.product=product;\n      generated.state.product_id=product.id;\n      generated.state.product_evidence=currentCatalog.event_id;\n      generated.state.product_variant_evidence=currentCatalog.event_id;\n      generated.state.buy_interest={...(generated.state.buy_interest||{}),brand:product.brand||'',model:product.model||'',year:product.year||null,raw_mention:product.name||product.model||'',product_id:product.id,evidence_ids:[...new Set([...(generated.state.buy_interest?.evidence_ids||[]),currentCatalog.event_id].filter(Boolean))].slice(-30)};\n    }\n  }\n${catalogPriorityFinalNeedle}`;
  if (!code.includes(catalogPriorityFinalNeedle)) throw Error('Catalog priority final insertion point missing from Hotfix12');
  code = code.replace(catalogPriorityFinalNeedle, catalogPriorityFinalReplacement);
}
// The final direct-catalog reply is the authoritative focus for this turn. A
// previous sale is retained in transaction_mode as a trade-in, not as intent.
const directCatalogStaleIntent = "    s.intent=hadSell?'sell':'buy';";
const directCatalogCurrentIntent = "    s.intent='buy';";
if (code.includes(directCatalogStaleIntent)) {
  if (code.indexOf(directCatalogStaleIntent) !== code.lastIndexOf(directCatalogStaleIntent)) {
    throw Error('Ambiguous direct catalog intent replacement in Hotfix12');
  }
  code = code.replace(directCatalogStaleIntent, directCatalogCurrentIntent);
}
// Selectively retain the REVIEW's safe Nubia improvement: only a reservation
// that overlaps the requested service window is blocked. This preserves the
// Hotfix12 scheduler/RPC and avoids importing its older workflow identity.
if (!code.includes('NB_OVERLAPPING_FUTURE_APPOINTMENT')) {
  const guardStart = code.indexOf('function groundingGuardNubiaFutureAppointment(context) {');
  const guardEnd = code.indexOf('\nasync function schedulingReserve', guardStart);
  if (guardStart < 0 || guardEnd < 0) throw Error('Nubia future-appointment guard missing from Hotfix12');
  const nubiaGuard = `function groundingGuardNubiaFutureAppointment(context, state) {
  if (context.tenant?.slug !== 'clinica_nubia_oficial' || !schedulingEnabled(context)) return;
  if (!state?.date || !state?.time || !state?.service_id) throw new Error('INVALID_BOOKING_STATE');
  const plannedStart = parseAppointmentStartAt(state.date, state.time, context);
  const startMs = Date.parse(plannedStart || '');
  if (!Number.isFinite(startMs)) throw new Error('INVALID_BOOKING_START');
  const configuredMinutes = Number(settingsFor(context).appointment_scheduling?.duration_minutes || 90);
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) throw new Error('INVALID_BOOKING_DURATION');
  const durationMs = configuredMinutes * 60000;
  const searchFrom = new Date(startMs - Math.max(durationMs, 180 * 60000)).toISOString();
  const searchUntil = new Date(startMs + durationMs).toISOString();
  const rows = await supabaseGet('/rest/v1/appointments?select=id,starts_at,ends_at,status,title,metadata'
    + '&tenant_id=eq.' + encodeFilter(context.tenant.id)
    + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
    + '&starts_at=gte.' + encodeFilter(searchFrom)
    + '&starts_at=lt.' + encodeFilter(searchUntil)
    + '&order=starts_at.asc&limit=101');
  if (!Array.isArray(rows) || rows.length >= 101) throw new Error('FUTURE_APPOINTMENT_LOOKUP_UNAVAILABLE');
  const inactive = new Set(['cancelled','canceled','completed','done','no_show','cancelado','cancelada','deleted']);
  for (const row of rows) {
    if (inactive.has(normalizeText(row.status))) continue;
    const priorStart = Date.parse(row.starts_at || '');
    if (!Number.isFinite(priorStart)) continue;
    const savedEnd = Date.parse(row.ends_at || '');
    const priorEnd = Number.isFinite(savedEnd) && savedEnd > priorStart ? savedEnd : priorStart + durationMs;
    if (priorStart >= startMs + durationMs || priorEnd <= startMs) continue;
    const sameService = String(row.metadata?.service_id || '') === String(state.service_id);
    const exactStart = priorStart === startMs;
    const error = new Error(sameService && exactStart
      ? 'NB_DUPLICATE_FUTURE_APPOINTMENT' : 'NB_OVERLAPPING_FUTURE_APPOINTMENT');
    error.existingAppointment = row;
    throw error;
  }
}
`;
  code = code.slice(0, guardStart) + nubiaGuard + code.slice(guardEnd);
}
const nubiaGuardCall = 'await groundingGuardNubiaFutureAppointment(context);';
if (code.includes(nubiaGuardCall)) {
  if (code.indexOf(nubiaGuardCall) !== code.lastIndexOf(nubiaGuardCall)) throw Error('Ambiguous Nubia guard call in Hotfix12');
  code = code.replace(nubiaGuardCall, 'await groundingGuardNubiaFutureAppointment(context, event.raw_payload.conversation_state);');
}
if (/whatsapp_catalog_(products|sync_state)\\?select=\\*/.test(code)) throw Error('Catalog wildcard select survived build');
new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', code);
fs.writeFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), code.replace(/\r?\n/g, '\r\n'));
// Keep the reviewed Hotfix12 workflow as the source consumed by the next build.
// Only the Code-node body is updated: node IDs, positions, metadata and graph
// connections remain untouched.
coreNode.parameters.jsCode = code;
fs.writeFileSync(hotfixFile, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Built WhatsApp conversation core (${revision}).`);
