function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label} insertion point`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label} insertion point`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function applyCommercialRegressions(source, ts) {
  let code = source;

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
    // A current ordinal catalog choice is the purchase side; the offered car
    // remains exclusively on the sell/trade-in side.
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

  if (!code.includes('// commercial-catalog-continuity-v1')) {
    code = replaceOnce(code,
      "  if (index===null && tenantSlug==='wesley_automoveis') index=salesGenesisCatalogOrdinal(text);",
      "  if (index===null) index=salesGenesisCatalogOrdinal(text); // commercial-catalog-continuity-v1",
      'mixed ordinal catalog choice');
    code = replaceOnce(code,
      "  let catalogChoice=ownVehicleOffer && !(tenantSlug==='wesley_automoveis' && salesGenesisExplicitCatalogBuy(currentTurnText))",
      "  let catalogChoice=ownVehicleOffer && !salesGenesisExplicitCatalogBuy(currentTurnText)",
      'catalog choice with customer vehicle');
    code = replaceOnce(code,
      "  if (tenantSlug==='wesley_automoveis' && !generated.product && s.product_id) {",
      "  if (!generated.product && s.product_id) {",
      'exact product continuity');
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

  if (!code.includes('// genesis-sheet-price-and-auction-v1')) {
    const genesisParserNeedle = `function salesParseGenesisInventory(data, columns) {
  const ids=new Set();
  return data.table.rows.filter(row=>Array.isArray(row.c)&&row.c.some(cell=>cell?.v!=null)).map(row=>{
    const value=name=>row.c[columns.indexOf(name)]?.v;
    const str=name=>String(value(name)??'').trim();`;
    const genesisParserReplacement = `function salesParseGenesisInventory(data, columns) {
  // genesis-sheet-price-and-auction-v1
  const ids=new Set();
  const parseSheetPrice=value=>{
    if (typeof value==='number') return Number.isFinite(value)?value:null;
    const raw=String(value??'').trim();
    if (!raw) return null;
    const normalized=raw.replace(/^R\\$\\s*/i,'').replace(/\\./g,'').replace(',','.');
    return /^\\d+(?:\\.\\d{1,2})?$/.test(normalized)&&Number.isFinite(Number(normalized))?Number(normalized):null;
  };
  return data.table.rows.filter(row=>Array.isArray(row.c)&&row.c.some(cell=>cell?.v!=null)).map(row=>{
    const value=name=>row.c[columns.indexOf(name)]?.v;
    const str=name=>String(value(name)??'').trim();`;
    code = replaceOnce(code, genesisParserNeedle, genesisParserReplacement, 'Genesis price parser');
    const priceNeedle = `    const rawPrice=value('preco'),price=Number(rawPrice);`;
    code = replaceOnce(code, priceNeedle, `    const rawPrice=value('preco'),price=parseSheetPrice(rawPrice);`, 'Brazilian sheet price conversion');
    const sheetUrl = `url:'https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:json&headers=1',`;
    code = replaceOnce(code, sheetUrl, `url:'https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:json&headers=1&sheet='+encodeURIComponent('Página1'),`, 'Genesis sheet tab');

    const afterSalesNeedle = `  const afterSales=generated.reason==='after_sales'||mode==='after_sales'
    || /(?:comprei|comprei com voces|carro que comprei).{0,100}(?:defeito|problema|quebrou|parou|garantia)/.test(normalizeText(rawText));`;
    const afterSalesReplacement = `${afterSalesNeedle}
  // A purchase of an auction vehicle needs human appraisal; do not invent terms.
  const auctionPurchase=tenantSlug==='wesley_automoveis'
    && /\\b(?:leilao|leiloado|sinistro\\s+de\\s+leilao)\\b/.test(normalizeText(turnText));`;
    code = replaceOnce(code, afterSalesNeedle, afterSalesReplacement, 'auction handoff detection');
    const firstDecisionNeedle = `  if (acceptedHumanOffer || (appraisalWalkInActive && explicitCurrentHumanRequest)) {`;
    const firstDecisionReplacement = `  if (auctionPurchase) {
    stage=cfg.stage_keys.human;register=false;handoffReason='auction_vehicle_purchase';
    pendingRequirement='';optionalHumanOffer=null;followUpDisposition='resolved';
    reply='Compramos veículos de leilão mediante avaliação. Vou passar seu atendimento para a equipe verificar o caso com você.';
    event.raw_payload={...(event.raw_payload||{}),auction_vehicle_purchase:{requested:true,reason:'auction_vehicle_purchase'}};
  } else if (acceptedHumanOffer || (appraisalWalkInActive && explicitCurrentHumanRequest)) {`;
    code = replaceOnce(code, firstDecisionNeedle, firstDecisionReplacement, 'auction handoff branch');
  }

  if (!code.includes('// genesis-sheet-price-and-auction-v6')) {
    // Upgrade the canonical v1 insertion rather than adding a competing rule.
    if (!code.includes("observations:str('observacoes')")) {
      code = replaceOnce(code,
        "      fuel:str('combustivel'),price_cents:priceCents,status,\n      availability_verified:status==='listed'||status==='disponivel'};",
        "      fuel:str('combustivel'),observations:str('observacoes'),price_cents:priceCents,status,\n      availability_verified:status==='listed'||status==='disponivel'};",
        'Genesis auction observations');
    }
    const auctionStart=(()=>{const legacy=code.indexOf('  // A purchase of an auction vehicle needs human appraisal; do not invent terms.');if(legacy>=0)return legacy;for(const version of ['v6','v5','v4','v3','v2']){const index=code.indexOf('  // genesis-sheet-price-and-auction-'+version);if(index>=0)return index;}return -1;})();
    const auctionEnd=code.indexOf('\n  const cashPurchase=',auctionStart);
    if (auctionStart<0||auctionEnd<0) throw new Error('Auction v1 classifier missing');
    const auctionClassifier=`  // genesis-sheet-price-and-auction-v6
  // Use the claimed inbound events directly; model state and historical text
  // must never decide an auction handoff for the current customer message.
  const auctionText=normalizeText(latestTurnText);
  const auctionTopic=tenantSlug==='wesley_automoveis'&&/(?:leilao|leiloado|sinistro)/.test(auctionText);
  const auctionProduct=generated.product||catalogChoice?.product||salesResolveInventoryReference(latestTurnText,inventory)?.product||null;
  const auctionObservation=String(auctionProduct?.observations||'');
  const auctionHistoryDocumented=/\\b(?:leilao|leiloado|sinistro\\s+de\\s+leilao)\\b/.test(normalizeText(auctionObservation));
  const auctionOwnVehicle=/(?:\\b(?:voce|voces|vcs)\\s+(?:compram|pegam)\\b|\\b(?:meu|minha)\\s+(?:carro|veiculo|moto)\\b|\\b(?:quero|pretendo)\\s+vender\\b|\\b(?:aceitam|pegam)\\s+(?:carro|veiculo|moto)\\b)/.test(auctionText);
  const auctionNegativeOwnVehicle=/(?:\\bnao\\s+(?:e|foi)\\s+(?:de\\s+)?leilao\\b|\\bnao\\s+quero\\b|\\bnunca\\s+foi\\s+leiloado\\b)/.test(auctionText);
  const auctionHistoryQuestion=/(?:\\b(?:passou|foi|era|tem)\\b.{0,32}\\b(?:leilao|leiloado)\\b|\\bhistorico\\b)/.test(auctionText);
  const auctionInventoryInterest=!!auctionProduct&&/(?:\\btenho\\s+interesse\\b|\\bquero\\s+(?:esse|este)\\b|\\bcomprar\\s+(?:esse|este)\\b)/.test(auctionText);
  const auctionIntent=!auctionTopic?null
    :(!auctionNegativeOwnVehicle&&auctionOwnVehicle?{intent:'customer_vehicle_offer',reason:'auction_vehicle_purchase',origin:'customer'}
      :(auctionInventoryInterest?{intent:'inventory_interest',reason:'auction_inventory_interest',origin:'inventory'}
        :(auctionProduct&&auctionHistoryQuestion?{intent:'inventory_history',reason:'auction_inventory_history',origin:'inventory'}
          :{intent:'unclear',reason:'auction_intent_unclear',origin:auctionProduct?'inventory':'unknown'})));
  const auctionHandoff=auctionIntent?{requested:true,reason:auctionIntent.reason,intent:auctionIntent.intent,tenant:tenantSlug,
    vehicle_origin:auctionIntent.origin,vehicle:auctionProduct?{product_id:auctionProduct.id||'',name:auctionProduct.name||'',model:auctionProduct.model||'',year:auctionProduct.year||null}:null,
    inventory_history:{documented:auctionHistoryDocumented,observation:auctionHistoryDocumented?auctionObservation:''},
    open_question:auctionIntent.intent==='inventory_history'?(auctionHistoryDocumented?'Confirmar detalhes e condições do histórico de leilão.':'Confirmar se há histórico de leilão documentado para o veículo.')
      :(auctionIntent.intent==='inventory_interest'?'Confirmar histórico de leilão e condições de negociação.'
        :(auctionIntent.intent==='customer_vehicle_offer'?'Avaliar o veículo de leilão oferecido pelo cliente.':'Esclarecer a dúvida do cliente sobre leilão.'))}:null;`;
    code=code.slice(0,auctionStart)+auctionClassifier+code.slice(auctionEnd);
    const branchStart=(()=>{const legacy=code.indexOf('  if (auctionPurchase) {');return legacy>=0?legacy:code.indexOf('  if (auctionIntent) {');})();
    const branchEnd=code.indexOf('\n  } else if (acceptedHumanOffer || (appraisalWalkInActive && explicitCurrentHumanRequest)) {',branchStart);
    if (branchStart<0||branchEnd<0) throw new Error('Auction v1 handoff missing');
    const auctionBranch=`  if (auctionIntent) {
    stage=cfg.stage_keys.human;register=false;handoffReason=auctionIntent.reason;
    pendingRequirement='';optionalHumanOffer=null;followUpDisposition='resolved';
    reply=auctionIntent.intent==='customer_vehicle_offer'
      ?'Sim, a Gênesis compra veículos de leilão mediante avaliação. Vou encaminhar seu caso para a equipe seguir com você.'
      :(auctionIntent.intent==='inventory_history'
        ?(auctionHistoryDocumented?'Na ficha desse veículo consta histórico de leilão. Vou encaminhar para a equipe confirmar os detalhes com você.':'Não tenho essa informação confirmada na ficha do veículo. Vou encaminhar para a equipe verificar com você.')
        :(auctionIntent.intent==='inventory_interest'?'Entendi seu interesse nesse veículo. Vou pedir para a equipe confirmar o histórico de leilão e as condições da negociação.':'Entendi sua dúvida sobre leilão. Vou encaminhar para a equipe confirmar esse detalhe com você.'));
    event.raw_payload={...(event.raw_payload||{}),auction_vehicle_purchase:auctionHandoff};
  }`;
    // Keep the original `else if` while replacing only its preceding branch.
    code=code.slice(0,branchStart)+auctionBranch+code.slice(branchEnd+4);
  }

  if (!code.includes('// genesis-auction-compose-guard-v1')) {
    code = replaceOnce(code,
      "    if(naturalPlan&&!generated.technical_error&&!generated.media_notice&&!(simpleAcknowledgement&&followUpDisposition==='resolved')){",
      "    // genesis-auction-compose-guard-v1\n    if(naturalPlan&&!auctionIntent&&!generated.technical_error&&!generated.media_notice&&!(simpleAcknowledgement&&followUpDisposition==='resolved')){",
      'auction handoff composition guard');
  }

  if (!code.includes('// genesis-auction-assignment-v1')) {
    code = replaceOnce(code,
      "'after_sales','sales_human','appraisal','hot_lead','accepted_human_offer','frustration'].includes(handoffReason)) {",
      "'after_sales','sales_human','appraisal','hot_lead','accepted_human_offer','frustration','auction_vehicle_purchase','auction_inventory_history','auction_inventory_interest','auction_intent_unclear'].includes(handoffReason)) { // genesis-auction-assignment-v1",
      'auction handoff assignment');
  }

  if (!code.includes('// genesis-auction-final-handoff-v1')) {
    code = replaceOnce(code,
      "  if (!await commit()) return {ok:true,skipped:true,reason:'superseded'};\n  // Re-read the source before registering.",
      "  // genesis-auction-final-handoff-v1\n  if (auctionIntent) { stage=cfg.stage_keys.human; register=false; handoffReason=auctionIntent.reason; followUpDisposition='resolved'; }\n  if (!await commit()) return {ok:true,skipped:true,reason:'superseded'};\n  // Re-read the source before registering.",
      'auction final handoff');
  }

  const pendingNeedle = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion) {`;
  const pendingReplacement = `      && !currentIntentAmbiguity && !vehicleYearClarification && !contextualCatalogQuestion && !catalogChoice.ambiguous && !continuation && !selectedProductQuestion
      && !depositValidation) {`;
  if (!code.includes('&& !depositValidation) {')) {
    code = replaceOnce(code, pendingNeedle, pendingReplacement, 'deposit-specific pending reply');
  }

  new (Object.getPrototypeOf(async function(){}).constructor)('$json', '$env', '$vars', '$getWorkflowStaticData', code);
  if (ts) {
    const diagnostics = ts.transpileModule(`async function __noria_core($json,$env,$vars,$getWorkflowStaticData){${code}\n}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
    }).diagnostics || [];
    if (diagnostics.length) throw new Error(`Commercial regression transform syntax failure: ${diagnostics[0].messageText}`);
  }
  return code;
}

module.exports = { applyCommercialRegressions };
