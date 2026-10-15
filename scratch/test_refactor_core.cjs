'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hotfixFile = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(hotfixFile, 'utf8'));
const coreNode = workflow.nodes.find(n => n.name === 'CORE | Motor conversacional único');

let code = coreNode.parameters.jsCode;

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label} insertion point`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label} insertion point`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

// 1. Generic dispatcher & price authorized & false availability guard
const dispatcher = `// generic-commercial-operations-dispatcher-v1
function salesAmountPriceParser(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\\s+/g, ' ').replace(/^R\\$\\s*/i, '').trim();
  const abbreviated = compact.match(/^(\\d+(?:[.,]\\d+)?)\\s*(?:mil|k)\\b/i);
  if (abbreviated) return Number(abbreviated[1].replace(',', '.')) * 1000;
  const normalized = compact.replace(/\\./g, '').replace(',', '.');
  return /^\\d+(?:\\.\\d{1,2})?$/.test(normalized) && Number.isFinite(Number(normalized)) && Number(normalized) > 0 ? Number(normalized) : null;
}

function executeCommercialOperationSync(context, operation, payload = {}) {
  const policy = context?.client_policy || context?.noria_client_policy || context?.policy || {};
  const tSlug = context?.tenant?.slug || policy.tenant_slug || (typeof tenantSlug !== 'undefined' ? tenantSlug : '');
  const tId = context?.tenant?.id || policy.tenant_id || (context?.tenant && context?.tenant?.id) || '';
  const bCtx = context?.noria_business_context || context?.business_context || {};

  if (operation === 'inventory.filter_catalog' && Array.isArray(bCtx.offerable_catalog)) {
    const query = payload.query || payload.audience || 'all';
    if (query === 'all') {
      return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { items: bCtx.offerable_catalog, count: bCtx.offerable_catalog.length }, handoff: { required: false, reason: null, message: null } };
    }
  }
  if (operation === 'inventory.resolve_selection' && bCtx.resolved_selection) {
    return { contract: 'noria_business_result_v1', operation, status: bCtx.resolved_selection.product ? 'ok' : 'not_found', data: bCtx.resolved_selection, handoff: { required: false, reason: null, message: null } };
  }
  if (operation === 'auction.evaluate_handoff' && bCtx.auction) {
    return { contract: 'noria_business_result_v1', operation, status: 'ok', data: bCtx.auction.classification || bCtx.auction, handoff: bCtx.auction };
  }
  if (operation === 'financing.evaluate' && bCtx.financing) {
    return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { is_financing_question: bCtx.financing.active, reply: bCtx.financing.reply, pending_requirement: bCtx.financing.active ? 'deposit' : '' }, handoff: { required: false, reason: null, message: null } };
  }

  if (typeof policy.executeOperationSync === 'function') {
    return policy.executeOperationSync(operation, { ...payload, tenant_slug: tSlug, tenant_id: tId }, context);
  }

  if (tSlug === 'wesley_automoveis') {
    try {
      const gEngine = require('../../clients/wesley_automoveis/genesisCommercialEngine.cjs');
      if (gEngine) {
        if (operation === 'inventory.resolve_selection') {
          const res = gEngine.resolveSelection(payload.text, payload.inventory, payload.catalog_context);
          return { contract: 'noria_business_result_v1', operation, status: res.product ? 'ok' : 'not_found', data: res, handoff: { required: false, reason: null, message: null } };
        }
        if (operation === 'inventory.filter_catalog') {
          const items = gEngine.filterOfferableCatalog(payload.inventory, payload.query || payload.audience || 'all');
          return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { items, count: items.length }, handoff: { required: false, reason: null, message: null } };
        }
        if (operation === 'auction.evaluate_handoff') {
          const handoff = gEngine.evaluateAuctionHandoff(payload.text, payload.state, payload.inventory, payload.product);
          return { contract: 'noria_business_result_v1', operation, status: 'ok', data: handoff, handoff: { required: handoff.required, reason: handoff.reason, message: handoff.message } };
        }
        if (operation === 'financing.evaluate') {
          const isFin = gEngine.isFinancingQuestion(payload.text, payload.prior_pending);
          return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { is_financing_question: isFin, reply: isFin ? gEngine.formatFinancingReply(payload.text, payload.product) : null, pending_requirement: isFin && !payload.product ? 'deposit' : '' }, handoff: { required: false, reason: null, message: null } };
        }
        if (operation === 'vehicle.trade_in') {
          return gEngine.executeBusinessOperation('vehicle.trade_in', payload, context);
        }
        if (operation === 'customer.name_progress') {
          return gEngine.executeBusinessOperation('customer.name_progress', payload, context);
        }
      }
    } catch (_) {}
  }

  return { contract: 'noria_business_result_v1', operation, status: 'unsupported', data: null, handoff: { required: false, reason: null, message: null } };
}

async function executeCommercialOperation(context, operation, payload = {}) {
  const syncRes = executeCommercialOperationSync(context, operation, payload);
  if (syncRes.status !== 'unsupported') return syncRes;

  const policy = context?.client_policy || context?.noria_client_policy || context?.policy || {};
  const tSlug = context?.tenant?.slug || policy.tenant_slug || (typeof tenantSlug !== 'undefined' ? tenantSlug : '');
  const tId = context?.tenant?.id || policy.tenant_id || (context?.tenant && context?.tenant?.id) || '';
  const bCtx = context?.noria_business_context || context?.business_context || {};

  if (operation === 'inventory.list' && Array.isArray(bCtx.inventory)) {
    return { contract: 'noria_business_result_v1', operation, status: 'ok', data: { items: bCtx.inventory, count: bCtx.inventory.length }, handoff: { required: false, reason: null, message: null } };
  }

  if (typeof policy.executeOperation === 'function') {
    return await policy.executeOperation(operation, { ...payload, tenant_slug: tSlug, tenant_id: tId }, context);
  }

  if (tSlug === 'wesley_automoveis') {
    try {
      const gEngine = require('../../clients/wesley_automoveis/genesisCommercialEngine.cjs');
      if (gEngine && typeof gEngine.executeBusinessOperation === 'function') {
        return await gEngine.executeBusinessOperation(operation, { ...payload, tenant_slug: tSlug, tenant_id: tId }, {
          ...context,
          httpRequest: helpers.httpRequest.bind(helpers),
          env: typeof env === 'function' ? env : (name => (typeof $env !== 'undefined' ? $env[name] : null)),
          settings: settingsFor(context),
        });
      }
    } catch (_) {}
  }

  return { contract: 'noria_business_result_v1', operation, status: 'unsupported', data: null, handoff: { required: false, reason: null, message: null } };
}

function salesPriceAuthorized(context = {}, row = null) {
  const settings = settingsFor(context);
  const mode = settings.sales?.whatsapp_catalog_price_mode;
  if (mode === 'sheet_authorized') return true;
  const source = String(row?.price_source || '');
  return source === 'genesis_sheet' || source === 'authorized_sheet' || source.startsWith('whatsapp_catalog_');
}

function salesFalseAvailabilityClaim(text = '') {
  const value = normalizeText(text);
  return (/\\b(?:temos|esta|estao|existe|possui)\\b.{0,100}\\bdisponive(?:l|is)\\b/.test(value)
      || /\\bpronta\\s+entrega\\b/.test(value))
    && !/\\bnao\\b.{0,100}\\bdisponive(?:l|is)\\b/.test(value);
}

function salesIsProductSelected(turnText = '', product = null) {
  if (!product) return false;
  const text = normalizeText(turnText).replace(/[^a-z0-9]+/g, ' ').trim();
  const model = normalizeText(product.model || '').replace(/[^a-z0-9]+/g, ' ').trim();
  const brand = normalizeText(product.brand || '').replace(/[^a-z0-9]+/g, ' ').trim();
  const year = Number.isInteger(product.year) ? String(product.year) : '';
  if (!model) return false;
  return [model, brand + ' ' + model, model + ' ' + year, brand + ' ' + model + ' ' + year]
    .map(item => item.trim()).includes(text);
}
`;

// 1. Replace salesGenesisSheetPrice and salesParseGenesisSheetValues
const parserStart = code.indexOf('function salesGenesisSheetPrice(value) {');
const parserEnd = code.indexOf('\nfunction salesParseInventory(text) {', parserStart);
if (parserStart >= 0 && parserEnd >= 0) {
  code = code.slice(0, parserStart) + dispatcher + code.slice(parserEnd);
  console.log('1. Replaced parser block with dispatcher');
}

// 2. Replace salesInventory
const invStart = code.indexOf('async function salesInventory(context, forceRefresh = false) {');
const invEnd = code.indexOf('\nasync function salesLoadLead(context) {', invStart);
if (invStart >= 0 && invEnd >= 0) {
  const newInventory = `async function salesInventory(context, forceRefresh = false) {
  if (!forceRefresh && Array.isArray(salesInventoryMemo)) return salesInventoryMemo;
  const settings = settingsFor(context);
  let canonical;
  const opResult = await executeCommercialOperation(context, 'inventory.list', { forceRefresh });
  if (opResult.status === 'ok' && Array.isArray(opResult.data?.items)) {
    canonical = opResult.data.items;
  } else {
    const id = settings.sales?.sheet_id;
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(id || '')) throw new Error('INVENTORY_NOT_CONFIGURED');
    const text = await helpers.httpRequest({
      method: 'GET',
      url: 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:json&headers=1',
      json: false,
      timeout: 10000,
    });
    canonical = salesParseInventory(text);
  }
  const whatsappRows = await salesWhatsappCatalog(context, canonical, forceRefresh);
  let merged = salesMergeWhatsappCatalog(canonical, whatsappRows);
  if (salesPriceAuthorized(context)) {
    merged = merged.filter(row => !row.catalog_only).map(row => ({
      ...row,
      price_cents: row.canonical_price_cents || row.price_cents,
      customer_price_cents: row.canonical_price_cents || row.price_cents,
      price_source: row.price_source || 'authorized_sheet',
      availability_verified: row.status === 'listed',
    }));
  }
  if (salesWhatsappPriceOnly(context)) {
    for (const row of merged) {
      const confirmed = /^whatsapp_catalog_/.test(String(row.price_source || '')) && salesPriceKnown(row);
      if (!confirmed) {
        row.canonical_price_cents = row.canonical_price_cents || row.price_cents || null;
        row.price_cents = null;
        row.customer_price_cents = null;
        row.price_source = 'whatsapp_unverified';
      }
    }
  }
  salesInventoryMemo = merged;
  return merged;
}`;
  code = code.slice(0, invStart) + newInventory + code.slice(invEnd);
  console.log('2. Replaced salesInventory');
}

// 3. Replace salesGenesisFinancingQuestion block
const finStart = code.indexOf("function salesGenesisFinancingQuestion(text = '', priorPending = '') {");
const finEnd = code.indexOf('\nfunction salesDemonstrativeVehicleReference(value = \'\') {', finStart);
if (finStart >= 0 && finEnd >= 0) {
  code = code.slice(0, finStart) + code.slice(finEnd + 1);
  console.log('3. Removed salesGenesisFinancingQuestion block');
}

// 4. Replace salesGenesisSheetPriceAuthorized, salesGenesisBareProductSelection, salesGenesisFalseAvailabilityClaim
const authStart = code.indexOf('function salesGenesisSheetPriceAuthorized(context = {}) {');
const authEnd = code.indexOf('\nfunction salesPriceKnown(row = {}) {', authStart);
if (authStart >= 0 && authEnd >= 0) {
  code = code.slice(0, authStart) + code.slice(authEnd + 1);
  console.log('4. Removed salesGenesisSheetPriceAuthorized & bare product selection definitions');
}

// 5. Replace salesGenesisTradeInOffer
const tradeStart = code.indexOf('function salesGenesisTradeInOffer(history = [], messages = [], previous = {}) {');
const tradeEnd = code.indexOf('\nfunction salesOwnVehicleOfferEvidence(', tradeStart);
if (tradeStart >= 0 && tradeEnd >= 0) {
  code = code.slice(0, tradeStart) + code.slice(tradeEnd + 1);
  console.log('5. Removed salesGenesisTradeInOffer definition');
}

// 6. Replace salesGenesisCatalogAudience, salesGenesisIsKnownMotorcycle, salesGenesisCatalogFilter
const audStart = code.indexOf('function salesGenesisCatalogAudience(text = \'\') {');
const audEnd = code.indexOf('\nfunction salesRecentCatalogContext(', audStart);
if (audStart >= 0 && audEnd >= 0) {
  code = code.slice(0, audStart) + code.slice(audEnd + 1);
  console.log('6. Removed salesGenesisCatalogAudience / Filter definitions');
}

// 7. Replace salesGenesisCatalogOrdinal & salesGenesisExplicitCatalogBuy
const ordStart = code.indexOf('function salesGenesisCatalogOrdinal(text = \'\') {');
const ordEnd = code.indexOf('\nfunction salesCatalogChoice(', ordStart);
if (ordStart >= 0 && ordEnd >= 0) {
  code = code.slice(0, ordStart) + code.slice(ordEnd + 1);
  console.log('7. Removed salesGenesisCatalogOrdinal definitions');
}

// 8. Replace salesGenesisNameProgressReply
const nameStart = code.indexOf("function salesGenesisNameProgressReply(text = '', state = {}, product = null, history = []) {");
const nameEnd = code.indexOf('\nfunction salesLastPendingRequirement(history = []) {', nameStart);
if (nameStart >= 0 && nameEnd >= 0) {
  code = code.slice(0, nameStart) + code.slice(nameEnd + 1);
  console.log('8. Removed salesGenesisNameProgressReply definition');
}

// 9. Replace salesGenesisRepeatedDeferredSale
const repStart = code.indexOf("function salesGenesisRepeatedDeferredSale(text = '', mode = '', previousState = {}) {");
const repEnd = code.indexOf('\nfunction salesMentionedPriceCents(', repStart);
if (repStart >= 0 && repEnd >= 0) {
  code = code.slice(0, repStart) + code.slice(repEnd + 1);
  console.log('9. Removed salesGenesisRepeatedDeferredSale definition');
}

// 10. Replace salesGenesisExplicitListingRequested
const listStart = code.indexOf("function salesGenesisExplicitListingRequested(text = '') {");
const listEnd = code.indexOf('\nfunction salesVehiclePhotoRequested(text = \'\') {', listStart);
if (listStart >= 0 && listEnd >= 0) {
  code = code.slice(0, listStart) + code.slice(listEnd + 1);
  console.log('10. Removed salesGenesisExplicitListingRequested definition');
}

// 11. Replace auction classifier block
const aucStart = code.indexOf('  // genesis-sheet-price-and-auction-v6');
const aucEnd = code.indexOf('\n  const cashPurchase=', aucStart);
if (aucStart >= 0 && aucEnd >= 0) {
  const newAuctionClassifier = `  // generic-auction-evaluation-v1
  const auctionOp = executeCommercialOperationSync(context, 'auction.evaluate_handoff', {
    text: latestTurnText,
    state: lead?.state,
    inventory,
    product: generated.product || catalogChoice?.product || salesResolveInventoryReference(latestTurnText, inventory)?.product
      || inventory.find(row => row.id === (generated.state?.product_id || lead?.state?.product_id)) || null,
  });
  const auctionIntent = auctionOp.handoff?.required ? auctionOp.data : null;
  const auctionHandoff = auctionIntent ? {
    requested: true,
    reason: auctionOp.handoff.reason,
    intent: auctionIntent.intent || 'customer_vehicle_offer',
    tenant: tenantSlug,
    vehicle_origin: auctionIntent.origin || 'customer',
    open_question: auctionOp.handoff.message,
  } : null;`;
  code = code.slice(0, aucStart) + newAuctionClassifier + code.slice(aucEnd);
  console.log('11. Replaced auction classifier with generic auction evaluation');
}

// 12. Replace auction branch
const aucBranchStart = code.indexOf('  if (auctionIntent) {');
const aucBranchEnd = code.indexOf('\n  } else if (acceptedHumanOffer || (appraisalWalkInActive && explicitCurrentHumanRequest)) {', aucBranchStart);
if (aucBranchStart >= 0 && aucBranchEnd >= 0) {
  const newAuctionBranch = `  if (auctionIntent && auctionOp?.handoff?.required) {
    stage = cfg.stage_keys.human;
    register = false;
    handoffReason = auctionOp.handoff.reason;
    pendingRequirement = '';
    optionalHumanOffer = null;
    followUpDisposition = 'resolved';
    reply = auctionOp.handoff.message;
    event.raw_payload = { ...(event.raw_payload || {}), auction_vehicle_purchase: auctionHandoff };
  }`;
  // Keep original 'else if' by skipping the '\n  }'
  code = code.slice(0, aucBranchStart) + newAuctionBranch + code.slice(aucBranchEnd + 4);
  console.log('12. Replaced auction handoff branch');
}

// 13. Replace tradeIn in turn
code = code.replace(
  "const tradeInContext=salesGenesisTradeInOffer(history,turn.messages,lead?.state||{});",
  "const tradeInResult=executeCommercialOperationSync(context, 'vehicle.trade_in', { history, messages: turn.messages, previous: lead?.state||{}, prior_pending: salesLastPendingRequirement(history) });\n  const tradeInContext=tradeInResult.data;"
);
console.log('13. Replaced tradeIn turn call');

// 14. Replace catalog ordinal choice in salesCatalogChoice (SYNC!)
code = code.replace(
  "  if (index===null) index=salesGenesisCatalogOrdinal(text); // commercial-catalog-continuity-v1",
  "  const selectionOp=executeCommercialOperationSync(context, 'inventory.resolve_selection', { text, inventory, catalog_context: recent });\n  if (selectionOp.status==='ok' && selectionOp.data?.product) return { product: selectionOp.data.product, invalid: false, ambiguous: false, candidates: [], contextual: true };"
);
console.log('14. Replaced catalog ordinal choice in salesCatalogChoice');

// 15. Replace financingQuestion in turn
code = code.replace(
  "const financingQuestion=tenantSlug==='wesley_automoveis' && ['buy','buy_and_sell'].includes(mode)\n    && salesGenesisFinancingQuestion(turnText,salesLastPendingRequirement(history));",
  "const financingOp=executeCommercialOperationSync(context, 'financing.evaluate', { text: turnText, product: generated.product, prior_pending: salesLastPendingRequirement(history) });\n  const financingQuestion=financingOp.status==='ok' && financingOp.data?.is_financing_question;"
);
code = code.replace(
  "reply=salesGenesisFinancingQuestionReply(turnText,generated.product);",
  "reply=financingOp.data?.reply || reply;"
);
code = code.replace(
  "pendingRequirement=salesGenesisGeneralFinancingQuestion(turnText)?'deposit':'';register=false;",
  "pendingRequirement=financingOp.data?.pending_requirement || '';register=false;"
);
console.log('15. Replaced financing evaluation in turn');

// 16. Replace catalog filter calls
const catFilterCall = "if(naturalPlan&&catalogRequested)catalogItems=salesCatalogItems(salesGenesisCatalogFilter(inventory,({cars:'carros',motorcycles:'motos',all:''})[naturalPlan.memory.catalog_audience||'all']));";
if (code.includes(catFilterCall)) {
  code = replaceOnce(code, catFilterCall,
    "if(naturalPlan&&catalogRequested){\n    const filterOp=executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText, audience: naturalPlan.memory.catalog_audience });\n    catalogItems=salesCatalogItems(filterOp.status==='ok' && Array.isArray(filterOp.data?.items) ? filterOp.data.items : inventory);\n  }",
    'catalog filter call');
  console.log('16. Replaced catalog filter call');
}

// 17. Replace name progress reply
code = code.replace(
  "const nameProgressReply=salesGenesisNameProgressReply(turnText,s,generated.product,history);",
  "const nameProgressOp=executeCommercialOperationSync(context, 'customer.name_progress', { text: turnText, state: s, product: generated.product, history });\n    const nameProgressReply=nameProgressOp.data?.reply || '';"
);
console.log('17. Replaced name progress reply');

// 18. Fix Caso Jeferson and bare selection price presentation
const bareSelNeedle = `  if (tenantSlug==='wesley_automoveis' && salesGenesisSheetPriceAuthorized(context)
      && generated.product && salesPriceKnown(generated.product)
      && ['buy','buy_and_sell'].includes(mode)
      && !tradeInInquiry && !tradeInOffer && !explicitCatalogRequest && !priceDiscrepancy && !currentIntentAmbiguity
      && !acceptedHumanOffer && !afterSales && !isLocationRequest && !customerDisposition
      && generated.action!=='handoff'
      && ((!/r\\$\\s*\\d/i.test(reply)||catalogActionBlocked||currentProductSelected)
        && ((salesGenesisBareProductSelection(turnText,generated.product) && !salesCurrentSessionHistory(history).some(row=>row.direction==='outbound'&&salesMentionedPriceCents(row.message_text||'').includes(generated.product.price_cents)&&salesResolveInventoryReference(row.message_text||'',inventory).product?.id===generated.product.id))
        || (/\\b(?:preco|valor|quanto|custa)\\b/.test(normalizeText(turnText))
          && !/\\b(?:entrada|sinal|parcela|financiamento)\\b/.test(normalizeText(turnText)))))) {
    reply=salesGenesisBareProductSelection(turnText,generated.product)
      ?generated.product.model+' está anunciada por '+salesMoney(generated.product.price_cents)
        +'\\nA disponibilidade é a confirmar com a equipe\\nQuer mais detalhes?'
      :salesContextualProductReply(generated.product,turnText);
    pendingRequirement='';
    followUpDisposition='awaiting_customer';
  }
  // Public listing is not proof of availability. If Gemini claims a Genesis
  // ANNOUNCED vehicle is currently available, replace that claim with sourced
  // price + explicit stock-confirmation language, keeping the conversation open.
  if (tenantSlug==='wesley_automoveis' && generated.product
      && generated.product.availability_verified!==true
      && salesGenesisFalseAvailabilityClaim(reply)) {
    const label=salesCatalogLabel(generated.product,false);
    reply='A disponibilidade ainda precisa ser confirmada com a equipe\\nQuer que eu confira pra você?';
    pendingRequirement='';
    followUpDisposition='awaiting_customer';
    register=false;
    optionalHumanOffer={reason:'availability_check'};
    event.raw_payload={...(event.raw_payload||{}),genesis_availability_claim_corrected:true};
  }`;

const bareSelReplacement = `  // Caso Jeferson fix & authorized product price presentation
  const isSelectedTurnProduct = !!(catalogChoice?.contextual && catalogChoice?.product && catalogChoice.product.id === generated.product?.id)
    || (generated.product && salesIsProductSelected(turnText, generated.product));
  if (salesPriceAuthorized(context, generated.product)
      && generated.product && salesPriceKnown(generated.product)
      && ['buy','buy_and_sell'].includes(mode)
      && !tradeInInquiry && !tradeInOffer && !explicitCatalogRequest && !priceDiscrepancy && !currentIntentAmbiguity
      && !acceptedHumanOffer && !afterSales && !isLocationRequest && !customerDisposition
      && generated.action!=='handoff'
      && ((!/r\\$\\s*\\d/i.test(reply)||catalogActionBlocked||currentProductSelected)
        && (isSelectedTurnProduct
          || (/\\b(?:preco|valor|quanto|custa)\\b/.test(normalizeText(turnText))
            && !/\\b(?:entrada|sinal|parcela|financiamento)\\b/.test(normalizeText(turnText)))))) {
    reply = generated.product.model+' está anunciada por '+salesMoney(generated.product.price_cents)
      +'\\nA disponibilidade é a confirmar com a equipe\\nQuer mais detalhes?';
    pendingRequirement='';
    followUpDisposition='awaiting_customer';
  }
  if (generated.product
      && generated.product.availability_verified!==true
      && salesFalseAvailabilityClaim(reply)) {
    reply='A disponibilidade ainda precisa ser confirmada com a equipe\\nQuer que eu confira pra você?';
    pendingRequirement='';
    followUpDisposition='awaiting_customer';
    register=false;
    optionalHumanOffer={reason:'availability_check'};
    event.raw_payload={...(event.raw_payload||{}),genesis_availability_claim_corrected:true};
  }`;

code = replaceOnce(code, bareSelNeedle, bareSelReplacement, 'bare product selection & Jeferson fix');
console.log('18. Replaced bare product selection & Jeferson fix');

// Replace salesMentionedPriceCents
const mentionStart = code.indexOf('function salesMentionedPriceCents(text = \'\') {');
const mentionEnd = code.indexOf('\n// commercial-money-context-v2', mentionStart);
if (mentionStart >= 0 && mentionEnd >= 0) {
  const newMentioned = `function salesMentionedPriceCents(text = '') {
  const raw = String(text || '');
  const candidates = [];
  for (const match of raw.matchAll(/R\\$\\s*(\\d+(?:\\.\\d{3})*(?:,\\d{1,2})?)(?:\\s*(?:mil|k))?/gi)) {
    const value = salesAmountPriceParser(match[0]);
    if (Number.isFinite(value) && value > 0) candidates.push(Math.round(value * 100));
  }
  for (const match of normalizeText(raw).matchAll(/\\b(\\d+(?:[.,]\\d+)?)\\s*(?:mil|k)\\b/g)) {
    const value = salesAmountPriceParser(match[0]);
    if (Number.isFinite(value) && value > 0) candidates.push(Math.round(value * 100));
  }
  return [...new Set(candidates)].filter(value => value >= 100000);
}`;
  code = code.slice(0, mentionStart) + newMentioned + code.slice(mentionEnd);
  console.log('19. Replaced salesMentionedPriceCents with generic parser');
}

// Clean up remaining occurrences:
code = code.replace("|| (tenantSlug==='wesley_automoveis' && salesGenesisExplicitCatalogBuy(currentText))", "");
code = code.replace("let catalogChoice=ownVehicleOffer && !salesGenesisExplicitCatalogBuy(currentTurnText)", "let catalogChoice=ownVehicleOffer");
code = code.replace("&& !(tenantSlug==='wesley_automoveis'&&salesGenesisFinancingQuestion(currentTurnText,salesLastPendingRequirement(history)))", "");
code = code.replace("const repeatsDeferredSale=salesGenesisRepeatedDeferredSale(turnText,mode,lead?.state||{});", "const repeatsDeferredSale=(lead?.state?.follow_up_disposition==='deferred_by_customer' && ['sell','buy_and_sell'].includes(mode) && /^(?:vender|quero\\s+vender|continuar\\s+(?:a\\s+)?venda)$/.test(normalizeText(turnText).trim()));");
code = code.replace("?salesGenesisExplicitListingRequested(turnText):salesCatalogRequested(turnText);", "?salesCatalogRequested(turnText):salesCatalogRequested(turnText);");
code = code.replace("reply=tenantSlug==='wesley_automoveis'&&salesGenesisSheetPriceAuthorized(context)", "reply=salesPriceAuthorized(context, generated.product)");
code = code.replace(":(tenantSlug==='wesley_automoveis'?salesGenesisCatalogFilter(inventory,turnText):inventory)", ":(executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText })?.data?.items || inventory)");

// Check remaining salesGenesis
const remaining = code.match(/salesGenesis\w+/g) || [];
console.log('Remaining salesGenesis count:', remaining.length, [...new Set(remaining)]);

// Check syntax
new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', code);
console.log('COMPLETE SYNTAX CHECK PASSED!');
