function sessionHandoffMessage() {
  return 'S\u00f3 um momentinho, por favor. Vou chamar a equipe para conferir isso com carinho e continuar seu atendimento por aqui.';
}

function sessionReferenceIntent(text) {
  const value = normalizeText(text);
  if (/outro (?:numero|telefone|whatsapp|contato)|numero (?:antigo|da minha|do meu)|agendamento (?:da minha|do meu)|conversa (?:da minha|do meu)/.test(value)) return 'other_contact';
  if (/(?:remarcar|reagendar|cancelar|alterar|mudar|trocar).{0,45}(?:agendamento|reserva|horario|dia)|(?:agendamento|reserva|horario).{0,40}(?:remarcar|cancelar|alterar|mudar)/.test(value)) return 'change_booking';
  if (/(?:novo|outro|mais um) (?:agendamento|atendimento|horario)|agendar (?:de novo|novamente|outro)|mais uma (?:sessao|reserva)/.test(value)) return 'new_booking';
  if (/atendimento anterior|conversa anterior|ultima conversa|ultimo atendimento|da outra vez|falei.{0,25}(?:ontem|antes|outro dia)|conversamos.{0,25}(?:ontem|antes)|meu agendamento|minha reserva|ja (?:agendei|marquei)|qual.{0,20}(?:horario|dia).{0,15}(?:agend|marcad)/.test(value)) return 'recall';
  return '';
}

async function sessionRecall(context, reason = 'recall') {
  // Never search another customer's number or import archived bot assertions.
  if (reason !== 'recall') return { text: sessionHandoffMessage(), handoff: true, reason };
  try {
    const result = await loadAppointments(context.tenant.id, true);
    if (result.overflow || result.rows.length !== 1) return { text: sessionHandoffMessage(), handoff: true,
      reason: result.rows.length ? 'previous_context_ambiguous' : 'previous_context_not_found' };
    const row = result.rows[0];
    const status = {pending_payment:'aguardando o sinal',payment_reported:'aguardando a confer\u00eancia do sinal',
      confirmed:'confirmado',scheduled:'agendado',cancelled:'cancelado',canceled:'cancelado',completed:'conclu\u00eddo',done:'conclu\u00eddo',no_show:'registrado como falta'}[row.status];
    if (!status) return {text:sessionHandoffMessage(),handoff:true,reason:'previous_status_unknown'};
    return { text:'Encontrei uma reserva para ' + appointmentDateLabel(row) + ', com status ' + status
      + '. \u00c9 sobre esse atendimento que voc\u00ea quer falar?', handoff:false, reason:'previous_appointment_found', appointment_id:row.id };
  } catch {
    return {text:sessionHandoffMessage(),handoff:true,reason:'previous_context_lookup_failed'};
  }
}

function sessionUsageDiagnostic(gate) {
  return { reason: gate.forceMock ? 'tenant_ai_disabled' : !gate.enabled ? 'provider_disabled'
    : !gate.hasKey ? 'provider_key_missing' : 'daily_limit_reached',
    daily_limit:gate.dailyLimit, used_today:gate.usedToday };
}
