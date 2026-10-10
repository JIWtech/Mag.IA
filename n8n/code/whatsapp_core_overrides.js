// Overrides are assembled with the verified legacy business functions by the builder.
function buildDateContext(context = {}) {
  const timeZone = tenantTimeZone(context);
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return { timeZone, today: date.format(now), tomorrow: date.format(new Date(now.getTime() + 86400000)),
    currentTime: new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now),
    generatedAt: now.toISOString() };
}

async function loadTenantContext() {
  const tenants = await supabaseGet('/rest/v1/tenants?select=*&slug=eq.' + encodeFilter(tenantSlug) + '&limit=1');
  const tenant = tenants?.[0];
  if (!tenant || tenant.status !== 'active' || tenant.id !== $json.tenant_id) throw new Error('Invalid tenant');
  const settingRows = await supabaseGet('/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenant.id);
  if (settingRows.length !== 1) throw new Error('Invalid tenant settings');
  if (settingRows[0].settings?.whatsapp_processing_mode !== 'conversation_core_v1') throw new Error('Core not enabled for tenant');
  const agentRows = settingRows[0].settings?.grounding_mode === 'canonical_v2' ? []
    : await supabaseGet('/rest/v1/ai_agents?select=*&tenant_id=eq.' + tenant.id + '&provider=eq.gemini&order=created_at.asc&limit=1');
  const channelRows = await supabaseGet('/rest/v1/channels?select=*&tenant_id=eq.' + tenant.id
    + '&type=eq.whatsapp&status=eq.active&external_id=eq.' + encodeFilter($json.instance) + '&limit=1');
  if (!channelRows.length) throw new Error('Instance does not belong to tenant');
  return { tenant, settings: settingRows[0], agent: agentRows[0] || {}, channel: channelRows[0] };
}

async function loadContact(context) {
  try {
    const rows = await supabaseGet('/rest/v1/contacts?select=id,name,phone,external_handle,metadata&tenant_id=eq.'
      + encodeFilter(context.tenant.id) + '&external_handle=eq.' + encodeFilter(chatId) + '&limit=1');
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

function shouldIgnoreBecauseOwnerSavedContact(contact, turn = null) {
  if (contact?.metadata?.whatsapp_owner_saved === true) return true;
  if (turn?.messages?.some(m => m.raw?.is_owner_saved || m.raw?.ai_suppressed)) return true;
  return false;
}

async function loadRecentHistory(context = {}) {
  const base = '/rest/v1/channel_events?select=*'
    + '&tenant_slug=eq.' + encodeFilter(tenantSlug) + '&channel_type=eq.whatsapp'
    + '&external_conversation_id=eq.' + encodeFilter(chatId);
  const boundary = await supabaseGet(base
    + '&or=(service.eq.conversation_closed,ai_provider.eq.conversation_closed,ai_provider.eq.conversation_reset)'
    + '&order=created_at.desc,id.desc&limit=1');
  const grounded = settingsFor(context).grounding_mode === 'canonical_v2';
  const rows = await supabaseGet(base + '&or=(ai_provider.is.null,ai_provider.neq.buffer)'
    + (boundary[0] ? '&created_at=gt.' + encodeFilter(boundary[0].created_at) : '')
    + '&order=created_at.desc,id.desc&limit=' + (grounded ? 251 : 50));
  if (!Array.isArray(rows)) throw new Error('Conversation history unavailable');
  turn.boundary_created_at = boundary[0]?.created_at || null;
  // The queue claim and the history lookup must describe the same attendance.
  turn.history_boundary_changed = !!turn.boundary_id && turn.boundary_id !== (boundary[0]?.id || 'initial');
  turn.history_overflow = grounded && rows.length > 250;
  return rows.reverse();
}

function isPaymentSignalPaidText(value = rawText, context = {}) {
  const config = paymentSignalSettingsFor(context);
  if (!config.enabled) return false;
  const expected = compactCommandText(config.trigger);
  const accepted = [expected, 'paguei o sinal', 'ja paguei o sinal', 'pix realizado', 'pagamento realizado'];
  return String(value).split('\n').some(line => accepted.includes(compactCommandText(line)));
}

function conversationControl(history = []) {
  const activeHistory = historyAfterControlBoundary(history);
  const lastResume = activeHistory.findLastIndex(event => event.service === 'resume_ai' || event.ai_provider === 'resume_ai');
  const afterResume = activeHistory.slice(lastResume + 1);
  const event = [...afterResume].reverse().find(item => item.handoff === true || isHumanOutbound(item));
  return { activeHistory, lockedByHuman: !!event, lockEvent: event || null, lockSource: event ? 'human_control' : null };
}

async function loadAppointments(tenantId, includePrevious = false) {
  const rows = await supabaseGet('/rest/v1/appointments?select=*&tenant_id=eq.' + encodeFilter(tenantId)
    + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
    + (!includePrevious ? '&status=not.in.(cancelled,canceled,completed,done,no_show)&starts_at=gt.' + encodeFilter(new Date().toISOString())
      + (turn?.boundary_created_at ? '&created_at=gt.' + encodeFilter(turn.boundary_created_at) : '') : '')
    + '&order=created_at.desc&limit=31');
  if (!Array.isArray(rows)) throw new Error('Appointments unavailable');
  const scoped = includePrevious ? rows : rows.filter(row => {
    if (['cancelled','canceled','completed','done','no_show'].includes(row.status) || Date.parse(row.starts_at) <= Date.now()) return false;
    const session = row.metadata?.conversation_session_id;
    if (session) return session === (turn?.boundary_id || 'initial');
    return !turn?.boundary_created_at || Date.parse(row.created_at) > Date.parse(turn.boundary_created_at);
  });
  return { rows: scoped, error: '', overflow: rows.length > 30 };
}

async function loadCatalogContext(context) {
  // Small service catalogs must also be present for follow-ups like "e o valor?".
  const rows = await supabaseGet('/rest/v1/tenant_service_catalog?select=external_id,category,name,description,price,billing_unit,estimated_hours,notes,active'
    + '&tenant_id=eq.' + encodeFilter(context.tenant.id) + '&active=eq.true&order=category.asc,name.asc&limit=101');
  if (!Array.isArray(rows)) throw new Error('Invalid service catalog');
  const matches = rows.slice(0,100);
  return { matches, context: catalogRowsToContext(matches), mode:'tenant_active_catalog',
    isComplete: rows.length <= 100, validation: { valid:true }, error:'' };
}

async function markLatestAppointmentPaymentReported(context) {
  const rows = (await loadAppointments(context.tenant.id)).rows;
  const candidates = rows.filter(row => ['pending_payment','reserved','payment_requested'].includes(row.status))
    .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (candidates.length > 1) return { updated: false, reason: 'ambiguous_payment_appointment' };
  const target = candidates[0];
  if (!target) return { updated: false, reason: 'appointment_not_found' };
  const payload = { status: 'payment_reported', metadata: { ...target.metadata,
    payment_status: 'reported_by_customer', payment_reported_at: new Date().toISOString() }, updated_at: new Date().toISOString() };
  const saved = await supabasePatch('/rest/v1/appointments?id=eq.' + encodeFilter(target.id)
    + '&tenant_id=eq.' + encodeFilter(context.tenant.id) + '&status=eq.' + encodeFilter(target.status), payload);
  if (saved.length !== 1) throw new Error('Appointment changed during payment report');
  return { updated: true, appointment: saved[0], previous_status: target.status };
}

async function patchSalesMedia(context, eventId, entry) {
  const tenantId = context?.tenant?.id || $json.tenant_id;
  const mediaPath = '/rest/v1/channel_events?tenant_id=eq.' + encodeFilter(tenantId)
    + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
    + '&id=eq.' + encodeFilter(eventId);
  let rows;
  try {
    rows = await supabaseGet(mediaPath + '&select=id,raw_payload&limit=1');
  } catch {
    throw new Error('SALES_MEDIA_PERSISTENCE_FAILED');
  }
  const row = rows?.[0];
  if (!row) throw new Error('SALES_MEDIA_PERSISTENCE_FAILED');
  const existing = row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
    ? row.raw_payload : {};
  let patched;
  try {
    patched = await supabasePatch(mediaPath, {
      raw_payload: {
        ...existing,
        sales_media: [entry],
      },
    });
  } catch {
    throw new Error('SALES_MEDIA_PERSISTENCE_FAILED');
  }
  if (!Array.isArray(patched) || !patched.length) {
    throw new Error('SALES_MEDIA_PERSISTENCE_FAILED');
  }
  return patched;
}

async function saveEvent(event) {
  if (!turn?.messages?.length) return [];
  const ids = turn.messages.map(item => item.event_id).filter(Boolean);
  if (!ids.length) return [];

  // 1. Atualização dos campos top-level legítimos do turno nas mensagens inbound.
  // CRÍTICO: NUNCA incluir raw_payload aqui, preservando o envelope e a identidade original de cada mensagem.
  // CRÍTICO: NUNCA incluir ai_error top-level em mensagens inbound!
  // O ai_error canônico top-level pertence exclusivamente ao evento OUTBOUND (ou technical_error).
  // 1 falha lógica = exatamente 1 registro no banco com ai_error top-level preenchido.
  const batchPayload = {
    service: event.service || 'geral',
    stage: event.stage || 'Conversas IA',
    handoff: Boolean(event.handoff),
    ai_provider: event.ai_provider || 'rules',
    ai_model: event.ai_model || null,
    response_text: null,
  };

  const saved = await supabasePatch(
    '/rest/v1/channel_events?tenant_id=eq.' + encodeFilter($json.tenant_id)
      + '&id=in.(' + ids.map(encodeFilter).join(',') + ')',
    batchPayload
  );

  // 2. Persistência individual de sales_media: cada mídia classificada fica
  // estritamente no evento daquela mídia (foto ou documento), sem poluir mensagens de texto vizinhas.
  // CRÍTICO: sales_media NÃO PODE FALHAR SILENCIOSAMENTE.
  // Se a persistência falhar, lança SALES_MEDIA_PERSISTENCE_FAILED antes de responder ao cliente,
  // impedindo falsas confirmações, impedindo avanço indevido de avaliação e acionando o fallback seguro.
  const salesMedia = Array.isArray(event.raw_payload?.sales_media) ? event.raw_payload.sales_media : [];
  for (const item of salesMedia) {
    if (!item?.event_id) continue;
    const entry = {
      event_id: item.event_id,
      kind: item.kind,
      readable: Boolean(item.readable),
      ...(item.extracted && typeof item.extracted === 'object' && Object.keys(item.extracted).length ? { extracted: item.extracted } : {}),
    };
    await patchSalesMedia(null, item.event_id, entry);
  }

  return saved;
}

function textReplyAuditPayload(rawPayload = {}) {
  // A text reply must never inherit the inbound channel envelope. In particular,
  // copying `media` or the Evolution message body turns a customer photo into an
  // attachment on the assistant event when the frontend materializes history.
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  const {
    media,
    magia_normalized,
    magia_operator,
    data,
    message,
    messageType,
    message_type,
    imageMessage,
    audioMessage,
    videoMessage,
    documentMessage,
    stickerMessage,
    media_processing,
    sales_media,
    audio_transcriptions,
    audio_processing,
    ...audit
  } = payload;
  return {
    ...audit,
    message_origin: 'assistant_text_reply',
  };
}

async function contactExclusionStatus(context) {
  const settings = settingsFor(context);
  if (settings.contact_exclusion_enabled !== true && settings.contact_exclusion_enabled !== 'true') {
    return { blocked: false, reason: 'disabled' };
  }
  try {
    const result = await supabasePost('/rest/v1/rpc/magia_contact_exclusion_status', {
      p_tenant: context.tenant.id,
      p_chat: chatId,
    });
    if (typeof result?.blocked !== 'boolean') throw new Error('Invalid exclusion response');
    if (result.resolved_phone && turn) turn.exclusion_phone = result.resolved_phone;
    return result;
  } catch (_) {
    // A failed guard is not permission to contact a protected number.
    return { blocked: true, reason: 'contact_exclusion_unavailable' };
  }
}

async function recordContactExclusion(context, decision) {
  await saveEvent({
    service: 'contact_excluded',
    stage: 'Atendimento humano',
    handoff: true,
    ai_provider: 'contact_exclusion',
    ai_error: decision.reason === 'contact_excluded' ? '' : decision.reason,
    raw_payload: { contact_exclusion: { blocked: true, reason: decision.reason } },
  });
  if (turn?.messages?.length) {
    for (const item of turn.messages) {
      if (!item?.event_id) continue;
      const mediaPath = '/rest/v1/channel_events?tenant_id=eq.' + encodeFilter(context?.tenant?.id || $json.tenant_id)
        + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
        + '&id=eq.' + encodeFilter(item.event_id);
      try {
        const rows = await supabaseGet(mediaPath + '&select=id,raw_payload&limit=1');
        const existing = rows?.[0]?.raw_payload || {};
        await supabasePatch(mediaPath, {
          raw_payload: {
            ...existing,
            ...(turn.exclusion_phone ? { exclusion_phone: turn.exclusion_phone } : {}),
            contact_exclusion: { blocked: true, reason: decision.reason },
          },
        });
      } catch {}
    }
  }
}

async function cancelPendingFollowUps(context, reason = 'customer_disposition_not_awaiting') {
  try {
    await supabasePatch('/rest/v1/follow_up_jobs?tenant_id=eq.' + encodeFilter(context.tenant.id)
      + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
      + '&status=eq.pending', {
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        error: reason,
      });
  } catch {}
}

async function scheduleFollowUps(context, sentEvent, event) {
  const settings = settingsFor(context);
  if (salesEnabled(context)) {
    const disposition = event.raw_payload?.follow_up_disposition;
    if (['closed_by_customer', 'declined', 'resolved', 'deferred_by_customer'].includes(disposition)) {
      await cancelPendingFollowUps(context, disposition);
      return 0;
    }
    if (settings.follow_up_enabled !== true || !settings.sales_follow_up?.enabled
      || event.service !== 'sales_qualification' || event.raw_payload?.interest_registered
      || disposition !== 'awaiting_customer') return 0;
  }
  // The policy controls activation in the database. Never enqueue human handoffs,
  // payment flows, closed conversations, or a reply that failed to persist.
  if (!sentEvent?.id || event.handoff || ['agendamento', 'pagamento_sinal', 'conversation_closed'].includes(event.service)) return 0;
  if (settings.follow_up_enabled === false) return 0;
  const result = await httpJson('POST', supabaseUrl('/rest/v1/rpc/magia_schedule_followups'), supabaseHeaders(), {
    p_tenant: context.tenant.id,
    p_channel: 'whatsapp',
    p_chat: chatId,
    p_anchor: sentEvent.id,
    p_contact: turn.messages.at(-1)?.name || firstName || null,
  });
  return Number(result || 0);
}

async function sendChannelMessage(context, text, event) {
  const suffix = tenantEnvSuffix(tenantSlug);
  const base = env('EVOLUTION_API_URL_' + suffix).replace(/\/$/, '');
  const key = env('EVOLUTION_API_KEY_' + suffix);
  const instance = env('EVOLUTION_INSTANCE_' + suffix);
  if (!base || !key || instance !== $json.instance) throw new Error('Tenant Evolution credentials unavailable or mismatched');
  const boundary = await supabaseGet('/rest/v1/channel_events?select=id&tenant_slug=eq.' + encodeFilter(tenantSlug)
    + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
    + '&or=(service.eq.conversation_closed,ai_provider.eq.conversation_closed,ai_provider.eq.conversation_reset)'
    + '&order=created_at.desc,id.desc&limit=1');
  if (String(boundary[0]?.id || 'initial') !== turn.boundary_id && event.ai_provider !== 'conversation_reset') {
    return { cancelled: true };
  }
  const humanChanges = await supabaseGet('/rest/v1/channel_events?select=id&tenant_slug=eq.' + encodeFilter(tenantSlug)
    + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeFilter(chatId)
    + '&created_at=gt.' + encodeFilter(new Date(workflowStartedAtMs).toISOString())
    + '&or=(service.eq.conversation_assigned,service.eq.appointment_payment_confirmed,sender_type.eq.human)&limit=1');
  if (humanChanges.length) return { cancelled: true };
  if (salesEnabled(context) && !await salesCanSend(context,event)) return {cancelled:true};
  const exclusion = await contactExclusionStatus(context);
  if (exclusion.blocked) {
    await recordContactExclusion(context, exclusion);
    return { cancelled: true, reason: exclusion.reason };
  }
  const deliveryAttempt = await supabasePost('/rest/v1/rpc/magia_begin_turn_delivery', {
    p_tenant: context.tenant.id, p_chat: chatId, p_token: turn.token,
  });
  if (!deliveryAttempt?.id) throw new Error('DELIVERY_ATTEMPT_NOT_PERSISTED');
  deliveryAttemptId = String(deliveryAttempt.id);
  sendAttempted = true;
  const sent = await httpJson('POST', base + '/message/sendText/' + encodeFilter(instance),
    { apikey: key, 'Content-Type': 'application/json' }, { number: chatId, text });
  const id = sent?.key?.id || sent?.message?.key?.id || sent?.id;
  if (!id) throw new Error('Provider response did not contain message ID');
  providerAccepted = true;
  const saved = await supabasePost('/rest/v1/channel_events', {
    tenant_id: context.tenant.id, tenant_slug: tenantSlug, channel_type: 'whatsapp',
    external_conversation_id: chatId, external_message_id: String(id), direction: 'outbound',
    sender_type: 'assistant', message_text: text, contact_name: turn.messages.at(-1)?.name || firstName,
    service: event.service, stage: event.stage, handoff: event.handoff, ai_provider: event.ai_provider,
    ai_model: event.ai_model || null, delivery_status: 'sent', response_text: null,
    ai_error: event.ai_error ? String(event.ai_error).slice(0, 300) : '',
    ai_usage: event.ai_usage || {},
    ...(event.sent_by_user ? { sent_by_user: event.sent_by_user } : {}),
    raw_payload: { ...textReplyAuditPayload(event.raw_payload), core_revision: coreRevision,
      delivery_attempt_id: deliveryAttemptId,conversation_session_id: turn.boundary_id,
      grouped_message_ids: turn.messages.map(item => item.id) },
  });
  const sentEvent = Array.isArray(saved) ? saved[0] : saved;
  const confirmation = await supabasePost('/rest/v1/rpc/magia_confirm_turn_delivery', {
    p_tenant: context.tenant.id,p_chat: chatId,p_token: turn.token,p_attempt: deliveryAttemptId,
    p_provider_message: String(id),p_outbound_event: sentEvent?.id || null,
  });
  if (confirmation?.confirmed !== true) throw new Error('DELIVERY_CONFIRMATION_NOT_PERSISTED');
  try {
    const followUpsScheduled = await scheduleFollowUps(context, sentEvent, event);
    return { sent: true, id: String(id), follow_ups_scheduled: followUpsScheduled };
  } catch (error) {
    // The primary reply is already sent and persisted. An optional job must not retry it.
    return { sent: true, id: String(id), follow_ups_scheduled: 0,
      follow_up_error: String(error.message || error).slice(0, 180) };
  }
}
