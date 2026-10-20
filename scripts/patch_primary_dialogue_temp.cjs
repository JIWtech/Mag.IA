const fs=require('fs');const p='C:/Noria_Plataform/n8n/sources/noria_core.js';let s=fs.readFileSync(p,'utf8');
function rep(a,b){if(!s.includes(a))throw Error('missing '+a.slice(0,80));s=s.replace(a,b);}
rep("  const simpleGreeting=isPureGreeting", "  const simpleGreeting=tenantSlug!=='wesley_automoveis' && isPureGreeting");
rep("  } else if (genesisPhotoDeferral) {", "  } else if (tenantSlug!=='wesley_automoveis' && genesisPhotoDeferral) {");
rep("generated=directCatalogAnswer\n", "generated=tenantSlug!=='wesley_automoveis' && directCatalogAnswer\n");
rep("&&!genesisPhotoDeferral&&!deterministicSimpleReply", "&&!deterministicSimpleReply");
rep("  const primaryDialogueReply = typeof generated.reply === 'string' ? generated.reply.trim() : '';", "  const primaryDialogueReply = typeof generated.primary_reply === 'string' ? generated.primary_reply.trim() : (tenantSlug!=='wesley_automoveis' ? String(generated.reply||'').trim() : '');");
rep("  return {...checked,usage:body.usageMetadata||{},model};", "  return {...checked,primary_reply:result.reply,response_contract:result.response_contract,primary_facts:primaryFacts.facts,usage:body.usageMetadata||{},model};");
rep("  markUsage();\n  const body=await httpJson('POST','https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',", "  const primaryFacts=salesDialogueFactLedger(context,lead?.product||null,lead?.state||{},documentStatus,{},[],inventory);\n  markUsage();\n  const body=await httpJson('POST','https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',");
rep("      official_facts:{financing_collection:","      fact_ledger:primaryFacts.facts,\n      official_facts:{financing_collection:");
rep('      "- Combustível e câmbio', '      "- response_contract valida sua resposta sem outra chamada: answers contém request_id (request_1, request_2, na ordem de dialogue_plan.requests) e excerpt literal da resposta para cada pedido. requested_fields contém field e excerpt literal da pergunta de coleta; use customer_name, cnh, birth_date, cpf, deposit ou product. facts contém fact_id, value e excerpt literal para cada afirmação factual, usando fact_ledger; não omita afirmações. availability_asserted só true ao afirmar disponibilidade do veículo. assignment_confirmed e photo_sent só true se a execução já foi confirmada nos fatos, nunca por intenção futura. A primeira resposta ainda não tem confirmação de execução; descreva encaminhamento futuro, sem afirmar já realizado. Perguntas condicionais sobre disponibilidade e disponibilidade de pagamento não são afirmação de estoque.",\n      "- Combustível e câmbio');
rep("  schema.properties.semantic_intent=salesSemanticIntentSchema();\n  schema.required=",`  schema.properties.response_contract={type:'OBJECT',properties:{
    answers:{type:'ARRAY',items:{type:'OBJECT',properties:{request_id:str,excerpt:str},required:['request_id','excerpt']}},
    requested_fields:{type:'ARRAY',items:{type:'OBJECT',properties:{field:str,excerpt:str},required:['field','excerpt']}},
    facts:{type:'ARRAY',items:{type:'OBJECT',properties:{fact_id:str,value:str,excerpt:str},required:['fact_id','value','excerpt']}},
    availability_asserted:{type:'BOOLEAN'},assignment_confirmed:{type:'BOOLEAN'},photo_sent:{type:'BOOLEAN'}},
    required:['answers','requested_fields','facts','availability_asserted','assignment_confirmed','photo_sent']};
  schema.required.push('response_contract');
  schema.properties.semantic_intent=salesSemanticIntentSchema();
  schema.required=`);
// Preserve this block for non-Genesis callers/tests, but Genesis final output is now validated.
rep("      && !tradeInOffer && !register && generated.action==='reply' && !event.ai_error) {", "      && !tradeInOffer && !register && generated.action==='reply' && !event.ai_error\n      && !(typeof depositValidation!=='undefined' && depositValidation)\n      && !(typeof inventoryUnavailable!=='undefined' && inventoryUnavailable)) {");
rep("  if (generated.product\n      && generated.product.availability_verified", "  if (generated.product\n      && tenantSlug!=='wesley_automoveis'\n      && generated.product.availability_verified");
rep("    await cancelPendingFollowUps(context,handoffReason==='trade_in_review'?'trade_in_handoff':'financing_handoff');", "    if(confirmed) await cancelPendingFollowUps(context,handoffReason==='trade_in_review'?'trade_in_handoff':'financing_handoff');");
const start=s.indexOf('    // genesis-auction-compose-guard-v1');const end=s.indexOf('    if(generated.technical_error && assignmentConfirmed',start);
if(start<0||end<0)throw Error('compose');
s=s.slice(0,start)+`    // One primary provider call. Validate its answer against actual execution and required collection.
    if(!generated.technical_error && !naturalPlanError && !afterSales) {
      const audit=salesValidatePrimaryDialogue(generated,naturalPlan,financingCollection,{
        assigned:assignmentConfirmed,photo_sent:false,product:generated.product,
        deposit_invalid:!!depositValidation,inventory_unavailable:inventoryUnavailable,
        error:event.ai_error||null,pending_requirement:pendingRequirement||'none'});
      event.raw_payload={...(event.raw_payload||{}),dialogue_audit:audit};
      if(audit.status==='accepted') reply=primaryDialogueReply;
      else {event.ai_error='DIALOGUE_REVIEW_REQUIRED';reply='';catalogPhotoToSend=null;followUpDisposition='technical_failure';}
    } else if(naturalPlanError){event.ai_error=naturalPlanError;reply='';catalogPhotoToSend=null;}
`+s.slice(end);
rep("  // catalog-presentation-proof-v1:", "  // Post-sales is intentionally silent, including assignment failure/recovery.\n  if(tenantSlug==='wesley_automoveis' && afterSales){reply='';catalogPhotoToSend=null;}\n  // catalog-presentation-proof-v1:");
s=s.replaceAll("ai_processing_ok:!generated.technical_error&&!naturalPlanError", "ai_processing_ok:!generated.technical_error&&!naturalPlanError&&!event.ai_error");
rep("  const aiProcessingOk=!generated.technical_error&&!naturalPlanError;", "  const aiProcessingOk=!generated.technical_error&&!naturalPlanError&&!event.ai_error;");
fs.writeFileSync(p,s);
