const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
const text = String(input.messageText || '').trim();
const isFragment = text.split(/\s+/).length <= 2 && !/[?!.]$/.test(text);
const quiet = Math.max(input.core_quiet_ms, isFragment ? input.core_fragment_ms : 0);
const queued = await this.helpers.httpRequest({ method: 'POST',
  url: base + '/rest/v1/rpc/magia_enqueue_turn',
  headers: { apikey: key, Authorization: 'Bearer ' + key },
  body: { p_tenant: input.tenant_id, p_chat: input.remoteJid, p_instance: input.instance,
    p_quiet_ms: quiet, p_message: { id: input.messageId, text, name: input.contactName,
      raw: { channel_type: 'whatsapp', content_type: input.contentType, core_revision: 'conversation_core_v1' } } },
  json: true, timeout: 10000,
});
return { json: { ...input, queued, core_wait_seconds: Math.ceil(quiet / 1000) + 1 } };
