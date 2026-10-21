// NORIA — despachante genérico de turno (infraestrutura compartilhada).
// Fonte canônica; gerado em um nó do workflow CORE por scripts/build_noria_workflows.cjs.
// Faz SÓ o que independe de vertical: pré-voo do ciclo de vida da fila, um único magia_claim_turn, verificação da identidade
// do claim e composição de request_id = <event_id da última mensagem>:<token>. Não lê estoque, leads, catálogo nem política
// comercial, e não envia nem reserva nada. O nó específico da Gênesis permanece como está.
const input = $json || {};
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
const policy = isObj(input.noria_client_policy) ? input.noria_client_policy : {};
const pipeline = isObj(policy.modules) && isObj(policy.modules.turn_pipeline) ? policy.modules.turn_pipeline : null;
if (policy.contract !== 'noria_policy_v2' || policy.tenant_id !== input.tenant_id || policy.tenant_slug !== input.tenant_slug
  || !pipeline || pipeline.contract !== 'noria_turn_pipeline_v1'
  || typeof pipeline.contract_version !== 'string' || !pipeline.contract_version || typeof pipeline.capability !== 'string' || !pipeline.capability) throw new Error('NORIA_TURN_DISPATCH_POLICY_INVALID');
if (!input.tenant_id || !input.remoteJid || !input.instance) throw new Error('NORIA_TURN_DISPATCH_IDENTITY_INCOMPLETE');
// A turn that already carries a claim is never claimed again by a second dispatch.
if (input.noria_preclaimed_turn !== undefined) throw new Error('NORIA_TURN_ALREADY_CLAIMED');
const base = String($env.SUPABASE_URL || '').replace(/\/$/, ''), key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_TURN_DISPATCH_DB_UNAVAILABLE');
const headers = { apikey: key, Authorization: 'Bearer ' + key };
const post = (endpoint, body) => this.helpers.httpRequest({ method: 'POST', url: base + '/rest/v1/' + endpoint, headers, body, json: true, timeout: 7000 });
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint, headers, json: true, timeout: 7000 });
let claim = null;
try {
  // lifecycle-deployment-preflight: read-only and before any claim.
  if (!String($env['NORIA_INGRESS_FORWARD_TOKEN_' + String(input.tenant_slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')] || '')) throw new Error('TURN_INGRESS_CONFIG_REQUIRED');
  let readiness;
  try { readiness = await get('rpc/magia_turn_lifecycle_status'); }
  catch (error) { throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:' + String(error?.message || error).slice(0, 160)); }
  if (readiness?.ready !== true || readiness.contract !== 'noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');
  claim = await post('rpc/magia_claim_turn', { p_tenant: input.tenant_id, p_chat: input.remoteJid });
  if (!claim?.claimed) {
    return { json: { ...input, ok: true, skipped: true, noria_terminal: true, reason: String(claim?.reason || 'queue_empty'),
      noria_preclaimed_turn: claim, noria_dispatch_phase: 'turn', noria_dispatch_skip: 'queue_empty' } };
  }
  if (claim.contract !== 'noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_RPC_MISMATCH');
  const sessionId = String(claim.boundary_id || '');
  const messages = Array.isArray(claim.messages) ? claim.messages : [];
  if (!sessionId || !messages.length || !String(claim.token || '')) throw new Error('NORIA_TURN_DISPATCH_CLAIM_INVALID');
  // The claim must belong to the tenant and the authenticated instance this dispatch was invoked for.
  if (String(claim.tenant_slug || '') !== String(input.tenant_slug) || String(claim.instance || '') !== String(input.instance)) throw new Error('NORIA_TURN_DISPATCH_CLAIM_SCOPE_MISMATCH');
  const last = messages.at(-1);
  const lastEventId = String(last?.event_id || last?.id || '');
  if (!lastEventId) throw new Error('NORIA_TURN_DISPATCH_CLAIM_INVALID');
  const requestId = lastEventId + ':' + String(claim.token);
  // Pin: the batch stays with this pipeline for as long as it is in flight (the router reads this marker; a retry never switches version).
  // A marker event with a deterministic key is the only durable place that needs no schema change; it is written once per batch.
  const pinKey = 'noria_pin_' + pipeline.contract_version + '_' + lastEventId;
  const scope = 'tenant_id=eq.' + encodeURIComponent(input.tenant_id) + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeURIComponent(input.remoteJid);
  const existingPin = await get('channel_events?select=id&' + scope + '&external_message_id=eq.' + encodeURIComponent(pinKey) + '&limit=1');
  if (!Array.isArray(existingPin)) throw new Error('NORIA_TURN_PIPELINE_PIN_NOT_PERSISTED');
  if (!existingPin.length) {
    const saved = await this.helpers.httpRequest({ method: 'POST', url: base + '/rest/v1/channel_events', headers: { ...headers, Prefer: 'return=representation' }, json: true, timeout: 7000, body: {
      tenant_id: input.tenant_id, tenant_slug: input.tenant_slug, channel_type: 'whatsapp', external_conversation_id: input.remoteJid, external_message_id: pinKey,
      direction: 'outbound', sender_type: 'system', message_text: '', service: 'noria_pipeline_pin', stage: 'Pipeline', handoff: false, ai_provider: 'noria_turn_dispatch',
      delivery_status: 'internal', raw_payload: { contract: 'noria_pipeline_pin_v1', version: pipeline.contract_version, capability: pipeline.capability, request_id: requestId, session_id: sessionId } } });
    if (!(Array.isArray(saved) ? saved[0] : saved)?.id) throw new Error('NORIA_TURN_PIPELINE_PIN_NOT_PERSISTED');
  }
  return { json: { ...input, noria_dispatch_phase: 'turn', noria_preclaimed_turn: claim, noria_dispatch_skip: '',
    noria_business_context: { contract: 'noria_business_result_v1', tenant_slug: input.tenant_slug, phase: 'turn', operation: 'conversation.evaluate',
      session_id: sessionId, request_id: requestId, provenance: 'noria_turn_dispatch_v1' } } };
} catch (error) {
  // turn-dispatch-lifecycle-v1: no blind retry or swallowed persistence error.
  const status = Number(error?.statusCode || error?.response?.status || error?.response?.statusCode || 0);
  const retryable = status === 429 || (status >= 500 && status <= 599)
    || ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(error?.code || ''));
  let finish = { retry_queued: false, finish_persisted: false };
  if (claim?.claimed && String(claim.token || '')) {
    try {
      const result = await post('rpc/magia_fail_turn', { p_tenant: input.tenant_id, p_chat: input.remoteJid, p_token: claim.token, p_error: String(error?.message || 'dispatch_preparation_failed').slice(0, 300), p_retryable: retryable });
      if (result?.finished !== true || result.contract !== 'noria_turn_lifecycle_v1') throw new Error('TURN_FAILURE_NOT_PERSISTED');
      finish = { ...result, finish_persisted: true };
    } catch (finishError) { finish.finish_error = String(finishError?.message || finishError).slice(0, 300); }
  }
  return { json: { ...input, ok: false, skipped: true, noria_terminal: true, noria_preclaimed_turn: claim || { claimed: false, reason: 'dispatch_preparation_failed' },
    noria_dispatch_phase: 'turn', noria_dispatch_skip: 'preparation_failed',
    noria_dispatch_error: { code: 'TURN_DISPATCH_PREPARATION_FAILED', retryable, message: String(error?.message || error).slice(0, 300), ...finish } } };
}
