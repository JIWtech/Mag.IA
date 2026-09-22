const base = $json;
function env(name) {
  try { return String($env[name] || ''); } catch (_) { return ''; }
}
const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
let shouldSend = false;
let reason = 'conversation_state_unavailable';
if (base.conversation_state_ok && supabaseUrl && serviceKey) {
  try {
    const rows = await this.helpers.httpRequest({
      method: 'GET',
      url: supabaseUrl + '/rest/v1/channel_events?select=id,created_at'
        + '&tenant_slug=eq.' + encodeURIComponent(base.tenant_slug)
        + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeURIComponent(base.remoteJid)
        + '&or=(service.eq.conversation_closed,ai_provider.eq.conversation_closed,ai_provider.eq.conversation_reset,stage.eq.Reset,stage.eq.reset,message_text.eq.%2Freset)'
        + '&order=created_at.desc,id.desc&limit=1',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      json: true, timeout: 5000,
    });
    if (!Array.isArray(rows)) throw new Error('Invalid conversation boundary response');
    const sessionId = String(rows[0]?.id || 'initial');
    shouldSend = sessionId === base.conversation_session_id;
    reason = shouldSend ? '' : 'conversation_closed_during_processing';
  } catch (_) {
    reason = 'conversation_state_unavailable';
  }
}
return { json: { ...base, should_send_response: shouldSend, response_discard_reason: reason } };
