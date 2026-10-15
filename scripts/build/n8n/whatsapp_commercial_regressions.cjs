
function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label} insertion point`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label} insertion point`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function applyCommercialRegressions(source, ts) {
  let code = source;

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

    const unresolvedReferralStart = code.indexOf("  if (referral.source==='external_ad_reply' && !match.product && !match.candidates.length) return ");
    const unresolvedReferralEnd = code.indexOf('\n', unresolvedReferralStart);
    if (unresolvedReferralStart < 0 || unresolvedReferralEnd < 0) throw new Error('Unresolved external referral reply missing');
    code = code.slice(0, unresolvedReferralStart)
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

    const genesisEscalationOld = "    ?(naturalPlan?.human_requested===true || acceptedHumanOffer || explicitCurrentHumanRequest)";
    if (code.includes(genesisEscalationOld)) {
      code = replaceOnce(code, genesisEscalationOld,
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
  }

  if (!code.includes('// neutral-media-state-v1')) {
    const neutralMediaNeedle = `  if (neutralMediaReply) generated={...generated,action:'reply',reason:'none',reply:neutralMediaReply,state:intentDecision.state};`;
    const neutralMediaReplacement = `  // neutral-media-state-v1
  if (neutralMediaReply) generated={...generated,action:'reply',reason:'none',reply:neutralMediaReply,
    state:salesMergeState(lead?.state||{},{}),product:lead?.product||null};`;
    code = replaceOnce(code, neutralMediaNeedle, neutralMediaReplacement, 'neutral media state preservation');
  }

  if (!code.includes('// neutral-audio-lexicon-v2')) {
    const lexiconStart = code.indexOf('      && normalizedTexts.every(text=>/^(?:teste|testando|oi|ola|');
    const lexiconEnd = code.indexOf('\n', lexiconStart);
    if (lexiconStart < 0 || lexiconEnd < 0) throw new Error('Neutral audio lexicon missing');
    code = code.slice(0, lexiconStart)
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
  }

  // 2. CORE & EXT Gênesis Decoupling
  // v3 removes the repository-local require path.  The CORE consumes only
  // structured EXT evidence (or its already embedded generic continuity
  // helpers); it never attempts to load a tenant file at n8n runtime.
  if (!code.includes('// core-genesis-decoupling-v3')) {
    const dispatcherStart = code.indexOf('// core-genesis-decoupling-v2');
    const dispatcherEnd = code.indexOf('\nfunction salesPriceAuthorized', dispatcherStart);
    if (dispatcherStart < 0 || dispatcherEnd < 0) throw new Error('Commercial dispatcher v2 missing');
    const dispatcher = `// core-genesis-decoupling-v3
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

function commercialResult(operation, status, data = null, handoff = {}) {
  return { contract:'noria_business_result_v1', operation, status, data,
    handoff:{required:handoff.required===true,reason:handoff.reason||null,message:handoff.message||null} };
}

function salesApplySemanticCatalogConstraints(items=[],semantic={}){
  let filtered=Array.isArray(items)?items.filter(Boolean):[];
  const applied=[],unsupported=[];
  if(Number.isSafeInteger(semantic.price_min_cents)&&semantic.price_min_cents>=0){
    filtered=filtered.filter(item=>Number.isSafeInteger(item.price_cents)&&item.price_cents>=semantic.price_min_cents);
    applied.push({field:'price_min_cents',value:semantic.price_min_cents});
  }
  if(Number.isSafeInteger(semantic.price_max_cents)&&semantic.price_max_cents>=0){
    filtered=filtered.filter(item=>Number.isSafeInteger(item.price_cents)&&item.price_cents<=semantic.price_max_cents);
    applied.push({field:'price_max_cents',value:semantic.price_max_cents});
  }
  const match=(item,field,raw)=>{
    const value=normalizeText(raw).trim();
    if(!value)return false;
    if(field==='year_min')return Number.isInteger(Number(raw))&&Number(item.year)>=Number(raw);
    if(field==='year_max')return Number.isInteger(Number(raw))&&Number(item.year)<=Number(raw);
    if(field==='product_id')return String(item.id||'')===String(raw).trim();
    if(!['brand','model','color','fuel'].includes(field))return null;
    return normalizeText(item[field]||'')===value;
  };
  const apply=(values,exclude)=>{for(const raw of Array.isArray(values)?values:[]){
    const parsed=String(raw||'').match(/^([a-z_]+)=(.+)$/i);
    if(!parsed){unsupported.push(String(raw));continue;}
    const field=normalizeText(parsed[1]),value=parsed[2].trim();
    if(match({},field,value)===null){unsupported.push(String(raw));continue;}
    filtered=filtered.filter(item=>exclude?!match(item,field,value):match(item,field,value));
    applied.push({field,value,mode:exclude?'exclude':'include'});
  }};
  apply(semantic.preferences,false);apply(semantic.exclusions,true);
  return {items:filtered,count:filtered.length,applied,unsupported,requires_clarification:unsupported.length>0};
}

function executeCommercialOperationSync(context, operation, payload = {}) {
  const bCtx = context?.noria_business_context || context?.business_context || {};
  if (bCtx.error) return commercialResult(operation, 'unavailable', null, {});
  const precomputed = bCtx.operations?.[operation];
  if (precomputed && precomputed.contract === 'noria_business_result_v1' && precomputed.operation === operation) return precomputed;
  if (operation === 'inventory.filter_catalog' && bCtx.catalog_filters) {
    const audience = ['cars','motorcycles'].includes(payload.audience) ? payload.audience : 'all';
    const items = bCtx.catalog_filters[audience] || bCtx.catalog_filters.all;
    if (Array.isArray(items)) return commercialResult(operation, 'ok', payload.semantic_catalog
      ?salesApplySemanticCatalogConstraints(items,payload.semantic_catalog):{items,count:items.length,applied:[],unsupported:[],requires_clarification:false});
  }
  if (operation === 'inventory.resolve_selection' && bCtx.resolved_selection) return commercialResult(operation, bCtx.resolved_selection.product?'ok':'not_found', bCtx.resolved_selection);
  if (operation === 'auction.evaluate_handoff' && bCtx.auction) return commercialResult(operation, 'ok', bCtx.auction.classification || bCtx.auction, bCtx.auction);
  if (operation === 'financing.evaluate' && bCtx.financing) return commercialResult(operation, 'ok', {is_financing_question:bCtx.financing.active,reply:bCtx.financing.reply,pending_requirement:bCtx.financing.active?'deposit':''});
  return commercialResult(operation, 'unsupported');
}

async function executeCommercialOperation(context, operation, payload = {}) {
  const result = executeCommercialOperationSync(context, operation, payload);
  if (result.status !== 'unsupported') return result;
  const bCtx = context?.noria_business_context || context?.business_context || {};
  if (operation === 'inventory.list' && Array.isArray(bCtx.inventory)) return commercialResult(operation, 'ok', {items:bCtx.inventory,count:bCtx.inventory.length});
  return result;
}
`;
    code = code.slice(0, dispatcherStart) + dispatcher + code.slice(dispatcherEnd);
  }
  // Workflows built before the v3 correction can already carry this adapter.
  // Normalize it on every build so no stale generated JSON calls removed
  // Genesis helpers or a local module.
  code = code.replace("  // These two are pure continuity checks already embedded in the CORE source;\n  // unlike the former adapter, they cannot return a Promise or perform I/O.\n  if (operation === 'vehicle.trade_in') return commercialResult(operation, 'ok', salesGenesisTradeInOffer(payload.history, payload.messages, payload.previous || {}));\n  if (operation === 'customer.name_progress') return commercialResult(operation, 'ok', {reply:salesGenesisNameProgressReply(payload.text, payload.state || {}, payload.product, payload.history) || ''});\n", '');
  // Inventory is an authenticated EXT responsibility. Do not bypass a failed
  // extension with a public Google GViz request from the shared CORE.
  const gvizStart = code.indexOf("  } else {\n    const id = settings.sales?.sheet_id;\n    if (!/^[A-Za-z0-9_-]{20,100}$/.test(id || '')) throw new Error('INVENTORY_NOT_CONFIGURED');\n    const text = await helpers.httpRequest({\n      method: 'GET',\n      url: 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:json&headers=1',");
  if (gvizStart >= 0) {
    const gvizEnd = code.indexOf("\n  }\n  const whatsappRows = await salesWhatsappCatalog", gvizStart);
    if (gvizEnd < 0) throw new Error('Public inventory fallback terminator missing');
    code = code.slice(0, gvizStart) + "  } else {\n    throw new Error('NORIA_EXTENSION_INVENTORY_UNAVAILABLE');\n  }" + code.slice(gvizEnd + 4);
  }
  if (!code.includes('// core-genesis-decoupling-v2') && !code.includes('// core-genesis-decoupling-v3')) {
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

function salesLoadGenesisCommercialEngine() {
  if (typeof globalThis !== 'undefined' && globalThis.__genesisCommercialEngine) {
    return globalThis.__genesisCommercialEngine;
  }
  let localRequire = typeof require === 'function' ? require : null;
  if (!localRequire && typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
    try {
      const nodeModule = process.getBuiltinModule('node:module');
      if (typeof nodeModule?.createRequire === 'function') {
        localRequire = nodeModule.createRequire(process.cwd() + '/');
      }
    } catch (_) {}
  }
  if (!localRequire && typeof globalThis !== 'undefined' && typeof globalThis.require === 'function') {
    localRequire = globalThis.require;
  }
  if (localRequire) {
    try {
      return localRequire('../../clients/wesley_automoveis/genesisCommercialEngine.cjs');
    } catch (_) {}
    try {
      const p = (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function')
        ? process.getBuiltinModule('node:path')
        : localRequire('node:path');
      return localRequire(p.resolve(process.cwd(), 'clients/wesley_automoveis/genesisCommercialEngine.cjs'));
    } catch (_) {}
  }
  return null;
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
    const gEngine = salesLoadGenesisCommercialEngine();
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
        return { contract: 'noria_business_result_v1', operation, status: 'ok', data: handoff.classification || handoff, handoff: { required: handoff.required, reason: handoff.reason, message: handoff.message } };
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
    const gEngine = salesLoadGenesisCommercialEngine();
    if (gEngine && typeof gEngine.executeBusinessOperation === 'function') {
      return await gEngine.executeBusinessOperation(operation, { ...payload, tenant_slug: tSlug, tenant_id: tId }, {
        ...context,
        httpRequest: helpers.httpRequest.bind(helpers),
        env: typeof env === 'function' ? env : (name => (typeof $env !== 'undefined' ? $env[name] : null)),
        settings: settingsFor(context),
      });
    }
  }

  return { contract: 'noria_business_result_v1', operation, status: 'unsupported', data: null, handoff: { required: false, reason: null, message: null } };
}

function salesPriceAuthorized(context = {}, row = null) {
  const settings = settingsFor(context);
  const policy = context?.client_policy || context?.noria_client_policy || context?.policy || {};
  const tSlug = context?.tenant?.slug || policy.tenant_slug || (typeof tenantSlug !== 'undefined' ? tenantSlug : '');
  const mode = settings.sales?.whatsapp_catalog_price_mode;
  if (mode === 'sheet_authorized' || mode === 'authorized_sheet') return true;
  if (tSlug === 'wesley_automoveis') {
    if (!row || !row.price_source) return true;
    return ['genesis_sheet', 'authorized_sheet', 'canonical_inventory'].includes(String(row.price_source)) || String(row.price_source).startsWith('whatsapp_catalog_');
  }
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
  const candidates = [model, brand + ' ' + model, model + ' ' + year, brand + ' ' + model + ' ' + year]
    .map(item => item.trim());
  if (candidates.includes(text)) return true;
  const padded = ' ' + text + ' ';
  const stopWords = new Set(['de', 'do', 'da', 'em', 'um', 'uma', 'os', 'as', 'no', 'na', 'para', 'com', 'por', 'me', 'fala', 'sobre']);
  const words = model.split(' ').filter(w => w.length >= 2 && !stopWords.has(w));
  return words.some(w => padded.includes(' ' + w + ' '));
}
`;

    // A. Replace salesInventory with generic dispatcher
    const invStart = code.indexOf('async function salesInventory(context, forceRefresh = false) {');
    const invEnd = code.indexOf('\nasync function salesLoadLead(context) {', invStart);
    if (invStart < 0 || invEnd < 0) throw new Error('salesInventory block missing');
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
    code = code.slice(0, invStart) + dispatcher + '\n' + newInventory + code.slice(invEnd);

    // B. Remove salesGenesisFinancingQuestion (3 functions)
    const finStart = code.indexOf("function salesGenesisFinancingQuestion(text = '', priorPending = '') {");
    const finEnd = code.indexOf('\nfunction salesDemonstrativeVehicleReference(value = \'\') {', finStart);
    if (finStart < 0 || finEnd < 0) throw new Error('salesGenesisFinancingQuestion block missing');
    code = code.slice(0, finStart) + code.slice(finEnd + 1);

    // C. Clean auth block: replace salesGenesisSheetPriceAuthorized while PRESERVING salesDepositExceedsKnownPrice
    const authStart = code.indexOf('function salesGenesisSheetPriceAuthorized(context = {}) {');
    const authEnd = code.indexOf('\nfunction salesPriceKnown(row = {}) {', authStart);
    if (authStart < 0 || authEnd < 0) throw new Error('authStart block missing');
    const preservedDeposit = `// A missing price cannot be treated as zero (JS: 100000 > null === true).
function salesDepositExceedsKnownPrice(depositCents, product = null) {
  const cents=product?.price_cents;
  return Number.isSafeInteger(depositCents) && depositCents>=0
    && Number.isSafeInteger(cents) && cents>0 && depositCents>cents;
}
`;
    code = code.slice(0, authStart) + preservedDeposit + code.slice(authEnd);

    // D. Remove salesGenesisTradeInOffer
    const tradeStart = code.indexOf('function salesGenesisTradeInOffer(history = [], messages = [], previous = {}) {');
    const tradeEnd = code.indexOf('\nfunction salesOwnVehicleOfferEvidence(', tradeStart);
    if (tradeStart < 0 || tradeEnd < 0) throw new Error('tradeStart block missing');
    code = code.slice(0, tradeStart) + code.slice(tradeEnd + 1);

    // E. Remove salesGenesisCatalogAudience / Filter definitions up to salesCatalogItems
    const audStart = code.indexOf('function salesGenesisCatalogAudience(text = \'\') {');
    const audEnd = code.indexOf('\nfunction salesCatalogItems(', audStart);
    if (audStart < 0 || audEnd < 0) throw new Error('audStart block missing');
    code = code.slice(0, audStart) + code.slice(audEnd + 1);

    // F. Replace salesGenesisCatalogOrdinal and salesGenesisExplicitCatalogBuy with generic salesCatalogOrdinal and salesExplicitCatalogBuy
    const ordStart = code.indexOf('function salesGenesisCatalogOrdinal(text = \'\') {');
    const ordEnd = code.indexOf('\nfunction salesCatalogChoice(', ordStart);
    if (ordStart < 0 || ordEnd < 0) throw new Error('ordStart block missing');
    const genericOrdinalCode = `function salesCatalogOrdinal(text = '') {
  const norm=normalizeText(text).replace(/\\[[^\\]]*\\]/g,' ').replace(/[^a-z0-9\\s]/g,' ').replace(/\\s+/g,' ').trim();
  if (!norm) return null;
  if (/\\b\\d+\\s*(?:mil|k|reais|km|por cento)\\b|r\\$/.test(norm)) return null;
  const patterns=[
    /\\b(?:esse|essa|este|esta|aquele|aquela)\\s+(?:(?:item|numero|modelo|opcao)\\s+)?([1-9]\\d?)\\b/,
    /\\b(?:quero|queria|vou|prefiro|gostei|pego|pegar|escolho|escolhi|comprar|compro|levar)\\s+(?:(?:pegar|comprar|levar|ficar\\s+com|saber\\s+sobre)\\s+)?(?:(?:o|a|item|opcao|numero|modelo)\\s+)?([1-9]\\d?)\\b/,
    /\\b(?:me\\s+fala\\s+(?:mais\\s+)?(?:sobre|do|da)|fala\\s+(?:mais\\s+)?(?:sobre|do|da)|sobre\\s+(?:o|a)|item|opcao|numero)\\s+(?:o\\s+|a\\s+)?([1-9]\\d?)\\b/,
    /^(?:(?:o|a)\\s+|(?:quero|gostei|prefiro)\\s+(?:o|a)\\s+|me\\s+fala\\s+mais\\s+(?:do|da)\\s+)?([1-9]\\d?)[.!?]*$/
  ];
  for (const pattern of patterns) {
    const match=norm.match(pattern);
    if (match) return Number(match[1]);
  }
  const ordinalWords={primeiro:1,primeira:1,segundo:2,segunda:2,terceiro:3,terceira:3,quarto:4,quarta:4,quinto:5,quinta:5,sexto:6,sexta:6,setimo:7,setima:7,oitavo:8,oitava:8};
  for (const [word,num] of Object.entries(ordinalWords)) {
    if (new RegExp('\\\\b'+word+'\\\\b').test(norm)&&!/\\b(?:feira|marcha|parcela|prestacao)\\b/.test(norm)) {
      return num;
    }
  }
  return null;
}

function salesExplicitCatalogBuy(text = '') {
  return salesCatalogOrdinal(text)!==null;
}
`;
    code = code.slice(0, ordStart) + genericOrdinalCode + code.slice(ordEnd);

    // G. Remove salesGenesisNameProgressReply up to salesLastPendingRequirement
    const nameStart = code.indexOf("function salesGenesisNameProgressReply(text = '', state = {}, product = null, history = []) {");
    const nameEnd = code.indexOf('\nfunction salesLastPendingRequirement(history = []) {', nameStart);
    if (nameStart < 0 || nameEnd < 0) throw new Error('nameStart block missing');
    code = code.slice(0, nameStart) + code.slice(nameEnd + 1);

    // H. Remove salesGenesisRepeatedDeferredSale up to salesCustomerDisposition
    const repStart = code.indexOf("function salesGenesisRepeatedDeferredSale(text = '', mode = '', previousState = {}) {");
    const repEnd = code.indexOf('\nfunction salesCustomerDisposition(', repStart);
    if (repStart < 0 || repEnd < 0) throw new Error('repStart block missing');
    code = code.slice(0, repStart) + code.slice(repEnd + 1);

    // I. Remove salesGenesisExplicitListingRequested up to salesVehiclePhotoRequested
    const listStart = code.indexOf("function salesGenesisExplicitListingRequested(text = '') {");
    const listEnd = code.indexOf('\nfunction salesVehiclePhotoRequested(text = \'\') {', listStart);
    if (listStart < 0 || listEnd < 0) throw new Error('listStart block missing');
    code = code.slice(0, listStart) + code.slice(listEnd + 1);

    // J. Replace auction classifier block
    const aucStart = (()=>{
      const a1 = code.indexOf('  // genesis-sheet-price-and-auction-v6');
      if (a1 >= 0) return a1;
      return code.indexOf('  const auctionText=normalizeText(latestTurnText);');
    })();
    const aucEnd = code.indexOf('\n  const cashPurchase=', aucStart);
    if (aucStart < 0 || aucEnd < 0) throw new Error('aucStart block missing');
    const newAuctionClassifier = `  // generic-auction-evaluation-v1
  const targetAuctionState = generated.state || lead?.state || {};
  const auctionProductCandidate = generated.product || catalogChoice?.product || salesResolveInventoryReference(latestTurnText, inventory)?.product
    || inventory.find(row => (row.id && row.id === targetAuctionState.product_id)
        || [row.brand, row.model, row.year, row.color].map(x => String(x||'').toLowerCase()).join('|') === targetAuctionState.product_id)
    || null;
  const auctionOp = executeCommercialOperationSync(context, 'auction.evaluate_handoff', {
    text: latestTurnText,
    state: targetAuctionState,
    inventory,
    product: auctionProductCandidate,
  });
  const auctionIntent = (auctionOp.status === 'ok' && auctionOp.data?.intent) ? auctionOp.data : null;
  const auctionHandoff = auctionIntent ? {
    requested: auctionOp.handoff?.required === true,
    reason: auctionOp.handoff?.reason || auctionIntent.reason || 'auction_intent_unclear',
    intent: auctionIntent.intent || 'customer_vehicle_offer',
    tenant: tenantSlug,
    vehicle_origin: auctionIntent.origin || 'customer',
    vehicle: auctionProductCandidate ? { product_id: auctionProductCandidate.id || '', name: [auctionProductCandidate.brand, auctionProductCandidate.model].filter(Boolean).join(' ') || auctionProductCandidate.name || '', model: auctionProductCandidate.model || '', year: auctionProductCandidate.year || null } : null,
    inventory_history: auctionIntent.inventory_history || { documented: false, observation: '' },
    open_question: auctionOp.handoff?.message || '',
  } : null;
  if (auctionHandoff) {
    event.raw_payload = { ...(event.raw_payload || {}), auction_vehicle_purchase: auctionHandoff };
  }`;
    code = code.slice(0, aucStart) + newAuctionClassifier + code.slice(aucEnd);

    // K. Replace auction branch
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
    }

    // L. Replace tradeIn in turn
    code = code.replace(
      "const tradeInContext=salesGenesisTradeInOffer(history,turn.messages,lead?.state||{});",
      "const tradeInResult=executeCommercialOperationSync(context, 'vehicle.trade_in', { history, messages: turn.messages, previous: lead?.state||{}, prior_pending: salesLastPendingRequirement(history) });\n  const tradeInContext=tradeInResult.data;"
    );

    // M. Update salesCatalogChoice ordinal call
    code = code.replace(
      "  if (index===null) index=salesGenesisCatalogOrdinal(text); // commercial-catalog-continuity-v1",
      "  if (index===null) index=salesCatalogOrdinal(text); // generic-catalog-ordinal-v1"
    );

    // N. Replace financingQuestion in turn
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

    // O. Replace catalog filter calls
    const catFilterCall = "if(naturalPlan&&catalogRequested)catalogItems=salesCatalogItems(salesGenesisCatalogFilter(inventory,({cars:'carros',motorcycles:'motos',all:''})[naturalPlan.memory.catalog_audience||'all']));";
    if (code.includes(catFilterCall)) {
      code = replaceOnce(code, catFilterCall,
        "if(naturalPlan&&catalogRequested){\n    const filterOp=executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText, audience: naturalPlan.memory.catalog_audience });\n    catalogItems=salesCatalogItems(filterOp.status==='ok' && Array.isArray(filterOp.data?.items) ? filterOp.data.items : inventory);\n  }",
        'catalog filter call');
    }

    // P. Replace name progress reply
    code = code.replace(
      "const nameProgressReply=salesGenesisNameProgressReply(turnText,s,generated.product,history);",
      "const nameProgressOp=executeCommercialOperationSync(context, 'customer.name_progress', { text: turnText, state: s, product: generated.product, history });\n    const nameProgressReply=nameProgressOp.data?.reply || '';"
    );

    // Q. Fix Caso Jeferson and bare selection price presentation
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
      && !acceptedHumanOffer && !afterSales && !isLocationRequest && !customerDisposition && !auctionIntent
      && generated.action!=='handoff'
      && ((!/r\\$\\s*\\d/i.test(reply)||catalogActionBlocked||currentProductSelected)
        && (isSelectedTurnProduct
          || (/\\b(?:preco|valor|quanto|custa)\\b/.test(normalizeText(turnText))
            && !/\\b(?:entrada|sinal|parcela|financiamento)\\b/.test(normalizeText(turnText)))))) {
    reply = generated.product.model+' está anunciada por '+salesMoney(generated.product.price_cents)
      +'\\nA disponibilidade é a confirmar com a equipe\\nQuer mais detalhes?';
    pendingRequirement='';
    followUpDisposition='awaiting_customer';
    catalogChoiceAcknowledged=true;
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

    // Replace occurrences in remaining code
    code = code.replace("const parsed=salesGenesisSheetPrice(number+(match[2]||''));", "const parsed=salesAmountPriceParser(number+(match[2]||''));");
    code = code.replace("|| (tenantSlug==='wesley_automoveis' && salesGenesisExplicitCatalogBuy(currentText))", "|| salesExplicitCatalogBuy(currentText)");
    code = code.replace("let catalogChoice=ownVehicleOffer && !salesGenesisExplicitCatalogBuy(currentTurnText)", "let catalogChoice=ownVehicleOffer && !salesExplicitCatalogBuy(currentTurnText)");
    code = code.replace("&& !(tenantSlug==='wesley_automoveis'&&salesGenesisFinancingQuestion(currentTurnText,salesLastPendingRequirement(history)))", "");
    code = code.replace("const repeatsDeferredSale=salesGenesisRepeatedDeferredSale(turnText,mode,lead?.state||{});", "const repeatsDeferredSale=(lead?.state?.follow_up_disposition==='deferred_by_customer' && ['sell','buy_and_sell'].includes(mode) && /^(?:vender|quero\\s+vender|continuar\\s+(?:a\\s+)?venda)$/.test(normalizeText(turnText).trim()));");
    code = code.replace("?salesGenesisExplicitListingRequested(turnText):salesCatalogRequested(turnText);", "?salesCatalogRequested(turnText):salesCatalogRequested(turnText);");
    code = code.replace("reply=tenantSlug==='wesley_automoveis'&&salesGenesisSheetPriceAuthorized(context)", "reply=salesPriceAuthorized(context, generated.product)");
    code = code.replace(":(tenantSlug==='wesley_automoveis'?salesGenesisCatalogFilter(inventory,turnText):inventory)", ":(executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText })?.data?.items || inventory)");
    // R. Auction handoff must survive Gemini technical failures & dialogue planning failures
    code = code.replace(
      "if(tenantSlug==='wesley_automoveis'&&generated.technical_error)naturalPlanError='DIALOGUE_GENERATION_FAILED';",
      "if(tenantSlug==='wesley_automoveis'&&generated.technical_error&&!(auctionIntent&&auctionOp?.handoff?.required))naturalPlanError='DIALOGUE_GENERATION_FAILED';"
    );
    code = code.replace(
      "if(naturalPlanError){\n    const verifiedFinancing=!!financing?.enabled&&financing.documents_complete&&!!s.customer_name&&s.deposit_cents!==null;\n    if(naturalPlanError==='DIALOGUE_GENERATION_FAILED'||!verifiedFinancing&&!afterSales&&!priceDiscrepancy){stage=cfg.stage_keys.qualifying;register=false;handoffReason='';optionalHumanOffer=null;}",
      "if(naturalPlanError&&!(auctionIntent&&auctionOp?.handoff?.required)){\n    const verifiedFinancing=!!financing?.enabled&&financing.documents_complete&&!!s.customer_name&&s.deposit_cents!==null;\n    if(naturalPlanError==='DIALOGUE_GENERATION_FAILED'||!verifiedFinancing&&!afterSales&&!priceDiscrepancy){stage=cfg.stage_keys.qualifying;register=false;handoffReason='';optionalHumanOffer=null;}"
    );
    code = code.replace(
      "if(generated.technical_error){reply='Estou com uma dificuldade temporária para consultar o atendimento. Posso pedir para um atendente ajudar?';catalogPhotoToSend=null;}",
      "if(generated.technical_error&&!(auctionIntent&&auctionOp?.handoff?.required)){reply='Estou com uma dificuldade temporária para consultar o atendimento. Posso pedir para um atendente ajudar?';catalogPhotoToSend=null;}"
    );
    code = code.replace(
      "}else if(naturalPlanError){\n      dialogueNeedsReview=false;event.ai_error=naturalPlanError;",
      "}else if(naturalPlanError&&!(auctionIntent&&auctionOp?.handoff?.required)){\n      dialogueNeedsReview=false;event.ai_error=naturalPlanError;"
    );
    code = code.replace(
      "if(generated.technical_error && assignmentConfirmed){\n      reply='Seu atendimento foi encaminhado para um atendente continuar por aqui';",
      "if(generated.technical_error && assignmentConfirmed && !(auctionIntent&&auctionOp?.handoff?.required)){\n      reply='Seu atendimento foi encaminhado para um atendente continuar por aqui';"
    );
    code = code.replace(
      "if(naturalPlan&&!auctionIntent&&!generated.technical_error",
      "if(naturalPlan&&!auctionIntent&&!isSelectedTurnProduct&&!generated.technical_error"
    );
  }

  const pendingNeedle = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion) {`;
  const pendingReplacement = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion
      && !depositValidation) {`;
  if (!code.includes(pendingReplacement)) {
    code = replaceOnce(code, pendingNeedle, pendingReplacement, 'deposit-specific pending reply');
  }

  // Catalog order is evidence.  It is attached to the outbound event only in
  // sendChannelMessage after the provider accepts the message, so a failed or
  // cancelled response can never become a selectable future list.
  const catalogEvidenceMarker = 'catalog_context:{contract:\'noria_catalog_context_v1\'';
  if (!code.includes(catalogEvidenceMarker)) {
    const catalogEvidenceNeedle = "      ...((naturalPlan?catalogPresented:catalogItems.length)?{catalog_item_ids:catalogItems.map(item=>item.id)}:{}),";
    const catalogEvidenceReplacement = `      ...((naturalPlan?catalogPresented:catalogItems.length)?{catalog_item_ids:catalogItems.map(item=>item.id),
        catalog_context:{contract:'noria_catalog_context_v1',session_id:turn.boundary_id,displayed_at:new Date().toISOString(),source:'genesis_sheet',products:catalogItems.map(item=>({id:item.id,commercial_name:item.commercial_name||item.name||'',brand:item.brand||'',model:item.model||'',year:item.year||null,color:item.color||'',price_cents:item.price_cents??null,price_source:item.price_source||'genesis_sheet',status:item.status||'',offerable:item.offerable===true}))}}:{}),`;
    if (!code.includes(catalogEvidenceNeedle)) throw new Error('Catalog context persistence insertion point missing');
    code = replaceOnce(code, catalogEvidenceNeedle, catalogEvidenceReplacement, 'catalog context persistence');
  }

  new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', code);
  return code;
}

module.exports = {
  applyCommercialRegressions,
};
