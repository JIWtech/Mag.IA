function schedulingEnabled(context) {
  return settingsFor(context).appointment_scheduling?.enabled === true;
}

function schedulingUnitsInText(context, text) {
  const value = ' ' + normalizeText(text).replace(/[^a-z0-9 ]/g, ' ') + ' ';
  return Object.entries(settingsFor(context).appointment_scheduling?.units || {})
    .filter(([, unit]) => unit.aliases.some(alias => value.includes(' ' + normalizeText(alias) + ' ')))
    .map(([id]) => id);
}

function schedulingKnownUnit(context, history = []) {
  const messages = groundingHistory(history);
  for (const message of [...messages].reverse()) {
    const units = schedulingUnitsInText(context, message.text);
    if (units.length > 1) return '';
    if (units.length === 1) return units[0];
  }
  return '';
}

function schedulingRegionQuestion(context) {
  const names = Object.values(settingsFor(context).appointment_scheduling?.units || {}).map(unit => unit.name);
  return 'Em qual regi\u00e3o voc\u00ea quer atendimento: ' + names.join(' ou ') + '?';
}

async function schedulingCheck(context, state) {
  return supabasePost('/rest/v1/rpc/magia_appointment_availability', {
    p_tenant: context.tenant.id, p_unit: state.unit_id, p_service: state.service_id, p_date: state.date,
  });
}

async function schedulingValidateAction(context, generated, action) {
  if (!schedulingEnabled(context) || generated.handoff || generated.recallHandled || /HUMANO_SOLICITADO/.test(generated.text)) return generated;
  const state = generated.state || {};
  if (!state.unit_id) return { ...generated, text: schedulingRegionQuestion(context) };
  const wantsAvailability = action === 'check_availability' || action === 'create_appointment'
    || /dispon|\b(?:livres?|vagos?)\b|pode(?:mos)? (?:vir|agendar|marcar)|posso (?:agendar|reservar|marcar)|(?:sim|certo).{0,40}(?:marcar|agendar)/.test(normalizeText(generated.text))
    || (state.date && /\b(?:[01]?\d|2[0-3])(?::[0-5]\d|h\b)/.test(generated.text));
  if (!wantsAvailability) return generated;
  if (!state.service_id || !state.date) return { ...generated,
    text: !state.service_id ? 'Qual servi\u00e7o voc\u00ea quer agendar?' : 'Para qual dia voc\u00ea quer agendar?' };
  const cfg = settingsFor(context).appointment_scheduling;
  if (!cfg.service_resources[state.service_id]) return { ...generated,
    text: 'Vou chamar a equipe para consultar a agenda desse servi\u00e7o na unidade escolhida. [HUMANO_SOLICITADO]' };
  try {
    const availability = await schedulingCheck(context, state);
    if (!Array.isArray(availability.available_starts)) throw new Error('Invalid availability result');
    if (action === 'create_appointment' && availability.available_starts.includes(state.time)) return generated;
    return { ...generated, text: availability.available_starts.length
      ? 'Para ' + state.date.split('-').reverse().join('/') + ', posso oferecer ' + availability.available_starts.join(', ')
        + '. Qual hor\u00e1rio voc\u00ea prefere?'
      : 'N\u00e3o encontrei hor\u00e1rio dispon\u00edvel para esse servi\u00e7o nessa data e unidade. Qual outro dia fica bom para voc\u00ea?' };
  } catch (error) {
    return { ...generated, text: 'N\u00e3o consegui consultar a agenda com seguran\u00e7a. Vou chamar a equipe para verificar, sem confirmar um hor\u00e1rio incorreto. [HUMANO_SOLICITADO]',
      availability_error: String(error.message).slice(0, 160) };
  }
}

async function schedulingReserve(context, state) {
  if (!state?.unit_id || !state.service_id) throw new Error('SCHEDULE_NOT_CONFIGURED');
  const sessionMode = settingsFor(context).attendance_lifecycle === 'session_v2';
  const appointment = await supabasePost('/rest/v1/rpc/' + (sessionMode ? 'magia_reserve_session_appointment' : 'magia_reserve_appointment'), {
    p_tenant: context.tenant.id, p_unit: state.unit_id, p_service: state.service_id,
    p_date: state.date, p_time: state.time, p_name: state.customer_name, p_chat: String(chatId),
    p_request: 'whatsapp:' + turn.messages.at(-1).event_id, p_channel: 'whatsapp',
    ...(sessionMode ? {p_session:turn.boundary_id || 'initial'} : {}),
  });
  return { created: true, appointment };
}
