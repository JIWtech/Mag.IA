const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const contextCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_prepare_context.js'), 'utf8');
const sentCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_prepare_sent.js'), 'utf8');
const catalog = [{ category_key: 'pulseiras', label: 'Pulseiras', aliases: ['pulseira', 'pulseiras'], items: [1, 2, 3].map((n) => ({ url: `https://media.example/${n}.jpg` })) }];
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };

async function context(message, { history = [], boundary = null, environment = env, failSettings = false, failPrompt = false, failBoundary = false, tenant = 'loja', chat = 'chat' } = {}) {
  const fn = new AsyncFunction('$json', '$env', '$getWorkflowStaticData', contextCode);
  const json = { tenant_slug: tenant, remoteJid: chat, messageText: message, raw_payload: { apikey: 'do-not-persist' } };
  const httpRequest = async ({ url }) => {
    assert.ok(url.includes(tenant) || url.includes('tenant-test'));
    if (url.includes('/channel_events?') && url.includes('&or=')) {
      assert.ok(url.includes('&channel_type=eq.whatsapp'));
      assert.ok(url.includes('&external_conversation_id=eq.' + encodeURIComponent(chat)));
      if (failBoundary) throw new Error('Timeout');
      return boundary ? [boundary] : [];
    }
    if (url.includes('/channel_events?')) return history;
    if (url.includes('/tenants?')) return [{ id: 'tenant-test' }];
    if (url.includes('/tenant_settings?')) {
      if (failSettings) throw Object.assign(new Error('permission denied'), { statusCode: 403 });
      return [{ settings: { product_media_catalog: catalog, system_prompt: 'Prompt do cliente', commerce_mode: true } }];
    }
    if (url.includes('/ai_agents?')) return [];
    if (url.includes('/ai_prompt_versions?')) {
      if (failPrompt) throw Object.assign(new Error('missing table'), { statusCode: 404 });
      return [];
    }
    throw Error('Unexpected request');
  };
  return (await fn.call({ helpers: { httpRequest } }, json, environment, () => ({}))).json;
}

test('explicit category selects three media items and strips incoming API key', async () => {
  const result = await context('quero ver pulseiras');
  assert.equal(result.product_media_matches.length, 3);
  assert.equal(result.catalog_diagnostics.selection_source, 'current_message');
  assert.equal(result.raw_payload.apikey, undefined);
});
test('resend recovers category from inbound history even when previous send selected nothing', async () => {
  const result = await context('manda de novo', { history: [{ direction: 'inbound', message_text: 'pulseiras', raw_payload: {} }] });
  assert.equal(result.product_media_matches.length, 3);
  assert.equal(result.catalog_diagnostics.selection_source, 'conversation_history');
});
test('does not infer category from assistant text or a closed session', async () => {
  for (const history of [
    [{ direction: 'outbound', message_text: 'pulseiras' }],
    [{ service: 'conversation_closed' }, { direction: 'inbound', message_text: 'pulseiras' }],
  ]) {
    assert.equal((await context('manda de novo', { history })).product_media_matches.length, 0);
  }
});
test('missing runner env and settings errors are visible in persisted diagnostics', async () => {
  const missing = await context('pulseiras', { environment: {} });
  assert.equal(missing.catalog_diagnostics.context_load_errors[0].step, 'missing_supabase_env_in_code_node');
  const denied = await context('pulseiras', { failSettings: true });
  assert.deepEqual(denied.catalog_diagnostics.context_load_errors, [{ step: 'tenant_settings', status: 403 }]);
  assert.ok(denied.promptText.includes('Nao prometa enviar fotos'));
});
test('prompt lookup failure preserves tenant settings prompt and catalog', async () => {
  const result = await context('pulseiras', { failPrompt: true });
  assert.equal(result.systemMessage, 'Prompt do cliente');
  assert.equal(result.product_media_matches.length, 3);
});
test('payment acknowledgement keeps payment stage and does not send a catalog', async () => {
  const result = await context('SINAL PAGO pulseiras');
  assert.equal(result.stage, 'Verificar Sinal');
  assert.equal(result.handoff, true);
  assert.equal(result.ai_allowed, false);
  assert.equal(result.product_media_matches.length, 0);
});
test('media sender uses tenant credentials and records partial failures without dropping text', async () => {
  const base = await context('pulseiras');
  base.responseText = 'Aqui estao as opcoes';
  base.phone = '5500000000000';
  base.instance = 'loja';
  let calls = 0;
  const fn = new AsyncFunction('$json', '$env', '$', sentCode);
  const result = await fn.call({ helpers: { httpRequest: async (request) => {
    assert.equal(request.headers.apikey, 'tenant-key');
    assert.equal(request.url, 'https://evolution.example/message/sendMedia/loja');
    if (++calls === 2) throw Object.assign(new Error('private failure detail'), { statusCode: 429 });
    return { key: { id: `media-${calls}` } };
  } } }, { key: { id: 'text-1' } }, {
    EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'tenant-key',
  }, () => ({ item: { json: base } }));
  assert.equal(calls, 3);
  assert.equal(result.json.messageText, base.responseText);
  assert.deepEqual(result.json.raw_payload.product_media_delivery.sent.map((x) => x.status), ['accepted', 'failed', 'accepted']);
});
test('generated workflow embeds exactly the tested source', () => {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/magia_whatsapp_evolution_mvp.json'), 'utf8'));
  assert.equal(w.nodes.find((n) => n.name === 'Preparar Contexto JIW').parameters.jsCode, contextCode.trimEnd());
  assert.equal(w.nodes.find((n) => n.name === 'Preparar Evento Enviado').parameters.jsCode, sentCode.trimEnd());
  for (const node of w.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) new AsyncFunction(node.parameters.jsCode);
});

const closed = { id: 'close-1', service: 'conversation_closed', created_at: '2026-09-21T15:00:00Z' };
test('open conversations without a close event keep their existing Redis memory', async () => {
  const result = await context('oi');
  assert.equal(result.memory_session_key, 'magia:chat:loja:chat');
});
test('closing an attendance changes Redis session and excludes old context', async () => {
  const old = { direction: 'inbound', message_text: 'pulseiras', created_at: '2026-09-21T14:59:00Z' };
  const before = await context('oi', { history: [old] });
  const after = await context('manda de novo', { history: [closed, old], boundary: closed });
  assert.notEqual(before.memory_session_key, after.memory_session_key);
  assert.equal(after.hasHistory, false);
  assert.equal(after.product_media_matches.length, 0);
  assert.equal(after.handoff, false);
  assert.equal(after.ai_allowed, true);
});
test('session stays stable after the close event leaves the 40-event history window', async () => {
  const first = await context('oi', { boundary: closed });
  const later = await context('pulseiras', { boundary: closed, history: Array.from({ length: 40 }, () => ({ created_at: '2026-09-21T15:05:00Z', message_text: 'oi' })) });
  assert.equal(first.memory_session_key, later.memory_session_key);
  assert.equal(later.hasHistory, true);
});
test('new close rotates again; other tenants and contacts have different keys', async () => {
  const first = await context('oi', { boundary: closed });
  const second = await context('oi', { boundary: { ...closed, id: 'close-2' } });
  const otherTenant = await context('oi', { boundary: closed, tenant: 'outro' });
  const otherContact = await context('oi', { boundary: closed, chat: 'outro' });
  assert.equal(new Set([first, second, otherTenant, otherContact].map((r) => r.memory_session_key)).size, 4);
});
test('boundary lookup failure never invokes Gemini with old memory', async () => {
  const result = await context('oi', { failBoundary: true });
  assert.equal(result.ai_allowed, false);
  assert.equal(result.ai_block_reason, 'conversation_state_unavailable');
});
test('pre-send guard discards replies generated before closing and permits current replies', async () => {
  const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_validate_session.js'), 'utf8');
  const fn = new AsyncFunction('$json', '$env', code);
  const base = await context('oi', { boundary: closed });
  for (const [latest, expected] of [[closed, true], [{ ...closed, id: 'close-2' }, false]]) {
    const result = await fn.call({ helpers: { httpRequest: async () => [latest] } }, base, env);
    assert.equal(result.json.should_send_response, expected);
  }
  const failed = await fn.call({ helpers: { httpRequest: async () => { throw Error('unavailable'); } } }, base, env);
  assert.equal(failed.json.should_send_response, false);
});
test('workflow uses the computed Redis key and all sends pass through the session guard', () => {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/magia_whatsapp_evolution_mvp.json'), 'utf8'));
  assert.equal(w.nodes.find((n) => n.name === 'Memoria Redis da Conversa').parameters.sessionKey, '={{ $json.memory_session_key }}');
  assert.equal(w.connections['Restaurar Contexto para Envio'].main[0][0].node, 'Validar Sessao Antes do Envio');
  assert.equal(w.connections['Sessao ainda ativa?'].main[1][0].node, 'Responder Resposta Cancelada');
  const sendParents = Object.entries(w.connections).filter(([, connections]) => connections.main?.flat().some((edge) => edge.node === 'Enviar Resposta pela Evolution')).map(([name]) => name);
  assert.deepEqual(sendParents, ['Sessao ainda ativa?']);
});
