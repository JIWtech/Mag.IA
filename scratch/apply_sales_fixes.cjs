const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../n8n/code/whatsapp_sales.js');
let content = fs.readFileSync(filePath, 'utf8');

// Ensure standard line endings for matching and replacement
const isCRLF = content.includes('\r\n');

// 1. Add helper functions before salesCatalogRequested if not present
const helperFunctions = `
function salesCustomerDisposition(text = '') {
  const norm = normalizeText(text);
  if (!norm) return '';
  const hasInquiry = /[?]/.test(text) || /\\b(?:qual|quanto|valor|pre[cç]o|comprar|vender|aceita|parcela|financ)\\b/.test(norm);
  if (hasInquiry && !/^(?:obrigad[oa]|valeu|ok|beleza)[.!,]?\\s*$/.test(norm)) {
    return '';
  }
  if (/\\b(?:nao\\s+(?:tenho\\s+)?interesse|sem\\s+interesse|nao\\s+quero(?:\\s+mais)?|nao\\s+precisa|deixa\\s+pra\\s+la|nao\\s+vai\\s+dar|desisti(?:do)?)\\b/.test(norm)) {
    return 'declined';
  }
  if (/\\b(?:vou\\s+pensar|qualquer\\s+coisa(?:\\s+eu)?\\s+chamo|depois(?:\\s+eu)?\\s+(?:vejo|chamo|falo)|outro\\s+dia|mais\\s+tarde|vou\\s+ver)\\b/.test(norm)) {
    return 'deferred_by_customer';
  }
  if (/\\b(?:valeu(?:\\s+obrigad[oa])?|obrigad[oa]|era\\s+s[oó]\\s+isso|beleza[,\\s]+obrigad[oa]|ok[,\\s]+valeu|ok[,\\s]+obrigad[oa]|tchau|ate\\s+mais|ate\\s+logo|por\\s+hoje\\s+(?:e|eh)\\s+s[oó]|s[oó]\\s+isso(?:\\s+mesmo)?)\\b/.test(norm)) {
    return 'closed_by_customer';
  }
  return '';
}

function salesLocationIntent(text = '') {
  const norm = normalizeText(text);
  if (!norm) return null;

  if (/\\b(?:ponto\\s+de\\s+refer[eê]ncia|refer[eê]ncia|perto\\s+de\\s+(?:onde|que|algum)|fica\s+perto|e\s+perto|alguma\\s+refer[eê]ncia)\\b/.test(norm)) {
    return 'REFERENCE_REQUEST';
  }

  if (/\\b(?:como\\s+(?:eu\\s+)?cheg(?:o|ar)|como\\s+fa[cç]o\\s+pra\\s+chegar|rua\\s+(?:alta|baixa)|antes\\s+ou\\s+depois|(?:fica\\s+)?do\\s+lado\\s+de\\s+qu[eê]|lado\\s+de\\s+que|sentido)\\b/.test(norm)) {
    return 'DIRECTIONS_REQUEST';
  }

  if (/\\b(?:endere[cç]o|localiza[cç][aã]o|onde\\s+(?:fica|ficam|e|voc|vcs|voces|esta)|aonde\\s+fica|fica\\s+(?:onde|aonde)|a\\s+onde|qual\\s+(?:a\\s+)?rua|qual\\s+(?:o\\s+)?bairro|qual\\s+(?:a\\s+)?cidade|passa\\s+o\\s+endere[cç]o|manda\\s+o\\s+endere[cç]o|manda\\s+a\\s+localiza[cç][aã]o)\\b/.test(norm)) {
    return 'ADDRESS_REQUEST';
  }

  return null;
}

function salesLastOptionalHumanOffer(history = []) {
  const last = salesCurrentSessionHistory(history).filter(row => row.direction === 'outbound').at(-1);
  return last?.raw_payload?.optional_human_offer || null;
}

function salesIsAffirmativeToHumanOffer(text = '') {
  const norm = normalizeText(text);
  if (!norm) return false;
  return /^(?:sim|s|quero|pode|por\\s+favor|com\\s+certeza|ok|beleza|topo)$/.test(norm)
    || /\\b(?:pode\\s+chamar|pode\\s+passar|quero\\s+falar(?:\\s+com\\s+algu[eé]m)?|me\\s+passa\\s+pro\\s+atendente|chama\\s+(?:o\\s+atendente|a\\s+equipe|ele|a[ií])|quero\\s+sim|sim[,\\s]+pode\\s+chamar|sim[,\\s]+por\\s+favor|pode\\s+ser)\\b/.test(norm);
}
`;

if (!content.includes('function salesCustomerDisposition(')) {
  const catalogReqTarget = 'function salesCatalogRequested(text) {';
  if (!content.includes(catalogReqTarget)) throw new Error('salesCatalogRequested not found');
  content = content.replace(catalogReqTarget, helperFunctions.trim() + '\n\n' + catalogReqTarget);
}

// 2. Replace runSalesTurn block starting from `const s=generated.state;`
const targetStartCRLF = '  const s=generated.state;\r\n  const mode=salesModeFor(s);';
const targetStartLF = '  const s=generated.state;\n  const mode=salesModeFor(s);';
const startIdx = content.indexOf(targetStartCRLF) !== -1 ? content.indexOf(targetStartCRLF) : content.indexOf(targetStartLF);
if (startIdx === -1) throw new Error('targetStart not found in runSalesTurn');

const targetEndCRLF = '  await complete(\'done\');return {ok:true,...sent,lead_id:saved.id,handoff:saved.ai_locked};\r\n}';
const targetEndLF = '  await complete(\'done\');return {ok:true,...sent,lead_id:saved.id,handoff:saved.ai_locked};\n}';
const endIdx = content.indexOf(targetEndCRLF) !== -1 ? content.indexOf(targetEndCRLF) + targetEndCRLF.length : content.indexOf(targetEndLF) + targetEndLF.length;
if (endIdx === -1) throw new Error('targetEnd not found in runSalesTurn');

const replacementBlock = `  const s=generated.state;
  const mode=salesModeFor(s);
  let stage=!lead&&mode==='unknown'?cfg.stage_keys.initial:cfg.stage_keys.qualifying,register=false;
  let reply=generated.reply;
  let pendingRequirement='';
  let catalogItems=[];
  let catalogChoiceAcknowledged=false;
  let optionalHumanOffer=null;
  let followUpDisposition='';
  const turnText = (typeof rawText !== 'undefined' && rawText) || turn.messages.map(m=>m.text||'').join(' ');
  const lastHumanOffer = salesLastOptionalHumanOffer(history) || lead?.state?.optional_human_offer;
  const acceptedHumanOffer = !!(lastHumanOffer && turn.messages.some(m => salesIsAffirmativeToHumanOffer(m.text)));
  const customerDisposition = salesCustomerDisposition(turnText);
  const locationIntent = salesLocationIntent(turnText);
  const isLocationRequest = !!(locationIntent || generated.action === 'location' || groundingLocationRequested(turnText));
  const catalogRequested=generated.action==='catalog'||salesCatalogRequested(rawText);
  const afterSales=generated.reason==='after_sales'||mode==='after_sales'
    || /(?:comprei|comprei com voces|carro que comprei).{0,100}(?:defeito|problema|quebrou|parou|garantia)/.test(normalizeText(rawText));

  if (acceptedHumanOffer) {
    stage = cfg.stage_keys.human;
    followUpDisposition = 'resolved';
    optionalHumanOffer = null;
    pendingRequirement = '';
  } else if (customerDisposition) {
    stage = lead?.stage_key || cfg.stage_keys.qualifying;
    pendingRequirement = '';
    followUpDisposition = customerDisposition;
    optionalHumanOffer = null;
    if (customerDisposition === 'closed_by_customer') {
      if (!reply || /[?]/.test(reply)) reply = 'Por nada! Se precisar de mais alguma informação ou quiser conferir nossos veículos disponíveis, estou à disposição.';
    } else if (customerDisposition === 'declined') {
      if (!reply || /[?]/.test(reply)) reply = 'Tudo bem! Se precisar de algo no futuro, estamos à disposição.';
    } else if (customerDisposition === 'deferred_by_customer') {
      if (!reply || /[?]/.test(reply)) reply = 'Combinado! Qualquer dúvida ou quando quiser retomar, estamos à disposição.';
    }
    await cancelPendingFollowUps(context, customerDisposition);
  } else if (isLocationRequest) {
    const allLocations = settings.business_facts?.locations || [];
    const verifiedLocations = allLocations.filter(l => l.verified && l.address);
    const intent = locationIntent || 'ADDRESS_REQUEST';

    if (intent === 'REFERENCE_REQUEST') {
      const locWithRef = verifiedLocations.find(l => l.reference_point || l.reference || l.landmark);
      if (locWithRef) {
        const ref = locWithRef.reference_point || locWithRef.reference || locWithRef.landmark;
        reply = (locWithRef.name ? locWithRef.name + ': ' : '') + ref;
        optionalHumanOffer = null;
      } else {
        reply = 'Não tenho um ponto de referência confirmado aqui. Se quiser, um atendente pode te orientar melhor sobre como chegar.';
        optionalHumanOffer = { reason: 'location_details' };
      }
      pendingRequirement = '';
      followUpDisposition = 'not_applicable';
    } else if (intent === 'DIRECTIONS_REQUEST') {
      const locWithDir = verifiedLocations.find(l => l.directions || l.street_level_detail);
      if (locWithDir) {
        const dir = locWithDir.directions || locWithDir.street_level_detail;
        reply = (locWithDir.name ? locWithDir.name + ': ' : '') + dir;
        optionalHumanOffer = null;
      } else {
        const norm = normalizeText(turnText);
        if (/\\brua\\s+(?:alta|baixa)\\b/.test(norm)) {
          reply = 'Tenho o endereço certinho, mas não tenho essa referência de rua alta/baixa confirmada. Se quiser, um atendente pode te passar esse detalhe.';
        } else {
          reply = 'Não tenho um ponto de referência confirmado aqui. Se quiser, um atendente pode te orientar melhor sobre como chegar.';
        }
        optionalHumanOffer = { reason: 'location_details' };
      }
      pendingRequirement = '';
      followUpDisposition = 'not_applicable';
    } else {
      reply = verifiedLocations.map(l => l.address).join('\\n');
      if (!reply) {
        stage = cfg.stage_keys.human;
        reply = 'Vou chamar a equipe para conferir o endereço.';
      }
      optionalHumanOffer = null;
      pendingRequirement = '';
      followUpDisposition = 'not_applicable';
    }
  } else if (afterSales) {stage=cfg.stage_keys.after_sales;reply='';followUpDisposition='resolved';}
  else if (generated.action==='handoff' && generated.reason!=='appraisal') {
    stage=cfg.stage_keys.human;
    followUpDisposition='resolved';
  } else if (catalogChoice.invalid) {
    reply='Não encontrei essa opção no catálogo. Qual número você quis escolher?';
    pendingRequirement='purchase_product';
  } else if (catalogRequested) {
    catalogItems=salesCatalogItems(inventory);
    const appraisal=['sell','buy_and_sell'].includes(mode)?salesAppraisalDecision(s,history,documents,rules):null;
    const intro=mode==='buy_and_sell'
      ? (appraisal?.ready?'Perfeito, a parte inicial da avaliação do seu veículo já ficou registrada. Estes são os veículos disponíveis:'
        :'Certo, enquanto seguimos com a avaliação do seu veículo, estes são os veículos disponíveis:')
      :'Claro! Hoje temos estas opções:';
    reply=catalogItems.length ? salesCatalogReply(catalogItems,intro)
      : 'Não encontrei veículos listados agora. Vou pedir para a equipe verificar.';
    if (!catalogItems.length) { stage=cfg.stage_keys.human; followUpDisposition='resolved'; }
    else pendingRequirement='purchase_product';
  } else if (['sell','buy_and_sell'].includes(mode) && ((rules.rejected_purchase_brands||[]).map(normalizeText).includes(normalizeText(s.sell_brand))
    || (s.sell_year&&s.sell_year<Number(rules.minimum_purchase_year)))) {
    const buyModel=salesText(s.buy_interest?.model);
    reply=mode==='buy_and_sell'
      ? (buyModel
        ? 'No momento, o veículo que você quer vender não se enquadra nos critérios de compra da loja. Seu interesse em '+buyModel+' continua registrado e a gente pode seguir por ele.'
        : 'No momento, o veículo que você quer vender não se enquadra nos critérios de compra da loja. Mas podemos seguir com a compra: qual modelo de veículo você procura?')
      : 'No momento, esse veículo não se enquadra nos critérios de compra da loja.';
    if (mode==='buy_and_sell'&&!buyModel) pendingRequirement='buy_model';
  } else if (mode==='buy_and_sell') {
    const sellModel=salesText(s.sell_vehicle?.model)||salesText(s.sell_model);
    const buyModel=salesText(s.buy_interest?.model);

    if (!sellModel && !buyModel) {
      pendingRequirement='buy_and_sell_models';
    } else if (!buyModel) {
      pendingRequirement='buy_model';
    } else if (!sellModel) {
      pendingRequirement='sell_model';
    } else {
      const appraisal=salesAppraisalDecision(s,history,documents,rules);
      const lastPending=salesLastPendingRequirement(history);
      const newVehiclePhotos=documents.filter(item=>item.kind==='vehicle_photo'&&item.readable!==false);
      const alreadyAcknowledged=salesCurrentSessionHistory(history).some(row=>row.direction==='outbound'&&row.ai_provider==='sales_core');
      const dualAcknowledgement=salesBuyAndSellAcknowledgement(s,buyModel,alreadyAcknowledged);
      if (!appraisal.ready) {
        reply=(lastPending==='vehicle_description'&&newVehiclePhotos.length)
          ? salesContextualPhotoReply(s,appraisal,buyModel)
          : dualAcknowledgement+' '+appraisal.reply;
        pendingRequirement=appraisal.described?'vehicle_photo':'vehicle_description';
      } else {
        stage=cfg.stage_keys.appraisal;
        followUpDisposition='resolved';
        if (catalogChoice.product) {
          reply='Perfeito, você escolheu o '+salesCatalogLabel(catalogChoice.product,false)+'. Sua avaliação também já está encaminhada, então vou passar tudo para a equipe continuar a negociação por aqui.';
          catalogChoiceAcknowledged=true;
        } else {
          reply='Perfeito, sua avaliação já está encaminhada. Vou passar tudo para a equipe continuar a negociação por aqui.';
        }
      }
    }
  } else if (mode==='sell') {
    const appraisal=salesAppraisalDecision(s,history,documents,rules);
    reply=appraisal.reply;
    if (!appraisal.ready) pendingRequirement=(salesText(s.sell_vehicle?.model)||salesText(s.sell_model))
      ? (appraisal.described?'vehicle_photo':'vehicle_description') : 'sell_model';
    if (appraisal.ready) { stage=cfg.stage_keys.appraisal; followUpDisposition='resolved'; }
  } else if (generated.action==='handoff') {
    stage=cfg.stage_keys[generated.reason==='appraisal'?'appraisal':'human'];
    followUpDisposition='resolved';
  } else if (generated.action==='register_interest') {
    if (!s.customer_name) {reply='Qual é o seu nome, por favor?';pendingRequirement='customer_name';}
    else if (mode==='buy' && !generated.product) {reply=salesPurchaseProductQuestion(groundingHistory(history),inventory,s);pendingRequirement='purchase_product';}
    else if (mode==='buy' && s.deposit_cents===null) {reply='Qual valor você pretende dar de entrada, ou seria uma compra à vista?';pendingRequirement='deposit';}
    else if (mode==='buy' && settings.sales.collect_documents && (!documentStatus.cpf_received||!documentStatus.cnh_received)) {
      reply=documentStatus.cnh_received?'Para seguir com a simulação, pode informar seu CPF?'
        :'Para seguir com a simulação de financiamento, pode enviar uma foto legível da CNH?';
      pendingRequirement='documents';
    }
    else if (!['buy','sell'].includes(mode)) reply='Você quer comprar ou vender um veículo?';
    else {register=true;reply='Seu interesse foi registrado. Vou chamar a equipe para continuar a negociação com os dados que você enviou.';followUpDisposition='resolved';}
  }

  // Do this at the final decision point so no acknowledgement, appraisal
  // helper, or model output can inject unrelated requirements into a pending
  // model question.
  if (pendingRequirement && !customerDisposition && !isLocationRequest && !acceptedHumanOffer) {
    const strictPendingReply=salesPendingRequirementReply(pendingRequirement);
    if (strictPendingReply) reply=strictPendingReply;
  }

  const isFrustrated = turn.messages.some(m => salesFrustrationDetected(m.text));
  const requirementAttempts = pendingRequirement ? salesPendingRequirementAttempts(history, pendingRequirement) : 0;
  const previousRequirement = salesLastPendingRequirement(history);
  if (!isFrustrated && !customerDisposition && !isLocationRequest && !acceptedHumanOffer && previousRequirement === pendingRequirement && requirementAttempts === 1) {
    const reorientation = salesPendingRequirementReorientation(pendingRequirement);
    if (reorientation) reply = reorientation;
  }

  let handoffReason = '';
  let defaultAssignee = null;
  const shouldEscalate = acceptedHumanOffer || isFrustrated || (pendingRequirement && requirementAttempts >= 2);

  if (shouldEscalate) {
    stage = cfg.stage_keys.human;
    register = false;
    defaultAssignee = await salesResolveDefaultAssignee(context);
    handoffReason = acceptedHumanOffer ? 'accepted_human_offer' : isFrustrated ? 'frustration' : 'anti_loop_escalation';
    reply = salesHandoffMessage(defaultAssignee, isFrustrated && !acceptedHumanOffer);
    pendingRequirement = '';
    followUpDisposition = 'resolved';
    optionalHumanOffer = null;
  }

  if (!followUpDisposition) {
    if (stage === cfg.stage_keys.human || shouldEscalate || event.handoff) {
      followUpDisposition = 'resolved';
    } else if (stage === cfg.stage_keys.appraisal) {
      followUpDisposition = 'resolved';
    } else if (register || afterSales) {
      followUpDisposition = 'resolved';
    } else if (pendingRequirement && ['buy_model', 'sell_model', 'buy_and_sell_models', 'vehicle_description', 'vehicle_photo', 'purchase_product', 'customer_name', 'deposit', 'documents'].includes(pendingRequirement)) {
      followUpDisposition = 'awaiting_customer';
    } else if (catalogRequested && catalogItems.length) {
      followUpDisposition = 'awaiting_customer';
    } else if (/\\b(?:gostaria\\s+de\\s+agendar|quer\\s+agendar|podemos\\s+agendar|qual\\s+(?:deles|modelo|veiculo|carro)|qual\\s+chamou|tem\\s+interesse)\\b/i.test(normalizeText(reply)) && /[?]/.test(reply)) {
      followUpDisposition = 'awaiting_customer';
    } else {
      followUpDisposition = 'not_applicable';
    }
  }

  if (!await commit()) return {ok:true,skipped:true,reason:'superseded'};
  // Re-read the source before registering. A price/status change requires a fresh confirmation.
  if (register && generated.product) {
    try {
      const fresh=(await salesInventory(context)).find(v=>v.id===generated.product.id);
      if (!fresh || fresh.price_cents!==generated.product.price_cents) throw new Error('PRODUCT_CHANGED');
      generated.product=fresh;
    } catch {
      register=false;stage=cfg.stage_keys.human;
      reply='Vou pedir para a equipe conferir o veículo e o valor atual antes de continuar a negociação.';
    }
  }
  let saved;
  s.optional_human_offer = optionalHumanOffer;
  s.follow_up_disposition = followUpDisposition;
  try {
    saved=await supabasePost('/rest/v1/rpc/magia_sales_save',{
      p_tenant:context.tenant.id,p_chat:chatId,p_session:turn.boundary_id,p_token:turn.token,
      p_revision:lead?.revision||0,p_request:turn.messages.at(-1).event_id,
      p_state:s,p_product:generated.product||null,p_stage:stage,p_register:register,
      p_documents:documents.filter(d=>d.kind==='document'&&d.readable).map(d=>({event_id:d.event_id,extracted:d.extracted}))});
  } catch (error) {
    // Never overwrite a human transition with a technical error event.
    await complete('cancelled');return {ok:false,skipped:true,reason:'sales_save_failed'};
  }
  if (catalogChoice.product&&!catalogChoiceAcknowledged) reply='Perfeito, você escolheu o '+salesCatalogLabel(catalogChoice.product)+'. '+reply;
  if (!saved?.id) {await complete('failed');return {ok:false,reason:'sales_not_persisted'};}
  Object.assign(event,{ai_provider:'sales_core',ai_model:generated.model||null,ai_usage:generated.usage||{},
    service:register?'sales_interest':'sales_qualification',stage:cfg.stages[saved.stage_key]?.name||saved.stage_key,
    handoff:saved.ai_locked,
    raw_payload:{sales_lead_id:saved.id,sales_revision:saved.revision,sales_stage:saved.stage_key,
      interest_registered:saved.interest_registered,document_count:documents.filter(d=>d.kind==='document').length,
      sales_media:documents.map(d=>({event_id:d.event_id,kind:d.kind,readable:d.readable})),
      ...(catalogItems.length?{catalog_item_ids:catalogItems.map(item=>item.id)}:{}),
      ...(pendingRequirement?{pending_requirement:pendingRequirement}:{}),
      ...(optionalHumanOffer?{optional_human_offer:optionalHumanOffer}:{}),
      ...(followUpDisposition?{follow_up_disposition:followUpDisposition}:{}),
      ...(handoffReason?{handoff_reason:handoffReason}:{})}});
  await saveEvent(event);
  const sent=reply ? await sendChannelMessage(context,cleanReplyText(reply),event) : {sent:false,silent:true};
  if (shouldEscalate && defaultAssignee?.name) {
    await salesAssignConversation(context, defaultAssignee, saved);
  }
  await complete('done');return {ok:true,...sent,lead_id:saved.id,handoff:saved.ai_locked};
}`;

content = content.slice(0, startIdx) + replacementBlock + content.slice(endIdx);

fs.writeFileSync(filePath, content.replace(/\r?\n/g, '\r\n'));
console.log('Successfully updated whatsapp_sales.js');
