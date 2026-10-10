const fs = require('node:fs');
const path = require('node:path');

// The generated runtime must start from the operationally reviewed Hotfix12
// Core. Reassembling it from the legacy Telegram baseline silently discarded
// catalog-reference, campaign and safe-dedup fixes.
const root = path.resolve(__dirname, '../../..');
const hotfixFile = path.join(root, 'n8n/workflows/NORIA_Hotfix12_CATALOGO_REFERENCIAS_PRODUTOS_LAYOUT.json');
const workflow = JSON.parse(fs.readFileSync(hotfixFile, 'utf8'));
const coreNode = workflow.nodes.find((node) => (
  node.name === 'Processar Conversa WhatsApp' && typeof node?.parameters?.jsCode === 'string'
));
const revision = 'conversation_core_v2_1_9_hotfix12_catalog_referral_product_capture_2026_10_08';

if (!coreNode) throw Error(`Hotfix12 conversation core missing from ${hotfixFile}`);
if (!coreNode.parameters.jsCode.includes(revision)) throw Error('Unexpected Hotfix12 core revision');

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
console.log(`Built WhatsApp conversation core from Hotfix12 (${revision}).`);
