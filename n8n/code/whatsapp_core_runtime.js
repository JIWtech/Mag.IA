async function queueRpc(name, extra = {}) {
  return supabasePost('/rest/v1/rpc/magia_' + name + '_turn', {
    p_tenant: $json.tenant_id, p_chat: chatId, ...(turn?.token ? { p_token: turn.token } : {}), ...extra,
  });
}

async function complete(outcome) {
  return queueRpc('finish', { p_outcome: outcome });
}

async function commit() {
  const result = await queueRpc('commit');
  if (!result.committed) {
    await complete(result.reason === 'new_messages' ? 'retry' : 'cancelled');
    return false;
  }
  turnCommitted = true;
  return true;
}

async function runTurn() {
  if (!tenantSlug || !chatId || !$json.tenant_id) throw new Error('Missing scoped input');
  const context = await loadTenantContext();
  // Never consume a turn when the transport credentials are missing.
  const suffix = tenantEnvSuffix(tenantSlug);
  if (!env('EVOLUTION_API_URL_' + suffix) || !env('EVOLUTION_API_KEY_' + suffix)
    || env('EVOLUTION_INSTANCE_' + suffix) !== $json.instance) throw new Error('Configure tenant Evolution environment first');
  turn = await queueRpc('claim');
  if (!turn.claimed) return { ok: true, skipped: true, reason: turn.reason };
  message.message_id = turn.messages.at(-1).id;
  setCurrentText(turn.messages.map(item => item.text).filter(Boolean).join('\n\n'));
  originalTextOrCaption = displayMessageText = rawText;
  const controlHistory = await loadRecentHistory(context);
  if (turn.history_boundary_changed) {
    await complete('cancelled'); return { ok:true, skipped:true, reason:'attendance_changed' };
  }
  if (turn.boundary_created_at) {
    const obsolete = turn.messages.filter(item => Date.parse(item.received_at) <= Date.parse(turn.boundary_created_at));
    if (obsolete.length) {
      await supabasePatch('/rest/v1/channel_events?tenant_id=eq.' + encodeFilter($json.tenant_id)
        + '&id=in.(' + obsolete.map(item => encodeFilter(item.event_id)).join(',') + ')',
      { stage: 'Finalizado', ai_provider: 'cancelled_before_close', response_text: null });
      turn.messages = turn.messages.filter(item => !obsolete.includes(item));
      if (!turn.messages.length) { await complete('cancelled'); return { ok:true, skipped:true, reason:'closed_before_processing' }; }
      setCurrentText(turn.messages.map(item => item.text).filter(Boolean).join('\n\n'));
    }
  }
  const control = conversationControl(controlHistory);
  const settings = settingsFor(context);
  const grounded = settings.grounding_mode === 'canonical_v2';
  const history = grounded ? control.activeHistory : control.activeHistory.slice(-12);
  const event = { tenant_id: context.tenant.id, tenant_slug: tenantSlug, channel_type: 'whatsapp',
    service: 'geral', stage: 'Conversas IA', handoff: false, ai_provider: 'rules', raw_payload: {} };

  const exclusion = await contactExclusionStatus(context);
  if (exclusion.blocked) {
    if (!await commit()) return { ok: true, skipped: true, reason: 'superseded' };
    await recordContactExclusion(context, exclusion);
    await complete('done');
    return { ok: true, skipped: true, reason: exclusion.reason };
  }

  const contact = await loadContact(context);
  if (shouldIgnoreBecauseOwnerSavedContact(contact, turn)) {
    if (!await commit()) return { ok: true, skipped: true };
    event.ai_provider = 'owner_saved_suppression';
    event.handoff = false;
    event.stage = 'Atendimento humano';
    event.service = 'atendimento_humano';
    event.raw_payload = {
      ...(event.raw_payload || {}),
      ai_suppressed: true,
      ai_suppressed_reason: 'owner_saved_contact',
      is_owner_saved: true,
      owner_saved_source: contact?.metadata?.whatsapp_owner_saved_source || 'evolution_contacts',
    };
    await saveEvent(event);
    await complete('done');
    return { ok: true, skipped: true, ai_suppressed: true, reason: 'owner_saved_contact' };
  }

  if (salesEnabled(context)) return runSalesTurn(context, history, event, control);

  if (normalized === '/reset' || normalized === 'reset') {
    if (!await commit()) return { ok: true, skipped: true };
    event.ai_provider = 'conversation_reset'; event.service = 'conversation_closed'; event.stage = 'Reset';
    await saveEvent(event);
    const sent = await sendChannelMessage(context, 'Conversa reiniciada. Pode mandar sua próxima mensagem.', event);
    await complete('done'); return { ok: true, ...sent };
  }
  // Handoff is persistent across messages; SINAL PAGO is acknowledged only once.
  if (control.lockedByHuman) {
    if (!await commit()) return { ok: true, skipped: true };
    event.ai_provider = 'human_lock'; event.handoff = true;
    event.stage = control.lockEvent?.stage || 'Atendimento humano';
    event.service = control.lockEvent?.service || 'atendimento_humano';
    await saveEvent(event); await complete('done');
    return { ok: true, human_lock: true, skipped: true };
  }
  try {
    await transcribeTurnAudio(context);
  } catch (error) {
    if (!await commit()) return {ok:true,skipped:true,reason:'superseded'};
    Object.assign(event,{ai_provider:'audio_handoff',handoff:true,stage:'Atendimento humano',service:'atendimento_humano',
      ai_error:String(error.message).slice(0,160)});
    await saveEvent(event);
    const sent=await sendChannelMessage(context,'Recebi seu \u00e1udio, mas n\u00e3o consegui processar com seguran\u00e7a agora. S\u00f3 um momentinho, vou chamar a equipe para continuar com voc\u00ea.',event);
    await complete('done');return {ok:true,handoff:true,...sent};
  }
  if (isPaymentSignalPaidText(rawText, context)) {
    if (!await commit()) return { ok: true, skipped: true };
    const update = await markLatestAppointmentPaymentReported(context);
    Object.assign(event, { service: 'pagamento_sinal', stage: paymentSignalStageFor(context),
      handoff: true, ai_provider: 'payment_signal', raw_payload: { payment_signal: { appointment_update: update,
        pending_confirmation_message: paymentSignalConfirmationMessage(context) } } });
    await saveEvent(event);
    const sent = await sendChannelMessage(context, paymentSignalAckMessage(context), event);
    await complete('done'); return { ok: true, handoff: true, ...sent };
  }

  const appointmentResult = await loadAppointments(context.tenant.id);
  const appointments = appointmentState(appointmentResult.rows);
  const catalog = await loadCatalogContext(context);
  if (catalog.error || !catalog.matches?.length) throw new Error('Service catalog unavailable');
  const classification = classify(context);
  const gate = usageGate(context);
  const fullCatalog = wantsFullCatalogRequest() && catalog.isComplete;
  const referenceIntent = grounded ? sessionReferenceIntent(rawText) : '';
  let responseText;
  if (['recall', 'other_contact', 'change_booking'].includes(referenceIntent)) {
    const recalled = await sessionRecall(context, referenceIntent);
    responseText = recalled.text; event.handoff = recalled.handoff;
    event.ai_provider = 'previous_context_lookup';
    if (recalled.handoff) event.stage = 'Atendimento humano';
    event.raw_payload.previous_context = { reason:recalled.reason, appointment_id:recalled.appointment_id || null };
  } else if (grounded && (turn.history_overflow || JSON.stringify(history.map(audioHistoryText)).length > 65000)) {
    responseText = 'Vou chamar uma pessoa da equipe para continuar com os detalhes que voc\u00ea j\u00e1 enviou.';
    event.ai_provider = 'context_capacity_handoff'; event.handoff = true; event.stage = 'Atendimento humano';
  } else if (grounded && groundingDirectReply(context, rawText, history)) {
    const direct = groundingDirectReply(context, rawText, history);
    responseText = direct.text; event.ai_provider = 'verified_facts';
    event.handoff = direct.handoff; if (direct.handoff) event.stage = 'Atendimento humano';
    event.raw_payload.grounding = { revision: 'canonical_v2', source: direct.source, blocked_reason: direct.reason || null };
  } else if (fullCatalog) {
    responseText = buildFullCatalogReplyFromRows(catalog.matches);
    event.ai_provider = 'catalog_db_direct';
  } else if (!gate.allowed) {
    responseText = sessionHandoffMessage();
    event.ai_provider = 'fallback_daily_limit'; event.handoff = true; event.stage = 'Atendimento humano';
    event.raw_payload.ai_availability = sessionUsageDiagnostic(gate);
    event.ai_error = event.raw_payload.ai_availability.reason;
  } else {
    const generated = grounded
      ? await callGroundedGemini(context, history, catalog, referenceIntent === 'new_booking' ? appointmentState([]) : appointments)
      : await callGemini(context, classification, '', history, catalog, appointments);
    markUsage();
    responseText = generated.text; event.ai_provider = 'gemini'; event.ai_model = generated.model; event.ai_usage = generated.usage;
    if (grounded) {
      event.raw_payload.grounding = generated.audit;
      event.raw_payload.conversation_state = generated.state || null;
    }
  }
  // No appointment or payment side effect before fencing stale model output.
  if (!await commit()) return { ok: true, skipped: true, reason: 'superseded' };
  const actions = detectActions(responseText);
  const tag = parseAppointmentCreationTag(responseText);
  let creation = null;
  if (tag) {
    try {
      // Require an actual active service, full identity and a valid future date.
      const services = await supabaseGet('/rest/v1/tenant_service_catalog?select=name&tenant_id=eq.'
        + encodeFilter(context.tenant.id) + '&active=eq.true&limit=100');
      const service = services.find(item => normalizeText(item.name) === normalizeText(tag.service));
      const starts = parseAppointmentStartAt(tag.date, tag.time, context);
      const roundtrip = starts && new Intl.DateTimeFormat('en-CA', { timeZone: tenantTimeZone(context), year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(starts));
      if (!tag.customerName?.trim() || !service || !starts || Date.parse(starts) <= Date.now()
        || (/^\d{4}-\d{2}-\d{2}$/.test(tag.date) && roundtrip !== tag.date)) throw new Error('Invalid appointment details');
      tag.service = service.name;
      creation = schedulingEnabled(context)
        ? await schedulingReserve(context, event.raw_payload.conversation_state)
        : await createAppointmentFromTag(context, tag, tag.customerName);
      if (!creation.appointment?.id) throw new Error('Appointment not persisted');
      event.stage = creation.appointment.status === 'pending_payment' ? 'Aguardando sinal' : 'Agendamento confirmado';
      event.service = 'agendamento';
      event.raw_payload.appointment_creation = creation;
      responseText = creation.appointment.status === 'pending_payment'
        ? 'Perfeito, ' + tag.customerName + '! Seu pré-agendamento para ' + service.name + ' em '
          + appointmentDateLabel(creation.appointment) + ' foi registrado e fica pendente do pagamento do sinal.'
        : 'Seu agendamento foi registrado para ' + appointmentDateLabel(creation.appointment) + '.';
      if (schedulingEnabled(context)) {
        const unit = settings.appointment_scheduling.units[event.raw_payload.conversation_state.unit_id];
        responseText += ' Unidade: ' + unit.name + '.';
      }
    } catch (error) {
      responseText = 'Não consegui registrar esse horário. Me confirme o serviço, a data e o horário desejados para eu verificar?';
      if (schedulingEnabled(context)) {
        if (/SLOT_UNAVAILABLE/.test(String(error.message))) {
          responseText = 'Esse hor\u00e1rio acabou de ficar indispon\u00edvel. Qual outro hor\u00e1rio ou dia fica bom para voc\u00ea?';
        } else {
          responseText = 'N\u00e3o consegui concluir a reserva com seguran\u00e7a. Vou chamar a equipe para verificar, aproveitando os dados que voc\u00ea j\u00e1 enviou.';
          event.handoff = true; event.stage = 'Atendimento humano';
        }
      }
      event.ai_error = 'appointment_not_created';
      event.raw_payload.appointment_creation = { created: false, reason: error.message };
    }
  } else if (actions.humanRequested || (actions.complaint && !isBotFrustrationText())) {
    event.handoff = true; event.stage = 'Atendimento humano'; event.service = 'atendimento_humano';
  }
  const clean = enforceEmojiPolicy(removeMidConversationGreeting(cleanReplyText(responseText), history.length > 0), history,
    { ...classification, handoff: event.handoff });
  event.raw_payload.catalog_lookup = { count: catalog.matches.length, mode: catalog.mode };
  await saveEvent(event);
  const sent = await sendChannelMessage(context, clean, event);
  await complete('done');
  return { ok: true, ...sent, appointment_id: creation?.appointment?.id || null, grouped: turn.messages.length };
}

try {
  return { json: await runTurn() };
} catch (error) {
  if (turn?.claimed) {
    // Provider timeouts have unknown delivery state. Do not retry them blindly.
    const outcome = sendAttempted ? 'uncertain' : 'failed';
    await saveEvent({ service: 'technical_error', stage: 'Atendimento humano', handoff: true,
      ai_provider: 'core_error', ai_error: String(error.message || 'processing_failed').slice(0,300),
      raw_payload: { delivery_uncertain: sendAttempted, provider_accepted: providerAccepted } }).catch(() => {});
    await complete(outcome).catch(() => {});
  }
  return { json: { ok: false, tenant_slug: tenantSlug, error: String(error.message || 'processing_failed').slice(0,300), delivery_uncertain: sendAttempted } };
}
