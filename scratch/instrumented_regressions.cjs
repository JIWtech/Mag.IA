function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label} insertion point`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label} insertion point`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function applyCommercialRegressions(source, ts) {
  let code = source;
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 9: let code = source;'); process.exit(1); }

  // 1. Generic media shapes and neutral media starts
  if (!code.includes('// historical-commercial-regressions-v2')) {
    const mediaShapeStart = code.indexOf('function salesInboundMediaShape(messages = []) {');
    const mediaShapeEnd = code.indexOf('\nfunction salesMergeState(', mediaShapeStart);
    if (mediaShapeStart < 0 || mediaShapeEnd < 0) throw new Error('Commercial media shape block missing');
    const historicalMarkerStart = code.lastIndexOf('// historical-commercial-regressions-v1', mediaShapeStart);
    const replaceMediaFrom = historicalMarkerStart >= 0 ? historicalMarkerStart : mediaShapeStart;
    const mediaShapeReplacement = `// historical-commercial-regressions-v2
function salesInboundMediaShape(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  const kindFor = row => {
    const marker=String(row?.text||'').trim().match(/^\\[([a-z_]+)\\](?:\\n|$)/i)?.[1]?.toLowerCase()||'';
    const raw=row?.raw&&typeof row.raw==='object'?row.raw:{};
    const rawKind=String(raw.content_type||raw.sales_media_type||raw.source_media?.kind||'').toLowerCase();
    if (rawKind==='audio'||raw.audio_metadata||raw.audio_processing) return 'audio';
    if (rawKind==='image'||rawKind==='video'||rawKind==='document') return rawKind;
    return marker;
  };
  const kinds=rows.map(kindFor);
  const imageCaptions = rows.map(row => String(row?.text || '').match(/^\\[image\\]\\s*([\\s\\S]*)$/i)?.[1] ?? null);
  const normalizedTexts=rows.map(row=>normalizeText(row?.text||''));
  return {
    imageOnly: rows.length > 0 && kinds.every(kind => kind === 'image'),
    audioOnly: rows.length > 0 && kinds.every(kind => kind === 'audio'),
    videoOnly: rows.length > 0 && kinds.every(kind => kind === 'video'),
    neutralAudio: rows.length > 0 && kinds.every(kind => kind === 'audio')
      && normalizedTexts.every(text=>/^(?:teste|testando|oi|ola|alo|som|audio)?[.!?\\s]*$/.test(text)),
    greets: imageCaptions.some(caption => /^(?:oi|ola|ol\\u00e1)\\b/i.test(String(caption || '').trim())),
  };
}

function salesNeutralMediaStartReply(previous = {}, evidence = {}, shape = {}) {
  if (salesModeFor(previous) !== 'unknown') return '';
  if (shape.neutralAudio) return 'Recebi seu \\u00e1udio. Como posso ajudar?';
  if (evidence.mode !== 'unknown') return '';
  if (shape.imageOnly) return shape.greets ? 'Ol\\u00e1! Recebi a foto. Como posso ajudar voc\\u00ea?' : 'Recebi a foto. Como posso ajudar voc\\u00ea?';
  if (shape.videoOnly) return 'Recebi o v\\u00eddeo. Como posso ajudar voc\\u00ea?';
  return '';
}
`;
    code = code.slice(0, replaceMediaFrom) + mediaShapeReplacement + code.slice(mediaShapeEnd);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 51: code = code.slice(0, replaceMediaFrom) + mediaShap'); process.exit(1); }

    const unresolvedReferralStart = code.indexOf("  if (referral.source==='external_ad_reply' && !match.product && !match.candidates.length) return ");
    const unresolvedReferralEnd = code.indexOf('\n', unresolvedReferralStart);
    if (unresolvedReferralStart < 0 || unresolvedReferralEnd < 0) throw new Error('Unresolved external referral reply missing');
    code = code.slice(0, unresolvedReferralStart)
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 56: code = code.slice(0, unresolvedReferralStart)'); process.exit(1); }
      + "  if (referral.source==='external_ad_reply' && !match.product && !match.candidates.length) return 'N\\u00e3o encontrei esse ve\\u00edculo no estoque oficial atual. Posso te mostrar outras op\\u00e7\\u00f5es dispon\\u00edveis?';"
      + code.slice(unresolvedReferralEnd);

    const reorientationStart = code.indexOf('function salesPendingRequirementReorientation(requirement = \'\') {');
    const reorientationEnd = code.indexOf('\nfunction salesContextualPhotoReply(', reorientationStart);
    if (reorientationStart < 0 || reorientationEnd < 0) throw new Error('Pending requirement reorientation block missing');
    const reorientationReplacement = `function salesPendingRequirementReorientation(requirement = '') {
  const replies={
    sell_model:'Se quiser continuar a avalia\\u00e7\\u00e3o, me diga o modelo do ve\\u00edculo. Se precisar de outra coisa, pode me falar.',
    buy_model:'Se quiser continuar a compra, me diga qual modelo est\\u00e1 procurando. Se precisar de outra coisa, pode me falar.',
    buy_and_sell_models:'Para continuar, me diga qual ve\\u00edculo quer vender e qual est\\u00e1 procurando. Se preferir tratar de outra coisa, pode me falar.',
    vehicle_photo:'Pode mandar uma foto do ve\\u00edculo quando estiver com ele.',
    vehicle_description:'Se quiser continuar a avalia\\u00e7\\u00e3o, me conte como est\\u00e1 a manuten\\u00e7\\u00e3o do seu carro e se h\\u00e1 alguma avaria.',
    deposit:'Quanto voc\\u00ea pretende dar de entrada?',
    documents:'Ficou alguma d\\u00favida sobre o documento que pedi?',
    customer_name:'Como voc\\u00ea se chama?'
  };
  return replies[requirement]||'';
}
`;
    code = code.slice(0, reorientationStart) + reorientationReplacement + code.slice(reorientationEnd);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 77: code = code.slice(0, reorientationStart) + reorien'); process.exit(1); }

    const antiLoopStart = code.indexOf('  const isFrustrated =');
    const antiLoopEnd = code.indexOf('\n\n  // The semantic plan', antiLoopStart);
    if (antiLoopStart < 0 || antiLoopEnd < 0) throw new Error('Historical anti-loop decision block missing');
    const newAntiLoop = `  const isFrustrated = turn.messages.some(m => salesFrustrationDetected(m.text));
  const requirementAttempts = pendingRequirement ? salesPendingRequirementAttempts(history, pendingRequirement) : 0;
  const previousRequirement = salesLastPendingRequirement(history);
  const currentRequirementProgress=mediaProgress&&['vehicle_description','vehicle_photo','documents'].includes(pendingRequirement);
  const antiLoopContextChanged=!!tradeInInquiry||!!tradeInOffer||!!customerDisposition||!!financingQuestion||!!continuation
    ||!!selectedProductQuestion||appraisalWalkInActive||currentIntentAmbiguity||vehicleYearClarification||contextualCatalogQuestion
    ||catalogChoice.ambiguous||salesCurrentTurnCorrectionOrQuestion(turnText)||currentRequirementProgress;
  if (!antiLoopContextChanged && !intentDecision.evidence?.correction && !isFrustrated && !isLocationRequest && !acceptedHumanOffer
      && previousRequirement === pendingRequirement && requirementAttempts === 1) {
    const reorientation = salesPendingRequirementReorientation(pendingRequirement);
    if (reorientation) reply = reorientation;
  }
  if (!antiLoopContextChanged && !intentDecision.evidence?.correction && !isFrustrated && !isLocationRequest && !acceptedHumanOffer
      && (duplicateDecision.offerHuman || (pendingRequirement && requirementAttempts >= 2))) {
    optionalHumanOffer={reason:'anti_loop_assist'};
    const reorientation=salesPendingRequirementReorientation(pendingRequirement);
    reply=reorientation||reply||'Posso continuar por aqui.';
    if (!/Wesley|atendente|equipe/i.test(reply)) reply+=' Se preferir, posso chamar o Wesley para continuar.';
  }`;
    code = code.slice(0, antiLoopStart) + newAntiLoop + code.slice(antiLoopEnd);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 101: code = code.slice(0, antiLoopStart) + newAntiLoop '); process.exit(1); }

    const genesisEscalationOld = "    ?(naturalPlan?.human_requested===true || acceptedHumanOffer || explicitCurrentHumanRequest)";
    if (code.includes(genesisEscalationOld)) {
      code = replaceOnce(code, genesisEscalationOld,
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 105: code = replaceOnce(code, genesisEscalationOld,'); process.exit(1); }
        "    ?(naturalPlan?.human_requested===true || acceptedHumanOffer || explicitCurrentHumanRequest || isFrustrated)",
        'Genesis frustration escalation');
    }
  }

  if (!code.includes('// audio-origin-preserved-after-transcription-v1')) {
    const audioRawNeedle = `    const rawPayload = row.raw_payload || {};
    const cached = rawPayload.audio_transcriptions?.[item.event_id] || rawPayload.audio_processing;`;
    const audioRawReplacement = `    const rawPayload = row.raw_payload || {};
    // audio-origin-preserved-after-transcription-v1
    item.raw={...(item.raw&&typeof item.raw==='object'?item.raw:{}),...rawPayload};
    const cached = rawPayload.audio_transcriptions?.[item.event_id] || rawPayload.audio_processing;`;
    code = replaceOnce(code, audioRawNeedle, audioRawReplacement, 'audio origin preservation');
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 118: code = replaceOnce(code, audioRawNeedle, audioRawR'); process.exit(1); }
  }

  if (!code.includes('// neutral-media-state-v1')) {
    const neutralMediaNeedle = `  if (neutralMediaReply) generated={...generated,action:'reply',reason:'none',reply:neutralMediaReply,state:intentDecision.state};`;
    const neutralMediaReplacement = `  // neutral-media-state-v1
  if (neutralMediaReply) generated={...generated,action:'reply',reason:'none',reply:neutralMediaReply,
    state:salesMergeState(lead?.state||{},{}),product:lead?.product||null};`;
    code = replaceOnce(code, neutralMediaNeedle, neutralMediaReplacement, 'neutral media state preservation');
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 126: code = replaceOnce(code, neutralMediaNeedle, neutr'); process.exit(1); }
  }

  if (!code.includes('// neutral-audio-lexicon-v2')) {
    const lexiconStart = code.indexOf('      && normalizedTexts.every(text=>/^(?:teste|testando|oi|ola|');
    const lexiconEnd = code.indexOf('\n', lexiconStart);
    if (lexiconStart < 0 || lexiconEnd < 0) throw new Error('Neutral audio lexicon missing');
    code = code.slice(0, lexiconStart)
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 133: code = code.slice(0, lexiconStart)'); process.exit(1); }
      + "      && normalizedTexts.every(text=>/^(?:teste|testando|oi|ola|alo|som|audio)?[.!?\\s]*$/.test(text)), // neutral-audio-lexicon-v2"
      + code.slice(lexiconEnd);
  }

  if (!code.includes('// catalog-choice-survives-trade-in-v1')) {
    const tradeInStart = code.indexOf('  if(tradeInOffer){');
    const tradeInEnd = code.indexOf('\n  if(naturalPlan){', tradeInStart);
    if (tradeInStart < 0 || tradeInEnd < 0) throw new Error('Trade-in product preservation block missing');
    const tradeInReplacement = `  // catalog-choice-survives-trade-in-v1
  if(tradeInOffer){
    generated.state.transaction_mode='buy_and_sell';generated.state.intent='buy';
    generated.state.trade_in={...tradeInOffer,kind:'vehicle',status:'needs_human_appraisal'};
    generated.state.sell_vehicle={...generated.state.sell_vehicle,eligibility:'unknown',rejection_reason:'',rejection_evidence_ids:[],rejected_at:''};
    const catalogProduct=catalogChoice?.product||null;
    const priorProduct=inventory.find(p=>p.id===lead?.state?.product_id)||null;
    const purchase=catalogProduct||priorProduct;
    generated.product=purchase;
    if(catalogProduct){
      const choiceEvidence=turn.messages.at(-1)?.event_id||'';
      generated.state.product_id=catalogProduct.id;
      generated.state.product_evidence=choiceEvidence;
      generated.state.product_variant_evidence=choiceEvidence;
      generated.state.buy_interest={...(generated.state.buy_interest||{}),brand:catalogProduct.brand||'',model:catalogProduct.model||'',
        year:catalogProduct.year||null,raw_mention:catalogProduct.name||catalogProduct.model||'',product_id:catalogProduct.id,
        evidence_ids:[...new Set([...(generated.state.buy_interest?.evidence_ids||[]),choiceEvidence].filter(Boolean))].slice(-30)};
    }else{
      generated.state.product_id=priorProduct?.id||'';
      generated.state.product_evidence=priorProduct?lead.state.product_evidence:'';
      generated.state.product_variant_evidence=priorProduct?lead.state.product_variant_evidence:'';
      generated.state.buy_interest=lead?.state?.buy_interest?{...lead.state.buy_interest}:salesEmptyState().buy_interest;
    }
    generated.action='reply';generated.reason='none';
    directCatalogAnswer=null;
  }
`;
    code = code.slice(0, tradeInStart) + tradeInReplacement + code.slice(tradeInEnd);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 169: code = code.slice(0, tradeInStart) + tradeInReplac'); process.exit(1); }
  }

  if (!code.includes('// commercial-money-context-v2')) {
    const start = code.indexOf('function salesRecentCustomerPriceClaims(history = [], messages = []) {');
    const end = code.indexOf('\nfunction salesCatalogRequested(text)', start);
    if (start < 0 || end < 0) throw new Error('Commercial price classification block missing');
    const replacement = `// commercial-money-context-v2
function salesVehiclePriceClaimCents(text = '', allowBareAmount = false) {
  const raw=String(text||'');
  const matches=[];
  for (const pattern of [/R\\$\\s*\\d+(?:\\.\\d{3})*(?:,\\d{1,2})?/gi,/\\b\\d+(?:[.,]\\d+)?\\s*(?:mil|k)\\b/gi]) {
    for (const match of raw.matchAll(pattern)) matches.push({text:match[0],index:match.index||0});
  }
  const claims=[];
  for (const match of matches.sort((a,b)=>a.index-b.index)) {
    const amount=salesMentionedPriceCents(match.text)[0];
    if (!Number.isSafeInteger(amount)) continue;
    const before=normalizeText(raw.slice(Math.max(0,match.index-72),match.index));
    const after=normalizeText(raw.slice(match.index+match.text.length,match.index+match.text.length+40));
    const depositContext=/(?:entrada|sinal)(?:\\s+(?:de|no|na|pretendid[ao]|seria|vai|vou|dar|tenho|consigo|ate|aproximadamente|uns?|uma|o|a|r\\$|\\d+)){0,7}\\s*$/.test(before)
      || /^\\s*(?:de\\s+)?entrada\\b/.test(after);
    if (depositContext) continue;
    const priceContext=/\\b(?:preco|valor\\s+(?:do|desse|deste)\\s+(?:carro|veiculo|modelo)|custa|custando|anuncio|anunciado|catalogo|promocao|promo|oferta|vi\\s+por|estava\\s+(?:por|a)|nao\\s+e|era|deveria\\s+ser)\\b/.test(before.slice(-64));
    if (allowBareAmount||priceContext) claims.push(amount);
  }
  return [...new Set(claims)];
}

function salesRecentCustomerPriceClaims(history = [], messages = []) {
  const rows=[
    ...(history||[]).filter(row=>row?.direction==='inbound').slice(-8).map(row=>row.message_text||''),
    ...(messages||[]).map(row=>row?.text||'')
  ];
  const values=[];
  for (const text of rows) values.push(...salesVehiclePriceClaimCents(text));
  return [...new Set(values)].slice(-4);
}

function salesCurrentDepositOffer(messages = [], history = []) {
  const pending=salesLastPendingRequirement(history)==='deposit';
  for (const message of [...(messages||[])].reverse()) {
    const text=String(message?.text||'');
    if (!pending&&!/\\b(?:entrada|sinal)\\b/.test(normalizeText(text))) continue;
    const amount=salesAmount(text);
    if (Number.isSafeInteger(amount)&&amount>=0) return {amount_cents:amount,evidence_id:String(message?.event_id||message?.id||'')};
  }
  return null;
}

function salesPriceDiscrepancy(text = '', product = null, fallbackAmounts = [], allowBareAmount = false) {
  if (!product?.price_cents) return null;
  const value=normalizeText(text);
  const adContext=/\\b(?:anuncio|anunciado|catalogo|promocao|promo|oferta|vi\\s+(?:por|a)|estava\\s+(?:por|a))\\b/.test(value);
  const current=salesVehiclePriceClaimCents(text,allowBareAmount);
  const amounts=current.length?current:(adContext?(fallbackAmounts||[]):[]);
  if (!amounts.length) return null;
  const different=amounts.find(amount=>Math.abs(amount-Number(product.price_cents))>=100);
  return different?{
    customer_amount_cents:different,
    current_price_cents:Number(product.price_cents),
    inventory_price_cents:Number(product.canonical_price_cents||product.price_cents),
    price_source:String(product.price_source||'canonical_inventory'),
    whatsapp_regular_price_cents:product.whatsapp_regular_price_cents||null,
    whatsapp_sale_price_cents:product.whatsapp_sale_price_cents||null
  }:null;
}
`;
    code = code.slice(0, start) + replacement + code.slice(end);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 237: code = code.slice(0, start) + replacement + code.s'); process.exit(1); }
  }

  if (!code.includes('// commercial-deposit-validation-v2')) {
    const needle = `  const recentPriceClaims=salesRecentCustomerPriceClaims(history,turn.messages);
  const currentPriceDiscrepancy=salesPriceDiscrepancy(turnText,generated.product,recentPriceClaims);
  const referralPriceDiscrepancy=activeReferral&&referralProduct
    ? salesPriceDiscrepancy([activeReferral.title,activeReferral.body].filter(Boolean).join(' '),referralProduct,[]) : null;`;
    const replacement = `  const recentPriceClaims=salesRecentCustomerPriceClaims(history,turn.messages);
  const currentPriceDiscrepancy=['buy','buy_and_sell'].includes(mode)
    ?salesPriceDiscrepancy(turnText,generated.product,recentPriceClaims):null;
  const referralPriceDiscrepancy=activeReferral&&referralProduct
    ? salesPriceDiscrepancy([activeReferral.title,activeReferral.body].filter(Boolean).join(' '),referralProduct,[],true) : null;
  // commercial-deposit-validation-v2
  const currentDepositOffer=salesCurrentDepositOffer(turn.messages,history);
  const depositValidation=currentDepositOffer&&salesDepositExceedsKnownPrice(currentDepositOffer.amount_cents,generated.product)
    ?{reason:'exceeds_vehicle_price',deposit_cents:currentDepositOffer.amount_cents,
      price_cents:Number(generated.product.price_cents),evidence_id:currentDepositOffer.evidence_id}:null;`;
    code = replaceOnce(code, needle, replacement, 'commercial deposit validation');
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 255: code = replaceOnce(code, needle, replacement, 'com'); process.exit(1); }
  }

  if (!code.includes('// commercial-deposit-validation-branch-v2')) {
    const needle = `  else if (priceDiscrepancy) {`;
    const replacement = `  // commercial-deposit-validation-branch-v2
  else if (depositValidation) {
    stage=cfg.stage_keys.qualifying;
    register=false;
    reply='A entrada informada de '+salesMoney(depositValidation.deposit_cents)+' é maior que o preço do veículo, de '
      +salesMoney(depositValidation.price_cents)+'. Pode confirmar qual valor pretende dar de entrada?';
    pendingRequirement='deposit';
    followUpDisposition='awaiting_customer';
    optionalHumanOffer=null;
    handoffReason='';
    event.raw_payload={...(event.raw_payload||{}),deposit_validation:depositValidation};
  }
  else if (priceDiscrepancy) {`;
    code = replaceOnce(code, needle, replacement, 'commercial deposit validation branch');
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 273: code = replaceOnce(code, needle, replacement, 'com'); process.exit(1); }
  }

  // 2. CORE & EXT Gênesis Decoupling
  if (!code.includes('// core-genesis-decoupling-v2')) {
    const dispatcher = `// core-genesis-decoupling-v2
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

    // A. Replace parser block with dispatcher
    const parserStart = (()=>{
      const p1 = code.indexOf('function salesGenesisSheetPrice(value) {');
      if (p1 >= 0) return p1;
      return code.indexOf('function salesParseGenesisInventory(data, columns) {');
    })();
    const parserEnd = code.indexOf('\nfunction salesParseInventory(text) {', parserStart);
    if (parserStart >= 0 && parserEnd >= 0) {
      code = code.slice(0, parserStart) + dispatcher + code.slice(parserEnd);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 418: code = code.slice(0, parserStart) + dispatcher + c'); process.exit(1); }
    }

    // B. Replace salesInventory
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
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 468: code = code.slice(0, invStart) + newInventory + co'); process.exit(1); }
    }

    // C. Remove salesGenesisFinancingQuestion block
    const finStart = code.indexOf("function salesGenesisFinancingQuestion(text = '', priorPending = '') {");
    const finEnd = code.indexOf('\nfunction salesDemonstrativeVehicleReference(value = \'\') {', finStart);
    if (finStart >= 0 && finEnd >= 0) {
      code = code.slice(0, finStart) + code.slice(finEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 475: code = code.slice(0, finStart) + code.slice(finEnd'); process.exit(1); }
    }

    // D. Remove salesGenesisSheetPriceAuthorized block
    const authStart = code.indexOf('function salesGenesisSheetPriceAuthorized(context = {}) {');
    const authEnd = code.indexOf('\nfunction salesPriceKnown(row = {}) {', authStart);
    if (authStart >= 0 && authEnd >= 0) {
      code = code.slice(0, authStart) + code.slice(authEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 482: code = code.slice(0, authStart) + code.slice(authE'); process.exit(1); }
    }

    // E. Remove salesGenesisTradeInOffer definition
    const tradeStart = code.indexOf('function salesGenesisTradeInOffer(history = [], messages = [], previous = {}) {');
    const tradeEnd = code.indexOf('\nfunction salesOwnVehicleOfferEvidence(', tradeStart);
    if (tradeStart >= 0 && tradeEnd >= 0) {
      code = code.slice(0, tradeStart) + code.slice(tradeEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 489: code = code.slice(0, tradeStart) + code.slice(trad'); process.exit(1); }
    }

    // F. Remove salesGenesisCatalogAudience / Filter definitions
    const audStart = code.indexOf('function salesGenesisCatalogAudience(text = \'\') {');
    const audEnd = code.indexOf('\nfunction salesRecentCatalogContext(', audStart);
    if (audStart >= 0 && audEnd >= 0) {
      code = code.slice(0, audStart) + code.slice(audEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 496: code = code.slice(0, audStart) + code.slice(audEnd'); process.exit(1); }
    }

    // G. Remove salesGenesisCatalogOrdinal definitions
    const ordStart = code.indexOf('function salesGenesisCatalogOrdinal(text = \'\') {');
    const ordEnd = code.indexOf('\nfunction salesCatalogChoice(', ordStart);
    if (ordStart >= 0 && ordEnd >= 0) {
      code = code.slice(0, ordStart) + code.slice(ordEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 503: code = code.slice(0, ordStart) + code.slice(ordEnd'); process.exit(1); }
    }

    // H. Remove salesGenesisNameProgressReply definition
    const nameStart = code.indexOf("function salesGenesisNameProgressReply(text = '', state = {}, product = null, history = []) {");
    const nameEnd = code.indexOf('\nfunction salesLastPendingRequirement(history = []) {', nameStart);
    if (nameStart >= 0 && nameEnd >= 0) {
      code = code.slice(0, nameStart) + code.slice(nameEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 510: code = code.slice(0, nameStart) + code.slice(nameE'); process.exit(1); }
    }

    // I. Remove salesGenesisRepeatedDeferredSale definition
    const repStart = code.indexOf("function salesGenesisRepeatedDeferredSale(text = '', mode = '', previousState = {}) {");
    const repEnd = code.indexOf('\nfunction salesMentionedPriceCents(', repStart);
    if (repStart >= 0 && repEnd >= 0) {
      code = code.slice(0, repStart) + code.slice(repEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 517: code = code.slice(0, repStart) + code.slice(repEnd'); process.exit(1); }
    }

    // J. Remove salesGenesisExplicitListingRequested definition
    const listStart = code.indexOf("function salesGenesisExplicitListingRequested(text = '') {");
    const listEnd = code.indexOf('\nfunction salesVehiclePhotoRequested(text = \'\') {', listStart);
    if (listStart >= 0 && listEnd >= 0) {
      code = code.slice(0, listStart) + code.slice(listEnd + 1);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 524: code = code.slice(0, listStart) + code.slice(listE'); process.exit(1); }
    }

    // K. Replace auction classifier block
    const aucStart = (()=>{
      const a1 = code.indexOf('  // genesis-sheet-price-and-auction-v6');
      if (a1 >= 0) return a1;
      return code.indexOf('  const auctionTopic=');
    })();
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
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 552: code = code.slice(0, aucStart) + newAuctionClassif'); process.exit(1); }
    }

    // L. Replace auction branch
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
      code = code.slice(0, aucBranchStart) + newAuctionBranch + code.slice(aucBranchEnd + 4);
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 569: code = code.slice(0, aucBranchStart) + newAuctionB'); process.exit(1); }
    }

    // M. Replace tradeIn in turn
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 573: code = code.replace('); process.exit(1); }
      "const tradeInContext=salesGenesisTradeInOffer(history,turn.messages,lead?.state||{});",
      "const tradeInResult=executeCommercialOperationSync(context, 'vehicle.trade_in', { history, messages: turn.messages, previous: lead?.state||{}, prior_pending: salesLastPendingRequirement(history) });\n  const tradeInContext=tradeInResult.data;"
    );

    // N. Replace catalog ordinal choice in salesCatalogChoice (SYNC!)
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 579: code = code.replace('); process.exit(1); }
      "  if (index===null) index=salesGenesisCatalogOrdinal(text); // commercial-catalog-continuity-v1",
      "  const selectionOp=executeCommercialOperationSync(context, 'inventory.resolve_selection', { text, inventory, catalog_context: recent });\n  if (selectionOp.status==='ok' && selectionOp.data?.product) return { product: selectionOp.data.product, invalid: false, ambiguous: false, candidates: [], contextual: true };"
    );

    // O. Replace financingQuestion in turn
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 585: code = code.replace('); process.exit(1); }
      "const financingQuestion=tenantSlug==='wesley_automoveis' && ['buy','buy_and_sell'].includes(mode)\n    && salesGenesisFinancingQuestion(turnText,salesLastPendingRequirement(history));",
      "const financingOp=executeCommercialOperationSync(context, 'financing.evaluate', { text: turnText, product: generated.product, prior_pending: salesLastPendingRequirement(history) });\n  const financingQuestion=financingOp.status==='ok' && financingOp.data?.is_financing_question;"
    );
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 589: code = code.replace('); process.exit(1); }
      "reply=salesGenesisFinancingQuestionReply(turnText,generated.product);",
      "reply=financingOp.data?.reply || reply;"
    );
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 593: code = code.replace('); process.exit(1); }
      "pendingRequirement=salesGenesisGeneralFinancingQuestion(turnText)?'deposit':'';register=false;",
      "pendingRequirement=financingOp.data?.pending_requirement || '';register=false;"
    );

    // P. Replace catalog filter calls
    const catFilterCall = "if(naturalPlan&&catalogRequested)catalogItems=salesCatalogItems(salesGenesisCatalogFilter(inventory,({cars:'carros',motorcycles:'motos',all:''})[naturalPlan.memory.catalog_audience||'all']));";
    if (code.includes(catFilterCall)) {
      code = replaceOnce(code, catFilterCall,
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 601: code = replaceOnce(code, catFilterCall,'); process.exit(1); }
        "if(naturalPlan&&catalogRequested){\n    const filterOp=executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText, audience: naturalPlan.memory.catalog_audience });\n    catalogItems=salesCatalogItems(filterOp.status==='ok' && Array.isArray(filterOp.data?.items) ? filterOp.data.items : inventory);\n  }",
        'catalog filter call');
    }

    // Q. Replace name progress reply
    code = code.replace(
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 607: code = code.replace('); process.exit(1); }
      "const nameProgressReply=salesGenesisNameProgressReply(turnText,s,generated.product,history);",
      "const nameProgressOp=executeCommercialOperationSync(context, 'customer.name_progress', { text: turnText, state: s, product: generated.product, history });\n    const nameProgressReply=nameProgressOp.data?.reply || '';"
    );

    // R. Fix Caso Jeferson and bare selection price presentation
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
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 674: code = replaceOnce(code, bareSelNeedle, bareSelRep'); process.exit(1); }

    // S. Replace salesMentionedPriceCents
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
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 693: code = code.slice(0, mentionStart) + newMentioned '); process.exit(1); }
    }

    // T. Clean up remaining occurrences
    code = code.replace("const parsed=salesGenesisSheetPrice(number+(match[2]||''));", "const parsed=salesAmountPriceParser(number+(match[2]||''));");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 697: code = code.replace("const parsed=salesGenesisShee'); process.exit(1); }
    code = code.replace("|| (tenantSlug==='wesley_automoveis' && salesGenesisExplicitCatalogBuy(currentText))", "");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 698: code = code.replace("|| (tenantSlug==='wesley_auto'); process.exit(1); }
    code = code.replace("let catalogChoice=ownVehicleOffer && !salesGenesisExplicitCatalogBuy(currentTurnText)", "let catalogChoice=ownVehicleOffer");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 699: code = code.replace("let catalogChoice=ownVehicleO'); process.exit(1); }
    code = code.replace("&& !(tenantSlug==='wesley_automoveis'&&salesGenesisFinancingQuestion(currentTurnText,salesLastPendingRequirement(history)))", "");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 700: code = code.replace("&& !(tenantSlug==='wesley_aut'); process.exit(1); }
    code = code.replace("const repeatsDeferredSale=salesGenesisRepeatedDeferredSale(turnText,mode,lead?.state||{});", "const repeatsDeferredSale=(lead?.state?.follow_up_disposition==='deferred_by_customer' && ['sell','buy_and_sell'].includes(mode) && /^(?:vender|quero\\s+vender|continuar\\s+(?:a\\s+)?venda)$/.test(normalizeText(turnText).trim()));");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 701: code = code.replace("const repeatsDeferredSale=sal'); process.exit(1); }
    code = code.replace("?salesGenesisExplicitListingRequested(turnText):salesCatalogRequested(turnText);", "?salesCatalogRequested(turnText):salesCatalogRequested(turnText);");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 702: code = code.replace("?salesGenesisExplicitListingR'); process.exit(1); }
    code = code.replace("reply=tenantSlug==='wesley_automoveis'&&salesGenesisSheetPriceAuthorized(context)", "reply=salesPriceAuthorized(context, generated.product)");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 703: code = code.replace("reply=tenantSlug==='wesley_au'); process.exit(1); }
    code = code.replace(":(tenantSlug==='wesley_automoveis'?salesGenesisCatalogFilter(inventory,turnText):inventory)", ":(executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText })?.data?.items || inventory)");
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 704: code = code.replace(":(tenantSlug==='wesley_automo'); process.exit(1); }
  }

  const pendingNeedle = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion) {`;
  const pendingReplacement = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion
      && !depositValidation) {`;
  if (!code.includes('&& !depositValidation) {')) {
    code = replaceOnce(code, pendingNeedle, pendingReplacement, 'deposit-specific pending reply');
if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line 711: code = replaceOnce(code, pendingNeedle, pendingRep'); process.exit(1); }
  }

  new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', code);
  if (ts) {
    const sourceFile = ts.createSourceFile('whatsapp_commercial_regressions.generated.ts', code, ts.ScriptTarget.ES2022, true);
    if (!sourceFile) throw new Error('TypeScript AST validation failed for commercial regressions');
  }

  return code;
}

module.exports = {
  applyCommercialRegressions,
};

