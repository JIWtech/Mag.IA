// Runs from the shared schedule workflow. All writes are fenced by the lease
// returned by magia_claim_followup_jobs, so concurrent n8n executions cannot send twice.
function env(name, fallback = '') {
  try { return String($env[name] || fallback).trim(); } catch (_) { return fallback; }
}
function suffix(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
function trimText(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function parseReply(value) {
  const text = String(value || '').trim();
  try {
    const parsed = JSON.parse(text);
    return trimText(parsed.reply || parsed.text || '');
  } catch (_) {
    const match = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    return trimText(match ? JSON.parse('"' + match[1] + '"') : text.replace(/^```(?:json)?|```$/g, ''));
  }
}
async function request(method, url, headers = {}, body = undefined) {
  return this.helpers.httpRequest({ method, url, headers, ...(body === undefined ? {} : { body }), json: true, timeout: 30000 });
}

const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente');
const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
const rpc = (name, payload) => request.call(this, 'POST', supabaseUrl + '/rest/v1/rpc/' + name, headers, payload);
const get = path => request.call(this, 'GET', supabaseUrl + '/rest/v1/' + path, headers);
const post = (path, body) => request.call(this, 'POST', supabaseUrl + '/rest/v1/' + path, { ...headers, Prefer: 'return=representation' }, body);

async function finish(job, status, eventId = null, error = '') {
  return rpc('magia_finish_followup_job', { p_job: job.id, p_lease: job.lease_token, p_status: status, p_event: eventId, p_error: error });
}

async function conversationChanged(job) {
  const rows = await get('channel_events?select=direction,sender_type,handoff,service,ai_provider,created_at'
    + '&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
    + '&channel_type=eq.' + encodeURIComponent(job.channel_type)
    + '&external_conversation_id=eq.' + encodeURIComponent(job.external_conversation_id)
    + '&created_at=gt.' + encodeURIComponent(job.anchor_created_at)
    + '&order=created_at.asc&limit=100');
  return Array.isArray(rows) && rows.some(row =>
    (row.direction === 'inbound' && row.sender_type === 'contact') || row.handoff === true
    || row.service === 'conversation_closed' || row.ai_provider === 'conversation_closed');
}

async function generate(job, settings, history) {
  const model = String(settings.ai_model || env('GEMINI_MODEL', 'gemini-2.5-flash')).trim();
  const apiKey = env('GEMINI_API_KEY');
  const prompt = String(settings.system_prompt || '').trim();
  if (!apiKey || !prompt || !/^gemini-[a-z0-9.-]+$/i.test(model)) throw new Error('Prompt, modelo ou GEMINI_API_KEY ausente');
  const input = {
    mode: 'follow_up', step: job.step_key, objective: job.objective, contact_name: job.contact_name || '',
    conversation: history.map(row => ({ direction: row.direction, text: row.message_text, at: row.created_at })),
    rules: [
      'Escreva uma unica mensagem curta, em portugues do Brasil.',
      'Respeite integralmente a personalidade, fatos e limites do system prompt.',
      'Nao invente preco, disponibilidade, desconto, endereco ou pagamento.',
      'Nao diga que o cliente sumiu e nao mencione tempo de espera.',
      'Nao envie se a conversa exigir humano, pagamento, cancelamento ou remarcacao.',
      'Retorne JSON com apenas a chave reply.'
    ],
  };
  const body = await request.call(this, 'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, {
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 500, responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { reply: { type: 'STRING' } }, required: ['reply'] } },
    });
  const candidate = body?.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'STOP') throw new Error('Gemini nao concluiu o follow-up');
  const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
  const reply = parseReply(text);
  if (!reply || reply.length > 900 || /\[HUMANO_SOLICITADO\]|\[ACAO:/i.test(reply)) throw new Error('Resposta de follow-up invalida');
  return { reply, model, usage: body.usageMetadata || {} };
}

const jobs = await rpc('magia_claim_followup_jobs', { p_limit: 20 });
const outcome = [];
for (const job of Array.isArray(jobs) ? jobs : []) {
  try {
    if (await conversationChanged(job)) {
      await finish(job, 'cancelled', null, 'conversation_control_changed');
      outcome.push({ id: job.id, status: 'cancelled' });
      continue;
    }
    const [settingsRows, history, channelRows] = await Promise.all([
      get('tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(job.tenant_id) + '&limit=1'),
      get('channel_events?select=direction,message_text,created_at&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
        + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeURIComponent(job.external_conversation_id)
        + '&order=created_at.desc&limit=16'),
      get('channels?select=external_id,config&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
        + '&type=eq.whatsapp&status=eq.active&limit=1'),
    ]);
    const settings = settingsRows?.[0]?.settings || {};
    const channel = channelRows?.[0];
    if (!channel?.external_id) throw new Error('Canal WhatsApp ativo nao encontrado');
    const generated = await generate.call(this, job, settings, Array.isArray(history) ? history.reverse() : []);
    if (await conversationChanged(job)) {
      await finish(job, 'cancelled', null, 'conversation_control_changed_before_send');
      outcome.push({ id: job.id, status: 'cancelled' });
      continue;
    }
    const tenantSuffix = suffix(job.tenant_slug);
    const base = env('EVOLUTION_API_URL_' + tenantSuffix).replace(/\/$/, '');
    const key = env('EVOLUTION_API_KEY_' + tenantSuffix);
    const instance = env('EVOLUTION_INSTANCE_' + tenantSuffix);
    if (!base || !key || instance !== channel.external_id) throw new Error('Credenciais Evolution do tenant nao configuradas');
    const sent = await request.call(this, 'POST', base + '/message/sendText/' + encodeURIComponent(instance),
      { apikey: key, 'Content-Type': 'application/json' }, { number: String(job.external_conversation_id).replace(/@s\.whatsapp\.net$/, ''), text: generated.reply });
    const messageId = sent?.key?.id || sent?.message?.key?.id || sent?.id;
    if (!messageId) throw new Error('Evolution nao retornou o id da mensagem');
    const saved = await post('channel_events', {
      tenant_id: job.tenant_id, tenant_slug: job.tenant_slug, channel_type: 'whatsapp', external_conversation_id: job.external_conversation_id,
      external_message_id: String(messageId), direction: 'outbound', sender_type: 'assistant', contact_name: job.contact_name || 'Contato',
      message_text: generated.reply, service: 'follow_up', stage: 'Follow-up ' + job.step_key, handoff: false,
      ai_provider: 'gemini_follow_up', ai_model: generated.model, ai_usage: generated.usage, delivery_status: 'sent',
      raw_payload: { follow_up: { job_id: job.id, step_key: job.step_key, objective: job.objective, anchor_event_id: job.anchor_event_id } },
    });
    const event = Array.isArray(saved) ? saved[0] : saved;
    await finish(job, 'sent', event?.id || null);
    outcome.push({ id: job.id, status: 'sent', step: job.step_key });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    // Sending can have unknown delivery after a transport failure; do not retry it blindly.
    const status = /Evolution|retornou o id/i.test(message) ? 'uncertain' : 'failed';
    await finish(job, status, null, message).catch(() => {});
    outcome.push({ id: job.id, status, error: message });
  }
}
return outcome.map(item => ({ json: item }));
