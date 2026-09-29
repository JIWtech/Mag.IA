function groundingLocationRequested(text) {
  return /endere[c\u00e7]o|localiza[c\u00e7][a\u00e3]o|onde (?:fica|ficam|e|voc|vcs|esta)|a onde|ponto de referencia|perto de (?:onde|que)|qual (?:a rua|o bairro|a cidade)|como cheg|manda.*localiza/i.test(normalizeText(text));
}

function groundedHandoff(reason) {
  return { text: 'Vou chamar uma pessoa da equipe para confirmar essa informa\u00e7\u00e3o e continuar seu atendimento, sem te passar dados incorretos.',
    handoff: true, source: 'missing_verified_fact', reason };
}

function groundingLocationReply(context, unitId = '') {
  const locations = settingsFor(context).business_facts?.locations;
  if (schedulingEnabled(context) && !unitId) return { text: schedulingRegionQuestion(context), handoff: false, source: 'region_selection' };
  const verified = Array.isArray(locations) ? locations.filter(row => row.verified === true && row.address?.trim()
    && (!unitId || row.id === unitId)) : [];
  if (!verified.length) return groundedHandoff('official_address_missing');
  return { text: verified.map(row => (row.name ? row.name + ': ' : '') + row.address
    + (row.reference ? '\nRefer\u00eancia: ' + row.reference : '')).join('\n\n'),
    handoff: false, source: 'tenant_settings.settings.business_facts.locations' };
}

function groundingPaymentReply(context) {
  const p = settingsFor(context).payment || {};
  if (!p.pix_key || !p.pix_holder) return groundedHandoff('payment_details_missing');
  return { text: 'Pode fazer pelo Pix:\nChave: ' + p.pix_key + '\nFavorecido: ' + p.pix_holder
    + (p.pix_institution ? '\nInstitui\u00e7\u00e3o: ' + p.pix_institution : '') + '\n\nDepois do pagamento, envie exatamente "'
    + paymentSignalTriggerFor(context) + '" para a equipe conferir o sinal.', handoff: false, source: 'tenant_settings.settings.payment' };
}

function groundingDirectReply(context, text, history = []) {
  if (groundingLocationRequested(text)) return groundingLocationReply(context, schedulingKnownUnit(context, history));
  if (/\bpix\b|dados (?:do|de) pagamento|como (?:eu )?(?:pago|pagar|faco o pagamento)/.test(normalizeText(text))
    && !/paguei|realizado|nao (?:vou|quero|posso)|cancel|estorno|devolu/.test(normalizeText(text))) return groundingPaymentReply(context);
  if (/^\[(?:audio|image|video|document|contact|sticker)\]$/im.test(String(text).trim())) {
    return { text: 'Recebi seu arquivo. Vou chamar a equipe para verificar o conte\u00fado e continuar por aqui.',
      handoff: true, source: 'unsupported_media', reason: 'media_not_transcribed' };
  }
  return null;
}

function groundingHistory(history) {
  return history.filter(row => row.direction === 'inbound' && row.message_text
    && row.sender_type !== 'system' && row.ai_provider !== 'buffer').map(row => ({
    id: row.id, received_at: row.created_at, text: row.message_text,
  })).concat(turn.messages.map(row => ({ id: row.event_id, received_at: row.received_at, text: row.text })));
}

function groundingDateFromEvidence(text, timestamp, context) {
  const value = normalizeText(text);
  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: tenantTimeZone(context), year:'numeric',month:'2-digit',day:'2-digit' })
    .formatToParts(new Date(timestamp));
  const part = key => dateParts.find(p => p.type === key).value;
  const date = new Date(Date.UTC(Number(part('year')),Number(part('month'))-1,Number(part('day'))));
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const br = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (br) return (br[3] || part('year'))+'-'+br[2].padStart(2,'0')+'-'+br[1].padStart(2,'0');
  if (/depois de amanha/.test(value)) date.setUTCDate(date.getUTCDate()+2);
  else if (/\bamanha\b/.test(value)) date.setUTCDate(date.getUTCDate()+1);
  else if (!/\bhoje\b/.test(value)) {
    const days=['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const target=days.findIndex(day => new RegExp('\\b'+day+'\\b').test(value));
    if (target < 0) return null;
    const delta=(target-date.getUTCDay()+7)%7;
    date.setUTCDate(date.getUTCDate()+(delta || 7));
  }
  return date.toISOString().slice(0,10);
}

function groundingTimeFromEvidence(text) {
  const value=normalizeText(text);
  const m=value.match(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h(?:([0-5]\d))?|\s*horas?)\b/)
    || value.match(/^(?:as\s+)?([01]?\d|2[0-3])$/);
  return m ? m[1].padStart(2,'0')+':'+(m[2]||m[3]||'00') : null;
}

function groundingResponseSchema() {
  const str = { type:'STRING' };
  return { type:'OBJECT', properties: {
    action:{type:'STRING',enum:['reply','location','payment','check_availability','create_appointment','handoff']},
    reply:str,
    state:{type:'OBJECT',properties:{customer_name:str,service_id:str,date:str,time:str,unit_id:str,unit_evidence:str,
      name_evidence:str,service_evidence:str,date_evidence:str,time_evidence:str},
      required:['customer_name','service_id','date','time','name_evidence','service_evidence','date_evidence','time_evidence','unit_id','unit_evidence']},
  }, required:['action','reply','state'] };
}

function groundingValidateResponse(result, context, customerMessages, catalog, appointments) {
  const allowed=['reply','location','payment','check_availability','create_appointment','handoff'];
  if (!result || !allowed.includes(result.action) || typeof result.reply !== 'string'
    || !result.state || result.reply.length > 2400) throw new Error('Invalid structured reply');
  const state = result.state;
  for (const key of ['customer_name','service_id','date','time','name_evidence','service_evidence','date_evidence','time_evidence']) {
    if (typeof state[key] !== 'string' || state[key].length > 180 || /[|\[\]\n]/.test(state[key])) throw new Error('Invalid state field');
  }
  const byId = new Map(customerMessages.map(m => [m.id,m]));
  if (schedulingEnabled(context)) {
    for (const key of ['unit_id', 'unit_evidence']) {
      if (typeof state[key] !== 'string' || state[key].length > 180) throw new Error('Invalid unit field');
    }
    const defaultUnitId = schedulingDefaultUnitId(context);
    if (defaultUnitId) {
      // A single configured unit is a system fact. It never needs customer evidence.
      state.unit_id = defaultUnitId;
      state.unit_evidence = '';
    } else if (state.unit_id) {
      const proof = byId.get(state.unit_evidence);
      if (!proof || !settingsFor(context).appointment_scheduling.units[state.unit_id]
        || schedulingUnitsInText(context, proof.text).length !== 1
        || !schedulingUnitsInText(context, proof.text).includes(state.unit_id)) throw new Error('Unit without customer evidence');
    }
  }
  const service = catalog.matches.find(row => row.external_id === state.service_id);
  const proofs = { name:byId.get(state.name_evidence),service:byId.get(state.service_evidence),
    date:byId.get(state.date_evidence),time:byId.get(state.time_evidence) };
  if (state.customer_name && (!proofs.name || !normalizeText(proofs.name.text).includes(normalizeText(state.customer_name)))) throw new Error('Name without customer evidence');
  if (state.service_id && (!proofs.service || !service)) throw new Error('Service without catalog/customer evidence');
  if (state.date && (!proofs.date || groundingDateFromEvidence(proofs.date.text,proofs.date.received_at,context) !== state.date)) throw new Error('Date without matching customer evidence');
  if (state.time && (!proofs.time || groundingTimeFromEvidence(proofs.time.text) !== state.time)) throw new Error('Time without matching customer evidence');
  if (result.action === 'location' || /\b(?:rua|avenida|bairro|praca|igreja|cidade|cep|endereco|parque central|localizad[oa]s?)\b|(?:ficamos|estamos|clinica (?:fica|esta)|unidade) (?:em|na|no|perto)/i.test(normalizeText(result.reply))) {
    const direct=groundingLocationReply(context, state.unit_id);
    return {...direct,text:direct.text+(direct.handoff?' [HUMANO_SOLICITADO]':''),state};
  }
  if (result.action === 'payment' || /chave pix|favorecid[oa]|instituicao|pix.{0,25}\d{5}/i.test(normalizeText(result.reply))) {
    const direct=groundingPaymentReply(context);
    return {...direct,text:direct.text+(direct.handoff?' [HUMANO_SOLICITADO]':''),state};
  }
  if (result.action === 'handoff') return {text:'Vou chamar uma pessoa da equipe para continuar seu atendimento com os detalhes que voc\u00ea j\u00e1 enviou. [HUMANO_SOLICITADO]',state};
  if (result.action === 'check_availability') return { text: schedulingEnabled(context) ? ''
    : 'Vou chamar a equipe para consultar a disponibilidade desse servi\u00e7o. [HUMANO_SOLICITADO]', state };
  if (result.action === 'create_appointment') {
    if (schedulingEnabled(context) && !state.unit_id) return { text:schedulingRegionQuestion(context), state };
    if (!state.customer_name || !service || !state.date || !state.time) throw new Error('Incomplete booking action');
    const existing=appointments.rows?.find(a=>Date.parse(a.starts_at)>Date.now());
    const requested=parseAppointmentStartAt(state.date,state.time,context);
    if (existing && (Date.parse(existing.starts_at) !== Date.parse(requested) || !normalizeText(existing.title).includes(normalizeText(service.name))
      || (schedulingEnabled(context) && existing.metadata?.unit_id !== state.unit_id))) {
      return {text:'Vou chamar a equipe para verificar essa altera\u00e7\u00e3o do seu agendamento. [HUMANO_SOLICITADO]',state};
    }
    return {text:'[ACAO: CRIAR_AGENDAMENTO|nome='+state.customer_name+'|servico='+service.name+'|data='+state.date
      +'|hora='+state.time+'|duracao='+Number(settingsFor(context).appointment_duration_minutes||60)+'|status=pending_payment]',state};
  }
  // Free prose must never claim that a database operation or payment verification happened.
  if (/(?:agendamento|reserva|horario).{0,45}(?:confirmad|registrad|reservad|garantid)|(?:ja|acabei de) (?:agend|reserv|registr)|pagamento (?:confirmad|verificad)|sinal (?:confirmad|verificad)/i.test(normalizeText(result.reply))) {
    const existing=appointments.rows?.find(a=>Date.parse(a.starts_at)>Date.now());
    if (!existing) throw new Error('Unexecuted action claim');
    const status={pending_payment:'aguardando o pagamento do sinal',payment_reported:'aguardando a confer\u00eancia do sinal pela equipe',confirmed:'confirmado pela equipe'}[existing.status];
    if (!status) throw new Error('Appointment status requires human verification');
    return {text:'Seu agendamento para '+appointmentDateLabel(existing)+' consta no sistema como '+status+'.',state};
  }
  const knownPrices=new Set(catalog.matches.filter(row=>row.price != null && Number.isFinite(Number(row.price))).flatMap(row=>[Number(row.price).toFixed(2),
    (Number(row.price)*Number(settingsFor(context).payment?.deposit_percentage||0)/100).toFixed(2)]));
  for (const fee of Object.values(settingsFor(context).business_facts?.fees || {})) {
    if (Number.isFinite(fee)) knownPrices.add(Number(fee).toFixed(2));
  }
  for (const match of result.reply.matchAll(/R\$\s*(\d+(?:[.,]\d{2})?)/g)) {
    if (!knownPrices.has(Number(match[1].replace(',','.')).toFixed(2))) throw new Error('Price absent from official catalog');
  }
  if (/minha memoria|me perdi na conversa|me lembrar|esqueci|memoria nao/.test(normalizeText(result.reply))) throw new Error('Memory excuse blocked');
  if (!result.reply.trim()) throw new Error('Empty customer reply');
  return {text:cleanReplyText(result.reply),state};
}

async function callGroundedGemini(context, history, catalog, appointments) {
  const s=settingsFor(context);
  const prompt=String(s.system_prompt || '').trim();
  const model=String(s.ai_model || '');
  const audit={revision:'canonical_v2',prompt_source:'tenant_settings.settings.system_prompt',prompt_revision:s.prompt_revision,
    facts_source:'supabase:tenant_settings+tenant_service_catalog',history_records:history.length,
    old_assistant_facts_excluded:true};
  if (!prompt || !/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error('Canonical prompt/model missing');
  const customerMessages=groundingHistory(history);
  const verifiedAssistant=history.filter(row=>row.direction==='outbound' && row.raw_payload?.grounding?.revision==='canonical_v2'
    && row.raw_payload.grounding.prompt_revision === s.prompt_revision)
    .slice(-12).map(row=>({text:row.message_text,at:row.created_at}));
  const input={official_facts:{tenant:context.tenant.name,date:buildDateContext(context),
    business:s.business_facts||{},payment:s.payment||{},catalog:catalog.matches,
    scheduling:s.appointment_scheduling ? {timezone:s.appointment_scheduling.timezone,duration_minutes:s.appointment_scheduling.duration_minutes,
      units:Object.fromEntries(Object.entries(s.appointment_scheduling.units).map(([id,u])=>[id,{name:u.name,starts:u.starts}])),
      supported_services:Object.keys(s.appointment_scheduling.service_resources)} : null,
    appointments:appointments.rows?.map(a=>({id:a.id,title:a.title,starts_at:a.starts_at,status:a.status,unit_id:a.metadata?.unit_id}))||[]},
    customer_messages:customerMessages,recent_verified_assistant_messages:verifiedAssistant,
    current_message_ids:turn.messages.map(m=>m.event_id)};
  let body;
  try {
    body=await httpJson('POST','https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',
      {'Content-Type':'application/json','x-goog-api-key':env('GEMINI_API_KEY')},
      {system_instruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
        generationConfig:{temperature:0.2,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},
          responseMimeType:'application/json',responseSchema:groundingResponseSchema()}});
    const candidate=body?.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete model output');
    const value=JSON.parse(candidate.content.parts.filter(p=>!p.thought).map(p=>p.text||'').join(''));
    const validated=groundingValidateResponse(value,context,customerMessages,catalog,appointments);
    const valid=await schedulingValidateAction(context,validated,value.action);
    return {...valid,model,usage:body.usageMetadata||{},audit:{...audit,action:value.action,
      ...(valid.availability_error ? {availability_error:valid.availability_error} : {})}};
  } catch (error) {
    return {text:'Vou chamar uma pessoa da equipe para continuar seu atendimento com seguran\u00e7a, sem pedir que voc\u00ea repita tudo. [HUMANO_SOLICITADO]',
      model,usage:body?.usageMetadata||{},state:null,audit:{...audit,blocked_reason:String(error.message).slice(0,160)}};
  }
}
