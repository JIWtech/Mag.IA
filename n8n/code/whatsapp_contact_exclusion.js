async function contactExclusionStatus(context) {
  const settings = settingsFor(context);
  if (settings.contact_exclusion_enabled !== true && settings.contact_exclusion_enabled !== 'true') {
    return { blocked: false, reason: 'disabled' };
  }
  try {
    const result = await supabasePost('/rest/v1/rpc/magia_contact_exclusion_status', {
      p_tenant: context.tenant.id, p_chat: chatId,
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
  await saveEvent({ service: 'contact_excluded', stage: 'Atendimento humano', handoff: true,
    ai_provider: 'contact_exclusion', ai_error: decision.reason === 'contact_excluded' ? '' : decision.reason,
    raw_payload: { contact_exclusion: { blocked: true, reason: decision.reason } } });
}
