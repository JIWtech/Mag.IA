const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
let text = String(input.messageText || '').trim();
const mediaMessage=input.raw_payload?.data?.message || {};
const salesMedia=input.core_sales ? (mediaMessage.imageMessage?'image':mediaMessage.documentMessage?'document':'') : '';
if (salesMedia && !text.startsWith('['+salesMedia+']')) text='['+salesMedia+']\n'+text;
const audio = input.raw_payload?.data?.message?.audioMessage || {};
const isFragment = text.split(/\s+/).length <= 2 && !/[?!.]$/.test(text);
const quiet = Math.max(input.core_quiet_ms, isFragment ? input.core_fragment_ms : 0);
const queued = await this.helpers.httpRequest({ method: 'POST',
  url: base + '/rest/v1/rpc/magia_enqueue_turn',
  headers: { apikey: key, Authorization: 'Bearer ' + key },
  body: { p_tenant: input.tenant_id, p_chat: input.remoteJid, p_instance: input.instance,
    p_quiet_ms: quiet, p_message: { id: input.messageId, text, name: input.contactName,
      raw: { channel_type: 'whatsapp', content_type: input.contentType, core_revision: 'conversation_core_v1',
        ...(salesMedia ? {sales_media_type:salesMedia} : {}),
        ...(input.contentType === 'audio' ? {audio_metadata:{seconds:Number(audio.seconds)||0,bytes:Number(audio.fileLength)||0}} : {}) } } },
  json: true, timeout: 10000,
});
return { json: { ...input, queued, core_wait_seconds: Math.ceil(quiet / 1000) + 1 } };
