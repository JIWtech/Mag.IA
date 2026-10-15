'use strict';

// Keeps semantic interpretation in the primary Gemini response.  This module
// deliberately performs only local validation and deterministic resolution;
// it must never add a second provider request.
function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Semantic intent insertion point ${name} missing`);
  const next = source.indexOf('\nfunction ', start + 10);
  if (next < 0) throw new Error(`Semantic intent boundary ${name} missing`);
  return source.slice(0, start) + replacement.trim() + '\n' + source.slice(next + 1);
}

function applySemanticExecutionContract(code){
  code=code.replace("semantic_fallback:{reason:'invalid_or_missing_semantic_intent',mode:'deterministic_legacy'}","semantic_fallback:{reason:'invalid_or_missing_semantic_intent',mode:'deterministic_legacy',validation_errors:generated.semantic_intent?.validation_errors||[]}");
  code=code.replace("  if(!semanticCatalogChoice&&tenantSlug==='wesley_automoveis')event.raw_payload={...(event.raw_payload||{}),semantic_fallback:{reason:'selection_not_structured',mode:'deterministic_legacy'}};",`  if(!semanticCatalogChoice&&tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    &&(generated.semantic_intent.references?.selected_ordinal!==null||generated.semantic_intent.references?.mentioned_product_ids?.length))
    event.raw_payload={...(event.raw_payload||{}),semantic_fallback:{reason:'selection_not_structured',mode:'deterministic_legacy'}};`);
  const evidenceTail='Use null somente nos campos nullable quando a informação estiver ausente. Não invente IDs nem atributos de veículos.';
  if(code.includes(evidenceTail)&&!code.includes('Quando uma preferência ou exclusão for verificável no estoque'))code=code.replace(evidenceTail,'Quando uma preferência ou exclusão for verificável no estoque, use somente field=value com field brand, model, color, fuel, year_min, year_max ou product_id. Mantenha preferências subjetivas em texto livre para que o executor peça esclarecimento, sem inventar atributos. '+evidenceTail);
  const filterBlock="  if(naturalPlan&&catalogRequested){\n    const filterOp=executeCommercialOperationSync(context, 'inventory.filter_catalog', { inventory, query: turnText, audience: naturalPlan.semantic_intent?.catalog?.category || naturalPlan.memory.catalog_audience, semantic_catalog: naturalPlan.semantic_intent?.catalog });\n    catalogItems=salesCatalogItems(filterOp.status==='ok' && Array.isArray(filterOp.data?.items) ? filterOp.data.items : inventory);\n  }";
  if(code.includes(filterBlock))code=code.replace(filterBlock,"  let semanticCatalogExecution=null;\n"+filterBlock.replace("catalogItems=salesCatalogItems", "semanticCatalogExecution=filterOp.status==='ok'?filterOp.data:null;\n    catalogItems=salesCatalogItems"));
  const catalogBranch="  } else if (catalogRequested) {";
  if(code.includes(catalogBranch)&&!code.includes('semantic_catalog_clarification'))code=code.replace(catalogBranch,`  } else if (catalogRequested&&semanticCatalogExecution?.requires_clarification) {
    stage=cfg.stage_keys.qualifying;register=false;pendingRequirement='';followUpDisposition='awaiting_customer';optionalHumanOffer=null;
    reply='Consigo filtrar o estoque por categoria, faixa de preço, marca, modelo, ano, cor e combustível, mas não há dados autorizados para confirmar '+semanticCatalogExecution.unsupported.join(', ')+'. Qual desses critérios objetivos é mais importante para você?';
    event.raw_payload={...(event.raw_payload||{}),semantic_catalog_clarification:{unsupported:semanticCatalogExecution.unsupported,applied:semanticCatalogExecution.applied||[]}};
  } else if (catalogRequested) {`);
  const ambiguityOld='  const currentIntentAmbiguity=salesIntentAmbiguity(currentTurnText,lead?.state||{});';
  if(code.includes(ambiguityOld))code=code.replace(ambiguityOld,`  const currentIntentAmbiguity=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    ?(generated.semantic_intent.primary_intent==='ambiguous'?{kind:'semantic_ambiguity',reply:'Quero confirmar para não seguir pelo caminho errado: você pretende comprar, vender, trocar ou apenas consultar um veículo?'}:null)
    :salesIntentAmbiguity(currentTurnText,lead?.state||{});`);
  code=code.replace("  const currentIntentAmbiguity=generated.semantic_intent?.valid\n    ?(generated.semantic_intent.primary_intent==='ambiguous'","  const currentIntentAmbiguity=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid\n    ?(generated.semantic_intent.primary_intent==='ambiguous'");
  const financingOld="  const financingOp=executeCommercialOperationSync(context, 'financing.evaluate', { text: turnText, product: generated.product, prior_pending: salesLastPendingRequirement(history) });\n  const financingQuestion=financingOp.status==='ok' && financingOp.data?.is_financing_question;";
  if(code.includes(financingOld))code=code.replace(financingOld,`  const semanticFinancing=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid&&(generated.semantic_intent.primary_intent==='financing'||generated.semantic_intent.secondary_intents?.includes('financing'));
  const financingOp=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    ?commercialResult('financing.evaluate','ok',{is_financing_question:semanticFinancing,
      reply:semanticFinancing?'Trabalhamos com financiamento, sujeito à análise da financeira\\nQuanto você pretende dar de entrada?':null,
      pending_requirement:semanticFinancing&&!generated.product?'deposit':''})
    :executeCommercialOperationSync(context, 'financing.evaluate', { text: turnText, product: generated.product, prior_pending: salesLastPendingRequirement(history) });
  const financingQuestion=financingOp.status==='ok' && financingOp.data?.is_financing_question;`);
  code=code.replace("  const semanticFinancing=generated.semantic_intent?.valid&&","  const semanticFinancing=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid&&");
  code=code.replace("  const financingOp=generated.semantic_intent?.valid\n    ?commercialResult('financing.evaluate'","  const financingOp=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid\n    ?commercialResult('financing.evaluate'");
  const detailsOld="  const selectedProductQuestion=tenantSlug==='wesley_automoveis'&&mode==='buy'&&generated.product&&!financingQuestion\n    && /\\b(?:km|quilometragem|cor|ano|combustivel|gnv|motor|detalhes|como que e)\\b/.test(normalizeText(turnText));";
  if(code.includes(detailsOld))code=code.replace(detailsOld,`  const selectedProductQuestion=tenantSlug==='wesley_automoveis'&&mode==='buy'&&generated.product&&!financingQuestion
    &&(generated.semantic_intent?.valid?generated.semantic_intent.primary_intent==='product_details'
      :/\\b(?:km|quilometragem|cor|ano|combustivel|gnv|motor|detalhes|como que e)\\b/.test(normalizeText(turnText)));`);
  const sellerInventoryGate="    const sellerOnly=tenantSlug==='wesley_automoveis' && salesSellerFlowNeedsNoInventory(lead?.state||{},currentTurnText,turn.messages);";
  if(code.includes(sellerInventoryGate))code=code.replace(sellerInventoryGate,`    // The primary semantic interpretation happens after inventory loading. Genesis
    // therefore receives its bounded tenant-scoped snapshot for every eligible
    // automated sales turn; a lexical seller-only guess cannot remove context.
    const sellerOnly=false;`);
  const contextualOld="  const contextualCatalogQuestion=!!(catalogChoice.product&&salesContextualProductQuestion(currentTurnText))\n    ;";
  if(code.includes(contextualOld))code=code.replace(contextualOld,`  const contextualCatalogQuestion=!!(catalogChoice.product
    &&(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
      ?['product_details','price_question'].includes(generated.semantic_intent.primary_intent)
      :salesContextualProductQuestion(currentTurnText)));`);
  code=code.replace("  const contextualCatalogQuestion=!!(catalogChoice.product\n    &&(generated.semantic_intent?.valid\n      ?['product_details','price_question'].includes(generated.semantic_intent.primary_intent)","  const contextualCatalogQuestion=!!(catalogChoice.product\n    &&(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid\n      ?['product_details','price_question'].includes(generated.semantic_intent.primary_intent)");
  const cashOld="  const cashPurchase=mode==='buy'&&(s.payment_mode==='cash'||salesCashPurchase(turnText));";
  if(code.includes(cashOld))code=code.replace(cashOld,"  const cashPurchase=mode==='buy'&&(s.payment_mode==='cash'||(!(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid)&&salesCashPurchase(turnText)));" );
  code=code.replace("  const cashPurchase=mode==='buy'&&(s.payment_mode==='cash'||(!generated.semantic_intent?.valid&&salesCashPurchase(turnText)));","  const cashPurchase=mode==='buy'&&(s.payment_mode==='cash'||(!(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid)&&salesCashPurchase(turnText)));" );
  const paymentStateOld="  generated.state=salesApplyDeterministicPaymentState(generated.state,turn.messages);";
  if(code.includes(paymentStateOld))code=code.replace(paymentStateOld,"  if(!(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid))generated.state=salesApplyDeterministicPaymentState(generated.state,turn.messages);" );
  const generationPaymentOld="  salesApplyDeterministicPaymentState(result.state,turn.messages);\n  salesApplyDeterministicDepositState(result.state,turn.messages,history,inventory.find(p=>p.id===result.state.product_id)||null);\n  const checked=salesValidate(result,messages,inventory,context,selectionProofs);\n  checked.semantic_intent=salesValidateSemanticIntent(result.semantic_intent,inventory,salesDialogueSessionIds(history));";
  if(code.includes(generationPaymentOld))code=code.replace(generationPaymentOld,`  const semanticPrecheck=salesValidateSemanticIntent(result.semantic_intent,inventory,salesDialogueSessionIds(history));
  if(!(tenantSlug==='wesley_automoveis'&&semanticPrecheck.valid))salesApplyDeterministicPaymentState(result.state,turn.messages);
  salesApplyDeterministicDepositState(result.state,turn.messages,history,inventory.find(p=>p.id===result.state.product_id)||null);
  const checked=salesValidate(result,messages,inventory,context,selectionProofs);
  checked.semantic_intent=semanticPrecheck;`);
  code=code.replace('  checked.semantic_intent=semanticPrecheck;',
    "  checked.semantic_intent=tenantSlug==='wesley_automoveis'?salesSemanticRecoverBudget(semanticPrecheck,turn.messages,result.action):semanticPrecheck;");
  const semanticAmbiguityAnchor="  const currentIntentAmbiguity=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid";
  if(code.includes(semanticAmbiguityAnchor))code=code.replace(semanticAmbiguityAnchor,`  const currentIntentAmbiguity=tenantSlug==='wesley_automoveis'&&salesSemanticAmbiguousOtherReference(currentTurnText,generated.semantic_intent,history,inventory)
    ?{kind:'ambiguous_catalog_reference',reply:'Qual veículo da lista você quis dizer? Pode informar o número ou o modelo para eu identificar corretamente.'}
    :tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid`);
  code=code.replace('Qual veiculo da lista voce quis dizer? Pode informar o numero ou o modelo para eu identificar corretamente.',
    'Qual veículo da lista você quis dizer? Pode informar o número ou o modelo para eu identificar corretamente.');
  const referenceIntentAnchor="  if(tenantSlug==='wesley_automoveis'&&!generated.semantic_intent?.valid)event.raw_payload=";
  if(code.includes(referenceIntentAnchor)&&!code.includes('  // preserve-unresolved-catalog-reference-state'))code=code.replace(referenceIntentAnchor,`  // preserve-unresolved-catalog-reference-state
  if(currentIntentAmbiguity?.kind==='ambiguous_catalog_reference'){
    intentDecision.state=salesMergeState(lead?.state||{},{});
    intentDecision.evidence={mode:salesModeFor(lead?.state||{}),id:''};
  }
${referenceIntentAnchor}`);
  const sellerClosureAnchor='  const s=generated.state;\n  if (!generated.product && s.product_id) {';
  const sellerClosureCode=`  const sellerClosure=tenantSlug==='wesley_automoveis'&&salesSemanticSellerConcluded(currentTurnText,lead?.state||{});
  if(sellerClosure){
    const keepBuying=['buy','buy_and_sell'].includes(salesModeFor(lead?.state||{}))
      ||['purchase','inventory_search'].includes(generated.semantic_intent?.primary_intent);
    salesClearSellSide(generated.state);
    generated.state.trade_in=null;
    generated.state.transaction_mode=keepBuying?'buy':'unknown';
    generated.state.intent=keepBuying?'buy':'unknown';
    generated.state.intent_evidence_id=turn.messages.at(-1)?.event_id||'';
    generated.action='reply';generated.reason='none';
    generated.reply=keepBuying
      ?(generated.state.product_id?'Entendi, você já vendeu seu veículo. Podemos continuar com a compra que estava considerando.'
        :'Entendi, você já vendeu seu veículo. Vamos focar na compra. Qual modelo você procura?')
      :'Entendi, você já vendeu o veículo. Não vou mais pedir informações para avaliação. Se precisar de outra coisa, estou por aqui.';
  }
`;
  const existingClosureStart=code.indexOf('  const sellerClosure=');
  const existingClosureEnd=code.indexOf(sellerClosureAnchor,existingClosureStart);
  if(existingClosureStart>=0&&existingClosureEnd>existingClosureStart)
    code=code.slice(0,existingClosureStart)+sellerClosureCode+code.slice(existingClosureEnd);
  else if(code.includes(sellerClosureAnchor))code=code.replace(sellerClosureAnchor,sellerClosureCode+sellerClosureAnchor);
  const sellerClosureBranch='  } else if (currentIntentAmbiguity) {';
  const sellerClosureReply=`  } else if (sellerClosure) {
    stage=cfg.stage_keys.qualifying;register=false;
    pendingRequirement=mode==='buy'&&!s.product_id?'buy_model':'';
    followUpDisposition=mode==='buy'&&!s.product_id?'awaiting_customer':'resolved';optionalHumanOffer=null;
    reply=generated.reply;
    event.raw_payload={...(event.raw_payload||{}),seller_flow_closed:true};
`;
  const existingReplyStart=code.indexOf('  } else if (sellerClosure) {');
  const existingReplyEnd=code.indexOf(sellerClosureBranch,existingReplyStart);
  if(existingReplyStart>=0&&existingReplyEnd>existingReplyStart)
    code=code.slice(0,existingReplyStart)+sellerClosureReply+code.slice(existingReplyEnd);
  else if(code.includes(sellerClosureBranch))code=code.replace(sellerClosureBranch,sellerClosureReply+sellerClosureBranch);
  code=code.replace("  const semanticCatalogChoice=salesSemanticCatalogChoice(generated.semantic_intent,history,inventory);","  const semanticCatalogChoice=tenantSlug==='wesley_automoveis'?salesSemanticCatalogChoice(generated.semantic_intent,history,inventory):null;");
  code=code.replace(": (generated.semantic_intent?.valid\n      ?(semanticCatalogChoice||{product:null,invalid:false,ambiguous:false,candidates:[],contextual:false})",": (tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid\n      ?(semanticCatalogChoice||{product:null,invalid:false,ambiguous:false,candidates:[],contextual:false})");
  code=code.replace("const catalogRequested=naturalPlan?.semantic_intent?.valid?naturalPlan.semantic_intent.catalog.requested===true:(explicitCatalogRequest||(generated.action==='catalog'&&!catalogActionBlocked));","const catalogRequested=tenantSlug==='wesley_automoveis'&&naturalPlan?.semantic_intent?.valid?naturalPlan.semantic_intent.catalog.requested===true:(naturalPlan?naturalPlan.catalog_list_requested===true:(explicitCatalogRequest||(generated.action==='catalog'&&!catalogActionBlocked)));" );
  const catalogItemOld="  return inventory.slice(0,8).map(row=>({id:row.id,label:salesCatalogLabel(row),price_cents:salesPriceKnown(row)?row.price_cents:null,\n    status:row.status,availability_verified:row.availability_verified}));";
  if(code.includes(catalogItemOld))code=code.replace(catalogItemOld,"  return inventory.slice(0,8).map(row=>({id:row.id,label:salesCatalogLabel(row),price_cents:salesPriceKnown(row)?row.price_cents:null,\n    status:row.status,offerable:salesSemanticProductEligibility(row).eligible,availability_verified:row.availability_verified}));" );
  const inventoryReferenceOld="  const currentInventoryReference=salesResolveInventoryReference(turnText,inventory);\n  const currentProductSelected=!!generated.product&&!ownVehicleOffer\n    &&['buy','buy_and_sell'].includes(mode)\n    &&(currentInventoryReference.product?.id===generated.product.id||catalogChoice.product?.id===generated.product.id);";
  if(code.includes(inventoryReferenceOld))code=code.replace(inventoryReferenceOld,`  const currentInventoryReference=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    ?{product:null,candidates:[],semantic:true}:salesResolveInventoryReference(turnText,inventory);
  const currentProductSelected=!!generated.product&&!ownVehicleOffer
    &&['buy','buy_and_sell'].includes(mode)
    &&(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
      ?catalogChoice.product?.id===generated.product.id
      :(currentInventoryReference.product?.id===generated.product.id||catalogChoice.product?.id===generated.product.id));`);
  const contextualTurnOld="    ||(!!generated.product&&!ownVehicleOffer&&['buy','buy_and_sell'].includes(mode)&&salesContextualProductQuestion(turnText));";
  if(code.includes(contextualTurnOld))code=code.replace(contextualTurnOld,"    ||(!!generated.product&&!ownVehicleOffer&&['buy','buy_and_sell'].includes(mode)\n      &&(tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid\n        ?['product_details','price_question'].includes(generated.semantic_intent.primary_intent)\n        :salesContextualProductQuestion(turnText)));");
  const eligibleChoiceOld="  if (catalogChoice.product && !(intentDecision.evidence?.correction && intentDecision.evidence?.mode==='sell')) {";
  if(code.includes(eligibleChoiceOld))code=code.replace(eligibleChoiceOld,"  if (catalogChoice.product && catalogChoice.commercial_eligible!==false && !(intentDecision.evidence?.correction && intentDecision.evidence?.mode==='sell')) {");
  const planChoiceOld="  if(naturalPlan?.purchase_product_id){\n    const selected=inventory.find(p=>p.id===naturalPlan.purchase_product_id);\n    if(selected)catalogChoice={product:selected,invalid:false,ambiguous:false,candidates:[],contextual:true};\n  }";
  if(code.includes(planChoiceOld))code=code.replace(planChoiceOld,`  if(naturalPlan?.purchase_product_id){
    const selected=inventory.find(p=>p.id===naturalPlan.purchase_product_id);
    if(selected){const eligibility=salesSemanticProductEligibility(selected);catalogChoice={product:selected,invalid:false,ambiguous:false,candidates:[],contextual:true,
      commercial_eligible:eligibility.eligible,ineligible_reason:eligibility.reason,availability_confirmed:eligibility.availability_confirmed};}
  }`);
  const ambiguousBranch="  } else if (catalogChoice.ambiguous) {";
  if(code.includes(ambiguousBranch)&&!code.includes('semantic_product_unavailable'))code=code.replace(ambiguousBranch,`  } else if (catalogChoice.ambiguous) {`);
  const contextualBranch="  } else if (contextualCatalogQuestion) {";
  if(code.includes(contextualBranch)&&!code.includes('semantic_product_unavailable'))code=code.replace(contextualBranch,`  } else if (catalogChoice.product&&catalogChoice.commercial_eligible===false) {
    const unavailableProduct=catalogChoice.product;
    stage=cfg.stage_keys.qualifying;register=false;pendingRequirement='';followUpDisposition='awaiting_customer';optionalHumanOffer=null;
    reply=catalogChoice.ineligible_reason==='sold'
      ?'Esse veÃ­culo jÃ¡ foi vendido. Posso mostrar as opÃ§Ãµes atuais dentro do que vocÃª procura?'
      :'Esse veÃ­culo nÃ£o estÃ¡ elegÃ­vel para avanÃ§ar na negociaÃ§Ã£o agora. Posso mostrar as opÃ§Ãµes atuais?';
    if(generated.product?.id===unavailableProduct.id)generated.product=null;
    if(s.product_id===unavailableProduct.id){s.product_id='';s.product_evidence='';s.product_variant_evidence='';
      if(s.buy_interest?.product_id===unavailableProduct.id)s.buy_interest={...s.buy_interest,product_id:'',evidence_ids:[]};}
    generated.action='reply';
    event.raw_payload={...(event.raw_payload||{}),semantic_product_unavailable:{product_id:unavailableProduct.id,status:unavailableProduct.status||'',reason:catalogChoice.ineligible_reason||'not_offerable'}};
  } else if (contextualCatalogQuestion) {`);
  const freshGuard="      if (!fresh || fresh.price_cents!==generated.product.price_cents) throw new Error('PRODUCT_CHANGED');";
  const freshEligibilityGuard="      if(tenantSlug==='wesley_automoveis'&&!salesSemanticProductEligibility(fresh).eligible)throw new Error('PRODUCT_UNAVAILABLE');";
  if(code.includes(freshGuard)&&!code.includes(freshEligibilityGuard))code=code.replace(freshGuard,`${freshGuard}
${freshEligibilityGuard}`);
  while(code.includes(freshEligibilityGuard+'\n'+freshEligibilityGuard))code=code.replace(freshEligibilityGuard+'\n'+freshEligibilityGuard,freshEligibilityGuard);
  const freshCatch="    } catch {\n      register=false;stage=cfg.stage_keys.qualifying;\n      event.ai_error='PRODUCT_CHANGED';";
  if(code.includes(freshCatch))code=code.replace(freshCatch,`    } catch (productError) {
      register=false;stage=cfg.stage_keys.qualifying;
      event.ai_error=productError?.message==='PRODUCT_UNAVAILABLE'?'PRODUCT_UNAVAILABLE':'PRODUCT_CHANGED';`);
  const persistAnchor="  Object.assign(event,{ai_provider:'sales_core'";
  if(code.includes(persistAnchor)&&!code.includes('catalog-presentation-proof-v1'))code=code.replace(persistAnchor,`  // catalog-presentation-proof-v1: this metadata is copied into the outbound
  // event only after the provider accepts the exact final text.
  catalogPresented=tenantSlug==='wesley_automoveis'&&catalogRequested
    &&salesCatalogPresentationProof(reply,catalogItems);
  Object.assign(event,{ai_provider:'sales_core'`);
  const adapterOld="    if (Array.isArray(items)) return commercialResult(operation, 'ok', {items,count:items.length});";
  if(code.includes(adapterOld))code=code.replace(adapterOld,"    if (Array.isArray(items)) return commercialResult(operation, 'ok', payload.semantic_catalog?salesApplySemanticCatalogConstraints(items,payload.semantic_catalog):{items,count:items.length,applied:[],unsupported:[],requires_clarification:false});");
  return code;
}

const semanticRuntime = String.raw`
function salesSemanticIntentSchema(){
  const str={type:'STRING'},list={type:'ARRAY',items:str};
  return {type:'OBJECT',properties:{
    primary_intent:{type:'STRING',enum:['inventory_search','purchase','sale','buy_and_sell','trade_in','financing','price_question','product_details','after_sales','human_handoff','other','ambiguous']},
    secondary_intents:{type:'ARRAY',items:{type:'STRING',enum:['inventory_search','purchase','sale','buy_and_sell','trade_in','financing','price_question','product_details','after_sales','human_handoff','other']}},
    topics:list,
    catalog:{type:'OBJECT',properties:{requested:{type:'BOOLEAN'},category:{type:'STRING',enum:['all','cars','motorcycles','unspecified']},price_min_cents:{type:'INTEGER',nullable:true},price_max_cents:{type:'INTEGER',nullable:true},preferences:list,exclusions:list,evidence_ids:list},required:['requested','category','price_min_cents','price_max_cents','preferences','exclusions','evidence_ids']},
    references:{type:'OBJECT',properties:{previous_catalog:{type:'BOOLEAN'},selected_ordinal:{type:'INTEGER',nullable:true},mentioned_product_ids:list,evidence_ids:list},required:['previous_catalog','selected_ordinal','mentioned_product_ids','evidence_ids']},
    conversation:{type:'OBJECT',properties:{continues_previous_topic:{type:'BOOLEAN'},changes_preference:{type:'BOOLEAN'},requires_clarification:{type:'BOOLEAN'}},required:['continues_previous_topic','changes_preference','requires_clarification']},
    ambiguities:list,confidence:{type:'STRING',enum:['low','medium','high']}},
    required:['primary_intent','secondary_intents','topics','catalog','references','conversation','ambiguities','confidence']};
}
function salesSemanticFallback(errors=['SEMANTIC_INTENT_UNAVAILABLE']){return {valid:false,validation_errors:[...new Set(errors)],primary_intent:'other',secondary_intents:[],topics:[],catalog:{requested:false,category:'unspecified',price_min_cents:null,price_max_cents:null,preferences:[],exclusions:[],evidence_ids:[]},references:{previous_catalog:false,selected_ordinal:null,mentioned_product_ids:[],evidence_ids:[]},conversation:{continues_previous_topic:false,changes_preference:false,requires_clarification:true},ambiguities:['semantic_intent_unavailable'],confidence:'low'};}
function salesValidateSemanticIntent(value,inventory=[],sessionEvidenceIds=[]){
  if(!value||typeof value!=='object'||Array.isArray(value))return salesSemanticFallback(['INVALID_SEMANTIC_INTENT_OBJECT']);
  const allowed=new Set(['inventory_search','purchase','sale','buy_and_sell','trade_in','financing','price_question','product_details','after_sales','human_handoff','other','ambiguous']);
  const category=new Set(['all','cars','motorcycles','unspecified']);
  const primary=allowed.has(value.primary_intent)?value.primary_intent:null;
  const catalog=value.catalog,refs=value.references,conversation=value.conversation,errors=[];
  if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))errors.push('MISSING_OR_INVALID_CATALOG');
  if(!refs||typeof refs!=='object'||Array.isArray(refs))errors.push('MISSING_OR_INVALID_REFERENCES');
  if(!conversation||typeof conversation!=='object'||Array.isArray(conversation))errors.push('MISSING_OR_INVALID_CONVERSATION');
  if(errors.length)return salesSemanticFallback(errors);
  const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  const required=(obj,keys,prefix)=>keys.forEach(key=>{if(!has(obj,key))errors.push('MISSING_'+prefix+'_'+key.toUpperCase());});
  required(catalog,['requested','category','price_min_cents','price_max_cents','preferences','exclusions','evidence_ids'],'CATALOG');
  required(refs,['previous_catalog','selected_ordinal','mentioned_product_ids','evidence_ids'],'REFERENCE');
  required(conversation,['continues_previous_topic','changes_preference','requires_clarification'],'CONVERSATION');
  if(!primary)errors.push('INVALID_PRIMARY_INTENT');
  if(typeof catalog.requested!=='boolean')errors.push('INVALID_CATALOG_REQUESTED');
  if(!category.has(catalog.category))errors.push('INVALID_CATALOG_CATEGORY');
  const nullableNonNegativeInteger=(obj,key,label)=>{
    if(!has(obj,key))return null;
    const n=obj[key];
    if(n===null)return null;
    if(!Number.isSafeInteger(n)||n<0){errors.push('INVALID_'+label);return null;}
    return n;
  };
  const min=nullableNonNegativeInteger(catalog,'price_min_cents','PRICE_MIN_CENTS');
  const max=nullableNonNegativeInteger(catalog,'price_max_cents','PRICE_MAX_CENTS');
  let ordinal=null;
  if(has(refs,'selected_ordinal')){
    if(refs.selected_ordinal===null)ordinal=null;
    else if(Number.isInteger(refs.selected_ordinal)&&refs.selected_ordinal>0&&refs.selected_ordinal<=200)ordinal=refs.selected_ordinal;
    else errors.push('INVALID_SELECTED_ORDINAL');
  }
  if(min!==null&&max!==null&&min>max)errors.push('CONTRADICTORY_PRICE_RANGE');
  const strings=(input,label)=>{
    if(!Array.isArray(input)){errors.push('INVALID_'+label);return [];}
    if(input.some(item=>typeof item!=='string'||!item.trim()||item.length>160))errors.push('INVALID_'+label+'_ITEM');
    return [...new Set(input.filter(item=>typeof item==='string'&&item.trim()&&item.length<=160).map(item=>item.trim()))].slice(0,20);
  };
  const catalogEvidence=strings(catalog.evidence_ids,'CATALOG_EVIDENCE_IDS');
  const referenceEvidence=strings(refs.evidence_ids,'REFERENCE_EVIDENCE_IDS');
  const allowedEvidence=new Set((sessionEvidenceIds||[]).map(String));
  if(catalogEvidence.some(id=>!allowedEvidence.has(id)))errors.push('UNSCOPED_CATALOG_EVIDENCE');
  if(referenceEvidence.some(id=>!allowedEvidence.has(id)))errors.push('UNSCOPED_REFERENCE_EVIDENCE');
  const hasCatalogMeaning=catalog.requested===true||catalog.category!=='unspecified'||min!==null||max!==null
    ||(Array.isArray(catalog.preferences)&&catalog.preferences.length)||(Array.isArray(catalog.exclusions)&&catalog.exclusions.length);
  if(hasCatalogMeaning&&!catalogEvidence.length)errors.push('MISSING_CATALOG_EVIDENCE');
  const ids=new Set((inventory||[]).map(item=>String(item?.id||'')).filter(Boolean));
  const rawMentioned=strings(refs.mentioned_product_ids,'MENTIONED_PRODUCT_IDS');
  const mentioned=rawMentioned.filter(id=>ids.has(id));
  if(mentioned.length!==rawMentioned.length)errors.push('UNKNOWN_PRODUCT_REFERENCE');
  if((ordinal!==null||mentioned.length||refs.previous_catalog===true)&&!referenceEvidence.length)errors.push('MISSING_REFERENCE_EVIDENCE');
  if(typeof refs.previous_catalog!=='boolean')errors.push('INVALID_PREVIOUS_CATALOG');
  for(const key of ['continues_previous_topic','changes_preference','requires_clarification'])if(typeof conversation[key]!=='boolean')errors.push('INVALID_CONVERSATION_'+key.toUpperCase());
  const secondary=strings(value.secondary_intents,'SECONDARY_INTENTS');
  if(secondary.some(item=>!allowed.has(item)))errors.push('INVALID_SECONDARY_INTENT');
  const topics=strings(value.topics,'TOPICS'),preferences=strings(catalog.preferences,'PREFERENCES'),exclusions=strings(catalog.exclusions,'EXCLUSIONS'),ambiguities=strings(value.ambiguities,'AMBIGUITIES');
  if(!['low','medium','high'].includes(value.confidence))errors.push('INVALID_CONFIDENCE');
  if(errors.length)return salesSemanticFallback(errors);
  return {valid:true,primary_intent:primary,secondary_intents:strings(value.secondary_intents).filter(item=>allowed.has(item)&&item!==primary),topics:strings(value.topics),
    catalog:{requested:catalog.requested,category:catalog.category,price_min_cents:min,price_max_cents:max,preferences,exclusions,evidence_ids:catalogEvidence},
    references:{previous_catalog:refs.previous_catalog,selected_ordinal:ordinal,mentioned_product_ids:mentioned,evidence_ids:referenceEvidence},
    conversation:{continues_previous_topic:conversation.continues_previous_topic,changes_preference:conversation.changes_preference,requires_clarification:conversation.requires_clarification},ambiguities,confidence:value.confidence};
}
function salesSemanticRecoverBudget(semantic,messages=[],action='reply'){
  if(!semantic?.valid)return semantic;
  const turns=(messages||[]).filter(item=>typeof item?.text==='string');
  for(const message of turns){
    const text=normalizeText(message.text);
    const match=text.match(/(?:\bnao\s+(?:passa|passe|ultrapasse)\s+de\b|\bate\b|\bno\s+maximo\b|\blimite\s+(?:de|e)\b|\bteto\s+(?:de|e)\b)\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,7})(?:,(\d{1,2}))?(?!\s*(?:km|quilometros|anos)\b)/);
    if(!match)continue;
    const reais=Number(match[1].replace(/\./g,'')),cents=reais*100+Number((match[2]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(cents)||cents<100000||cents>500000000)continue;
    const prior=semantic.catalog.price_max_cents;
    const max=prior===null?cents:Math.min(prior,cents);
    if(semantic.catalog.price_min_cents!==null&&semantic.catalog.price_min_cents>max)continue;
    const id=String(message.event_id||message.id||'');
    if(!id)continue;
    const mislabeledBudget=semantic.primary_intent==='price_question'&&!message.text.includes('?')
      &&semantic.references.selected_ordinal===null&&!semantic.references.mentioned_product_ids.length;
    return {...semantic,primary_intent:mislabeledBudget?'inventory_search':semantic.primary_intent,
      catalog:{...semantic.catalog,price_max_cents:max,
      requested:semantic.catalog.requested||action==='catalog'||mislabeledBudget,
      evidence_ids:[...new Set([...semantic.catalog.evidence_ids,id])]},
    };
  }
  return semantic;
}
function salesSemanticSellerConcluded(text,previous){
  if(!['sell','buy_and_sell'].includes(salesModeFor(previous)))return false;
  const normalized=normalizeText(text);
  return /\b(?:ja\s+vendi|vendi\s+(?:ela|ele|o\s+carro|a\s+moto)|(?:ja\s+)?foi\s+vendid[ao])\b/.test(normalized)
    &&!/\b(?:se\s+eu\s+vender|quando\s+vender|se\s+vender|pretendo\s+vender|quero\s+vender\s+outr[oa]|tenho\s+outr[oa]\s+para\s+vender)\b/.test(normalized);
}
function salesSemanticAmbiguousOtherReference(text,semantic,history,inventory){
  if(!semantic?.valid)return false;
  const normalized=normalizeText(text).trim();
  if(!/^(?:(?:nao|n|negativo)[,\s]+)?(?:e\s+)?(?:o|a|aquele|aquela)\s+outr[oa](?:\s+(?:da\s+lista|de\s+antes))?[.!?\s]*$/.test(normalized))return false;
  if(semantic.references?.selected_ordinal!==null||semantic.references?.mentioned_product_ids?.length===1)return false;
  const recent=salesRecentCatalogContext(history,inventory);
  return Array.isArray(recent?.products)&&recent.products.length>1;
}
function salesSemanticPlanFromPrimary(history,generated,lead,inventory){
  const ids=salesDialogueSessionIds(history),memory=salesDialogueMemory(lead?.state||{},history);
  const plan=salesNaturalDialogue.validatePlan(generated.dialogue_plan,ids,memory);
  plan.memory=salesNaturalDialogue.mergeMemory(memory,plan.memory,ids);
  plan.semantic_intent=salesValidateSemanticIntent(generated.semantic_intent,inventory,ids);
  if(plan.semantic_intent.valid){
    plan.catalog_list_requested=plan.semantic_intent.catalog.requested;
    if(plan.semantic_intent.catalog.category!=='unspecified')plan.memory=salesNaturalDialogue.mergeMemory(plan.memory,{...plan.memory,catalog_audience:plan.semantic_intent.catalog.category,catalog_audience_evidence_ids:plan.semantic_intent.catalog.evidence_ids},ids);
    plan.needs_clarification=plan.semantic_intent.conversation.requires_clarification||plan.semantic_intent.primary_intent==='ambiguous';
    plan.human_requested=plan.semantic_intent.primary_intent==='human_handoff'&&plan.human_requested===true;
    plan.handoff_reason=plan.human_requested?'human_requested':plan.handoff_reason;
  }
  return {...plan,attempts:[{attempt:0,issues:[]}],semantic_source:plan.semantic_intent.valid?'primary_gemini':'local_fallback'};
}
function salesSemanticProductEligibility(product){
  if(!product)return {eligible:false,reason:'not_found',availability_confirmed:false};
  const status=normalizeText(product.status||'');
  const blocked=['sold','vendido','reserved','reservado','unavailable','indisponivel','unverified','nao_verificado'].includes(status);
  const offerable=product.offerable===true||(product.offerable!==false&&['announced','anunciado','listed','disponivel'].includes(status));
  return {eligible:offerable&&!blocked,reason:blocked?(status==='sold'||status==='vendido'?'sold':'not_offerable'):(offerable?'eligible':'not_offerable'),availability_confirmed:product.availability_verified===true};
}
function salesCatalogPresentationProof(reply,items=[]){
  if(!Array.isArray(items)||!items.length||!String(reply||'').trim())return false;
  const ids=new Set(),text=String(reply);let cursor=-1;
  for(let index=0;index<items.length;index++){
    const item=items[index],id=String(item?.id||''),label=String(item?.label||'').trim();
    if(!id||ids.has(id)||!label)return false;ids.add(id);
    const marker=String(index+1)+'. '+label,at=text.indexOf(marker,cursor+1);
    if(at<0)return false;cursor=at+marker.length;
  }
  return true;
}
function salesSemanticCatalogChoice(semantic,history,inventory){
  if(!semantic?.valid)return null;
  const recent=salesRecentCatalogContext(history,inventory),products=Array.isArray(recent?.products)?recent.products:[];
  const ordinal=semantic.references?.selected_ordinal;
  if(ordinal!==null&&ordinal!==undefined){
    const displayed=products[ordinal-1];
    if(!displayed)return {product:null,invalid:products.length>0,ambiguous:false,contextual:true,ordinal};
    const product=(inventory||[]).find(item=>item.id===displayed.id)||null;
    const eligibility=salesSemanticProductEligibility(product);
    return {product,invalid:!product,ambiguous:false,contextual:true,ordinal,resolved_via:'semantic_ordinal',commercial_eligible:eligibility.eligible,ineligible_reason:eligibility.reason,availability_confirmed:eligibility.availability_confirmed};
  }
  if(semantic.references?.mentioned_product_ids?.length===1){
    const product=(inventory||[]).find(item=>item.id===semantic.references.mentioned_product_ids[0])||null;
    const eligibility=salesSemanticProductEligibility(product);
    return {product,invalid:!product,ambiguous:false,contextual:true,resolved_via:'semantic_product_id',commercial_eligible:eligibility.eligible,ineligible_reason:eligibility.reason,availability_confirmed:eligibility.availability_confirmed};
  }
  return null;
}
function salesApplySemanticIntent(previous,state,semantic){
  const merged=salesMergeState(previous||{},state||{});
  if(!semantic?.valid)return {state:merged,evidence:{mode:'unknown',id:''},source:'fallback'};
  const p=semantic.primary_intent,secondary=new Set(semantic.secondary_intents||[]);
  const wantsSale=p==='sale'||p==='buy_and_sell'||secondary.has('sale')||secondary.has('buy_and_sell');
  const wantsBuy=p==='purchase'||p==='inventory_search'||p==='buy_and_sell'||secondary.has('purchase')||secondary.has('inventory_search');
  if(wantsSale&&wantsBuy){merged.intent='buy';merged.transaction_mode='buy_and_sell';}
  else if(wantsSale){merged.intent='sell';merged.transaction_mode='sell';}
  else if(wantsBuy){merged.intent='buy';merged.transaction_mode='buy';}
  else if(p==='after_sales'){merged.intent='after_sales';merged.transaction_mode='after_sales';}
  return {state:merged,evidence:{mode:merged.transaction_mode,id:''},source:'semantic'};
}
function salesApplySemanticCatalogConstraints(items=[],semantic={}){
  let filtered=Array.isArray(items)?items.filter(Boolean):[];
  const applied=[],unsupported=[];
  if(Number.isSafeInteger(semantic.price_min_cents)&&semantic.price_min_cents>=0){filtered=filtered.filter(item=>Number.isSafeInteger(item.price_cents)&&item.price_cents>=semantic.price_min_cents);applied.push({field:'price_min_cents',value:semantic.price_min_cents});}
  if(Number.isSafeInteger(semantic.price_max_cents)&&semantic.price_max_cents>=0){filtered=filtered.filter(item=>Number.isSafeInteger(item.price_cents)&&item.price_cents<=semantic.price_max_cents);applied.push({field:'price_max_cents',value:semantic.price_max_cents});}
  const match=(item,field,raw)=>{
    const value=normalizeText(raw).trim();if(!value)return false;
    if(field==='year_min')return Number.isInteger(Number(raw))&&Number(item.year)>=Number(raw);
    if(field==='year_max')return Number.isInteger(Number(raw))&&Number(item.year)<=Number(raw);
    if(field==='product_id')return String(item.id||'')===String(raw).trim();
    if(!['brand','model','color','fuel'].includes(field))return null;
    return normalizeText(item[field]||'')===value;
  };
  const apply=(values,exclude)=>{for(const raw of Array.isArray(values)?values:[]){const parsed=String(raw||'').match(/^([a-z_]+)=(.+)$/i);if(!parsed){unsupported.push(String(raw));continue;}const field=normalizeText(parsed[1]),value=parsed[2].trim();if(match({},field,value)===null){unsupported.push(String(raw));continue;}filtered=filtered.filter(item=>exclude?!match(item,field,value):match(item,field,value));applied.push({field,value,mode:exclude?'exclude':'include'});}};
  apply(semantic.preferences,false);apply(semantic.exclusions,true);
  return {items:filtered,count:filtered.length,applied,unsupported,requires_clarification:unsupported.length>0};
}
`;

// The EXT owns vehicle facts; the shared CORE only passes a verified, bounded
// view into the existing primary Gemini call and respects the semantic reply.
function applyGenesisContextualAnswers(code) {
  const replaceOnce = (from, to, marker) => {
    if (code.includes(marker)) return;
    if (!code.includes(from)) throw new Error(`Genesis contextual contract insertion point missing: ${marker}`);
    code = code.replace(from, to);
  };
  replaceOnce(
    '  const safeMessages=messages.map(m=>({...m,text:salesRedactPersonalData(m.text)}));',
    `  // genesis-contextual-facts-v1: bind EXT selection to the same authorised
  // inventory projection the model is allowed to read (including price mode).
  const extFacts=tenantSlug==='wesley_automoveis'?context?.noria_business_context?.conversation_facts:null;
  const extProduct=extFacts?.contract==='noria_genesis_conversation_facts_v1'
    &&extFacts.selection_status==='resolved'&&extFacts.selected_product?.id
    ?modelInventory.find(item=>item.id===extFacts.selected_product.id)||null:null;
  const genesisFacts=tenantSlug==='wesley_automoveis'?{
    selection_status:extFacts?.selection_status||'none',
    selection_source:extFacts?.selection_source||'none',
    selected_product:extProduct?{
      id:extProduct.id,name:extProduct.name,brand:extProduct.brand,model:extProduct.model,
      year:extProduct.year,category:extProduct.category,color:extProduct.color||null,
      km:extProduct.km??null,fuel:extProduct.fuel||null,
      observations:extProduct.observations||null,price_cents:extProduct.price_cents??null,
      price_source:extProduct.price_source,status:extProduct.status,
      availability_verified:extProduct.availability_verified===true
    }:null
  }:null;
  const safeMessages=messages.map(m=>({...m,text:salesRedactPersonalData(m.text)}));`,
    'genesis-contextual-facts-v1'
  );
  replaceOnce(
    'official_facts:{business:settings.business_facts,inventory:modelInventory',
    'official_facts:{genesis_context:genesisFacts,business:settings.business_facts,inventory:modelInventory',
    'official_facts:{genesis_context:genesisFacts'
  );
  replaceOnce(
    '"REGRAS DE INTERPRETACAO CONVERSACIONAL",...(tenantSlug',
    `"REGRAS DE INTERPRETACAO CONVERSACIONAL",...(tenantSlug==='wesley_automoveis'?[
      "- A EXT fornece official_facts.genesis_context como referência autorizada do veículo da loja em foco. Interprete TODAS as perguntas atuais sobre quaisquer atributos desse veículo com base nesses dados e no histórico. Valor null ou vazio significa informação ausente, não zero ou confirmação. Responda primeiro ao atributo solicitado, sem trocar a resposta por preço ou repetir a oferta anterior. Se a referência estiver indefinida ou ambígua, esclareça qual veículo antes de atribuir características. Não confunda o carro do cliente com o da loja."
    ]:[]),...(tenantSlug`,
    'A EXT fornece official_facts.genesis_context'
  );
  replaceOnce(
    "  const selectedProductQuestion=tenantSlug==='wesley_automoveis'&&mode==='buy'&&generated.product&&!financingQuestion",
    "  const selectedProductQuestion=tenantSlug==='wesley_automoveis'&&['buy','buy_and_sell'].includes(mode)&&generated.product&&!financingQuestion",
    "selectedProductQuestion=tenantSlug==='wesley_automoveis'&&['buy','buy_and_sell'].includes(mode)"
  );
  replaceOnce(
    "  } else if (contextualCatalogQuestion) {\n    stage = cfg.stage_keys.qualifying;\n    reply = salesContextualProductReply(catalogChoice.product,turnText);",
    `  } else if (contextualCatalogQuestion) {
    stage = cfg.stage_keys.qualifying;
    // genesis-semantic-details-v1: the existing primary model wrote the reply.
    reply = semanticProductDetails&&generated.action==='reply'&&generated.reply?.trim()
      ?generated.reply:salesContextualProductReply(catalogChoice.product,turnText);`,
    'genesis-semantic-details-v1'
  );
  replaceOnce(
    "    reply=continuation?.reply||salesContextualProductReply(generated.product,turnText);",
    "    reply=semanticProductDetails&&generated.action==='reply'&&generated.reply?.trim()\n      ?generated.reply:(continuation?.reply||salesContextualProductReply(generated.product,turnText));",
    "reply=semanticProductDetails&&generated.action==='reply'&&generated.reply?.trim()"
  );
  replaceOnce(
    "  const contextualProductTurn=currentProductSelected||!!selectedProductQuestion||!!continuation||!!financingQuestion",
    `  const semanticProductDetails=tenantSlug==='wesley_automoveis'
    &&generated.semantic_intent?.valid&&generated.semantic_intent.primary_intent==='product_details';
  const contextualProductTurn=currentProductSelected||!!selectedProductQuestion||!!continuation||!!financingQuestion`,
    "const semanticProductDetails=tenantSlug==='wesley_automoveis'"
  );
  replaceOnce(
    '    if(generated.product)reply=generated.reply=salesContextualProductReply(generated.product,turnText);',
    `    // The semantic intent came from the same verified primary Gemini call.
    // Retain its contextual answer even when action=catalog was inconsistent.
    // Pricing, eligibility and availability guards still run after routing.
    if(generated.product&&semanticProductDetails&&generated.reply?.trim())reply=generated.reply;
    else if(generated.product)reply=generated.reply=salesContextualProductReply(generated.product,turnText);`,
    'The semantic intent came from the same verified primary Gemini call'
  );
  replaceOnce(
    "      && generated.action!=='handoff'\n      && ((!/r\\$\\s*\\d/i.test(reply)||catalogActionBlocked||currentProductSelected)",
    "      && generated.action!=='handoff' && !semanticProductDetails\n      && ((!/r\\$\\s*\\d/i.test(reply)||catalogActionBlocked||currentProductSelected)",
    "generated.action!=='handoff' && !semanticProductDetails"
  );
  return code;
}

function applySemanticIntent(code) {
  if (code.includes('// semantic-intent-primary-v1')||code.includes('function salesSemanticIntentSchema(){')) {
    const validatePrimary = '  const checked=salesValidate(result,messages,inventory,context,selectionProofs);';
    const semanticValidation = '  checked.semantic_intent=salesValidateSemanticIntent(result.semantic_intent,inventory,salesDialogueSessionIds(history));';
    const runtimeSource=semanticRuntime+'\nfunction __semanticRuntimeEnd(){}';
    for(const name of ['salesSemanticIntentSchema','salesSemanticFallback','salesValidateSemanticIntent','salesSemanticRecoverBudget','salesSemanticSellerConcluded','salesSemanticAmbiguousOtherReference','salesSemanticPlanFromPrimary','salesSemanticProductEligibility','salesCatalogPresentationProof','salesSemanticCatalogChoice','salesApplySemanticIntent','salesApplySemanticCatalogConstraints']){
      const start=runtimeSource.indexOf(`function ${name}(`),end=runtimeSource.indexOf('\nfunction ',start+10);
      if(start<0||end<0)throw new Error(`Semantic runtime source ${name} missing`);
      const replacement=runtimeSource.slice(start,end);
      if(code.includes(`function ${name}(`))code=replaceFunction(code,name,replacement);
      else {
        const schemaBoundary=code.indexOf('function salesDialogueSalesSchema(){');
        if(schemaBoundary<0)throw new Error(`Semantic runtime insertion boundary ${name} missing`);
        code=code.slice(0,schemaBoundary)+replacement+'\n'+code.slice(schemaBoundary);
      }
    }
    const oldValidation = '  checked.semantic_intent=salesValidateSemanticIntent(result.semantic_intent,inventory);';
    if(code.includes(oldValidation))code=code.replace(oldValidation,semanticValidation);
    else if (!code.includes(semanticValidation) && !code.includes('  const semanticPrecheck=salesValidateSemanticIntent(result.semantic_intent,inventory,salesDialogueSessionIds(history));')) {
      if (!code.includes(validatePrimary)) throw new Error('Existing semantic primary validation insertion point missing');
      code = code.replace(validatePrimary, `${validatePrimary}\n${semanticValidation}`);
    }
    code=code.replace("{ inventory, query: turnText, audience: naturalPlan.semantic_intent?.catalog?.category || naturalPlan.memory.catalog_audience }","{ inventory, query: turnText, audience: naturalPlan.semantic_intent?.catalog?.category || naturalPlan.memory.catalog_audience, semantic_catalog: naturalPlan.semantic_intent?.catalog }");
    code=code.replace(": (semanticCatalogChoice||salesCatalogChoice(history,turn.messages,inventory));",": (generated.semantic_intent?.valid\n      ?(semanticCatalogChoice||{product:null,invalid:false,ambiguous:false,candidates:[],contextual:false})\n      :salesCatalogChoice(history,turn.messages,inventory));");
    const evidenceInstruction='Preencha semantic_intent a partir do significado e do histórico, nunca por palavras-chave.';
    if(!code.includes(evidenceInstruction)){
      const promptNeedle='- Preencha dialogue_plan: requests deve conter TODOS os pedidos atuais',promptIndex=code.indexOf(promptNeedle),promptEnd=code.indexOf('\",',promptIndex);
      if(promptIndex<0||promptEnd<0)throw new Error('Existing semantic evidence prompt insertion point missing');
      code=code.slice(0,promptEnd)+' '+evidenceInstruction+' catalog.evidence_ids deve citar IDs inbound reais que sustentam categoria, orçamento, preferências ou exclusões; references.evidence_ids deve citar IDs reais que sustentam ordinal ou produto. Use null somente nos campos nullable quando a informação estiver ausente. Não invente IDs nem atributos de veículos.'+code.slice(promptEnd);
    }
    return applyGenesisContextualAnswers(applySemanticExecutionContract(code));
  }
  const schemaStart = code.indexOf('function salesDialogueSalesSchema(){');
  const schemaEnd = code.indexOf('\nfunction salesDialogueFactLedger', schemaStart);
  if (schemaStart < 0 || schemaEnd < 0) throw new Error('Dialogue schema boundary missing');
  const schema = String.raw`function salesDialogueSalesSchema(){
  const schema=salesSchema(),str={type:'STRING'};
  schema.properties.dialogue_plan={type:'OBJECT',properties:{
    requests:{type:'ARRAY',items:{type:'OBJECT',properties:{id:str,topic:str},required:['id','topic']}},
    next_requirement:{type:'STRING',enum:['none','customer_name','deposit','documents','purchase_product','sell_model','buy_model','vehicle_photo','vehicle_description','trade_in_confirmation','buy_and_sell_models']},
    memory:{type:'OBJECT',properties:{trade_in_status:{type:'STRING',enum:['none','policy_discussed','offered','declined']},evidence_ids:{type:'ARRAY',items:str},vehicle_kind:{type:'STRING',enum:['unknown','car','motorcycle','other']},vehicle_kind_evidence_ids:{type:'ARRAY',items:str}},required:['trade_in_status','evidence_ids','vehicle_kind','vehicle_kind_evidence_ids']},
    human_requested:{type:'BOOLEAN'},handoff_reason:{type:'STRING',enum:['none','human_requested','appraisal_review']}},
    required:['requests','next_requirement','memory','human_requested','handoff_reason']};
  schema.properties.semantic_intent=salesSemanticIntentSchema();
  schema.required=[...schema.required,'dialogue_plan','semantic_intent'];return schema;
}`;
  code = code.slice(0, schemaStart) + semanticRuntime + '\n// semantic-intent-primary-v1\n' + schema + code.slice(schemaEnd);
  const validatePrimary = '  const checked=salesValidate(result,messages,inventory,context,selectionProofs);';
  if (!code.includes(validatePrimary)) throw new Error('Primary semantic validation insertion point missing');
  code = code.replace(validatePrimary, `${validatePrimary}\n  checked.semantic_intent=salesValidateSemanticIntent(result.semantic_intent,inventory,salesDialogueSessionIds(history));`);
  code = replaceFunction(code, 'salesPlanNaturalDialogue', String.raw`function salesPlanNaturalDialogue(context,history,generated,lead,inventory,documentStatus){
  // The primary Gemini structured response is the only semantic inference.
  // Validation below is local; no audit, repair or rewrite model call is made.
  return salesSemanticPlanFromPrimary(history,generated,lead,inventory);
}`);
  const oldPlan = "naturalPlan=await salesPlanNaturalDialogue(context,history,generated,lead,inventory,documentStatus);";
  if (!code.includes(oldPlan)) throw new Error('Primary semantic plan call missing');
  // Retain the local function call for a narrow try/catch recovery envelope.
  const catalogOld = "const catalogRequested=naturalPlan?naturalPlan.catalog_list_requested===true:(explicitCatalogRequest||(generated.action==='catalog'&&!catalogActionBlocked));";
  const catalogNew = "const catalogRequested=tenantSlug==='wesley_automoveis'&&naturalPlan?.semantic_intent?.valid?naturalPlan.semantic_intent.catalog.requested===true:(naturalPlan?naturalPlan.catalog_list_requested===true:(explicitCatalogRequest||(generated.action==='catalog'&&!catalogActionBlocked)));";
  if (!code.includes(catalogOld)) throw new Error('Catalog semantic decision insertion point missing');
  code = code.replace(catalogOld, catalogNew);
  const filterOld = "{ inventory, query: turnText, audience: naturalPlan.memory.catalog_audience }";
  const filterNew = "{ inventory, query: turnText, audience: naturalPlan.semantic_intent?.catalog?.category || naturalPlan.memory.catalog_audience, semantic_catalog: naturalPlan.semantic_intent?.catalog }";
  if (!code.includes(filterOld)) throw new Error('Catalog semantic filter insertion point missing');
  code = code.replace(filterOld, filterNew);
  const choiceOld = '  let catalogChoice=ownVehicleOffer && !salesExplicitCatalogBuy(currentTurnText)\n    ? {product:null,invalid:false,ambiguous:false,candidates:[],contextual:false}\n    : salesCatalogChoice(history,turn.messages,inventory);';
  const choiceNew = String.raw`  const semanticCatalogChoice=tenantSlug==='wesley_automoveis'?salesSemanticCatalogChoice(generated.semantic_intent,history,inventory):null;
  let catalogChoice=ownVehicleOffer && !salesExplicitCatalogBuy(currentTurnText)
    ? {product:null,invalid:false,ambiguous:false,candidates:[],contextual:false}
    : (tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
      ?(semanticCatalogChoice||{product:null,invalid:false,ambiguous:false,candidates:[],contextual:false})
      :salesCatalogChoice(history,turn.messages,inventory));
  if(!semanticCatalogChoice&&tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    &&(generated.semantic_intent.references?.selected_ordinal!==null||generated.semantic_intent.references?.mentioned_product_ids?.length))
    event.raw_payload={...(event.raw_payload||{}),semantic_fallback:{reason:'selection_not_structured',mode:'deterministic_legacy'}};`;
  if (!code.includes(choiceOld)) throw new Error('Semantic selection insertion point missing');
  code = code.replace(choiceOld, choiceNew);
  const intentOld = '  const intentDecision=salesApplyIntentEvidence(lead?.state||{},currentIntentAmbiguity?salesMergeState(lead?.state||{},{}):(generated.state||{}),history,turn.messages);';
  const intentNew = String.raw`  const intentDecision=tenantSlug==='wesley_automoveis'&&generated.semantic_intent?.valid
    ?salesApplySemanticIntent(lead?.state||{},currentIntentAmbiguity?salesMergeState(lead?.state||{},{}):(generated.state||{}),generated.semantic_intent)
    :salesApplyIntentEvidence(lead?.state||{},currentIntentAmbiguity?salesMergeState(lead?.state||{},{}):(generated.state||{}),history,turn.messages);
  if(tenantSlug==='wesley_automoveis'&&!generated.semantic_intent?.valid)event.raw_payload={...(event.raw_payload||{}),semantic_fallback:{reason:'invalid_or_missing_semantic_intent',mode:'deterministic_legacy',validation_errors:generated.semantic_intent?.validation_errors||[]}};`;
  if (!code.includes(intentOld)) throw new Error('Semantic intent state insertion point missing');
  code = code.replace(intentOld, intentNew);
  const promptNeedle = '- Preencha dialogue_plan: requests deve conter TODOS os pedidos atuais';
  const promptIndex = code.indexOf(promptNeedle);
  if (promptIndex < 0) throw new Error('Semantic evidence prompt insertion point missing');
  const promptEnd = code.indexOf('",', promptIndex);
  if (promptEnd < 0) throw new Error('Semantic evidence prompt boundary missing');
  code = code.slice(0,promptEnd)+ ' Preencha semantic_intent a partir do significado e do histórico, nunca por palavras-chave. catalog.evidence_ids deve citar IDs inbound reais que sustentam categoria, orçamento, preferências ou exclusões; references.evidence_ids deve citar IDs reais que sustentam ordinal ou produto. Quando uma preferência ou exclusão for verificável no estoque, use somente field=value com field brand, model, color, fuel, year_min, year_max ou product_id. Mantenha preferências subjetivas em texto livre para que o executor peça esclarecimento, sem inventar atributos. Use null somente nos campos nullable quando a informação estiver ausente. Não invente IDs nem atributos de veículos.' + code.slice(promptEnd);
  const composeNeedle = 'if(naturalPlan&&!auctionIntent&&!isSelectedTurnProduct&&!generated.technical_error&&!generated.media_notice&&!(simpleAcknowledgement&&followUpDisposition===\'resolved\')){';
  if (!code.includes(composeNeedle)) throw new Error('Second dialogue writer insertion point missing');
  code = code.replace(composeNeedle, "if(false&&naturalPlan&&!auctionIntent&&!isSelectedTurnProduct&&!generated.technical_error&&!generated.media_notice&&!(simpleAcknowledgement&&followUpDisposition==='resolved')){");
  return applyGenesisContextualAnswers(applySemanticExecutionContract(code));
}

module.exports = { applySemanticIntent };
