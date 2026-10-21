// Regressão do hotfix P1 (continuidade e handoff): funções REAIS do CORE gerado e do EXT, executadas pelo executor de homologação com respostas
// do modelo simuladas. Cobre: handoff anunciado sem execução, pergunta atual antes da coleta pendente, recuperação limitada e rejeição preservada.
// Rodar: node --test scripts/test_genesis_dialogue_recovery.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const contract = (over = {}) => ({ fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false, ...over });

async function engine(names) {
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'return { ' + names.join(',') + ' };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}

test('a coleta pendente só é exigida quando o pedido atual é a própria coleta; visita, humano, pagamento etc. são perguntas atuais', async () => {
  const core = await engine(['salesValidatePrimaryDialogue']);
  const collection = { active: true, ready: false, next_field: 'customer_name', missing_fields: ['customer_name'] };
  const issuesFor = topic => core.salesValidatePrimaryDialogue({ primary_reply: 'Pode ir na quinta, estamos aguardando.', state: {}, primary_facts: [], response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: 'Pode ir na quinta' }] }) },
    { requests: [{ id: 'request_1', topic }], next_requirement: 'customer_name', handoff_reason: 'none' }, collection, { handoff_claim_required: true, handoff_dispatched: false }).issues;
  for (const topic of ['visit', 'human', 'payment', 'sale', 'other', 'price', 'location']) assert.ok(!issuesFor(topic).includes('MISSING_COLLECTION_QUESTION:customer_name'), topic + ' é pedido atual e vem antes da coleta');
  for (const topic of ['name', 'documents', 'purchase']) assert.ok(issuesFor(topic).includes('MISSING_COLLECTION_QUESTION:customer_name'), topic + ' é a própria coleta: a pergunta continua exigida');
});

test('anunciar transferência sem execução continua rejeitado; com execução confirmada é aceito', async () => {
  const core = await engine(['salesValidatePrimaryDialogue']);
  const audit = dispatched => core.salesValidatePrimaryDialogue({ primary_reply: 'Vou chamar um atendente.', state: {}, primary_facts: [], response_contract: contract({ handoff_announced: true }) },
    { requests: [], next_requirement: 'none', handoff_reason: 'none' }, { active: false }, { handoff_claim_required: true, handoff_dispatched: dispatched }).issues;
  assert.ok(audit(false).includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
  assert.ok(!audit(true).includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
});

async function run(turnSpec, repairs) {
  const scenario = { name: 'recovery', turns: [{ text: 'Air-bag acionado no painel \nE luz de injeção', gemini: turnSpec }], auditor_responses: repairs };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory });
  const outbound = result.world.tables.channel_events.filter(row => row.direction === 'outbound').at(-1);
  return { result, outbound, repairCalls: result.world.log.gemini.filter(item => (item.schema_properties || []).includes('reply') && (item.schema_properties || []).includes('response_contract') && !(item.schema_properties || []).includes('semantic_intent')).length };
}
const announced = { reply: 'Vou chamar um atendente para olhar isso.', response_contract: { handoff_announced: true }, semantic_intent: { primary_intent: 'other', topics: ['other'] } };

test('rejeição só comportamental: uma reescrita auditada recupera o atendimento sem anunciar transferência', async () => {
  const repaired = body({ reply: 'Entendi, obrigado por avisar. Posso ajudar com mais alguma informação do veículo?', response_contract: contract({ requested_fields: [{ field: 'x', excerpt: 'Posso ajudar com mais alguma informação do veículo?' }] }) });
  const { outbound, repairCalls } = await run(announced, [repaired]);
  assert.equal(repairCalls, 1, 'exatamente uma reescrita');
  assert.match(outbound.message_text, /Posso ajudar com mais alguma informação/);
  assert.equal(outbound.raw_payload.dialogue_repair?.status, 'accepted', JSON.stringify(outbound.raw_payload.dialogue_repair));
  assert.equal(JSON.stringify(outbound.raw_payload.dialogue_repair.original_issues), JSON.stringify(['UNEXECUTED_HANDOFF_ANNOUNCEMENT']), 'o motivo original fica registrado');
  assert.ok(!outbound.ai_error, 'resposta aceita não carrega erro');
  assert.doesNotMatch(outbound.message_text, /atendente|encaminh|transfer/i);
});

test('a reescrita é auditada pelo mesmo auditor: se repetir o anúncio sem execução, vale o bloqueio e o fallback seguro existente', async () => {
  const again = body({ reply: 'Já estou chamando um atendente.', response_contract: contract({ handoff_announced: true }) });
  const { outbound, repairCalls } = await run(announced, [again]);
  assert.equal(repairCalls, 1, 'nenhuma segunda tentativa');
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'needs_human_review');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.doesNotMatch(outbound.message_text, /Já estou chamando/);
});

test('falha da própria reescrita não derruba o turno: cai no fallback seguro existente', async () => {
  const { outbound } = await run(announced, []);
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'failed');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.ok(outbound.message_text.length > 0);
});

test('rejeição factual não é reescrita pelo modelo (preço inventado continua bloqueado)', async () => {
  const invented = { reply: 'Essa moto custa R$ 99.999,00.', semantic_intent: { primary_intent: 'other', topics: ['other'] } };
  const { outbound, repairCalls } = await run(invented, [body({ reply: 'x', response_contract: contract() })]);
  assert.equal(repairCalls, 0, 'nenhuma reescrita para rejeição de valor');
  assert.match(outbound.ai_error, /UNSUPPORTED_AMOUNT/);
  assert.equal(outbound.raw_payload.dialogue_repair, undefined);
});

// ---------------------------------------------------------------- fechamento P1: handoff, orçamento e falha segura
const handoffSettings = () => { const settings = JSON.parse(JSON.stringify(ex.loadSettings())); settings.sales.stages = { ...(settings.sales.stages || {}), sales_human: { allow_ai: false, closed: false } }; return settings; };
// the in-memory save RPC does not lock the lead; the published one does for the human stage
const lockHuman = world => ({ ...world.rpcOverrides, magia_sales_save: (w, p) => { const r = ex.RPC.magia_sales_save(w, p); if (p.p_stage === 'sales_human') { w.tables.sales_leads.find(l => l.id === r.id).ai_locked = true; r.ai_locked = true; } return r; } });
const humanRequest = { reply: 'Claro, vou chamar um atendente para você.', response_contract: { handoff_announced: true }, dialogue_plan: { human_requested: true, handoff_reason: 'human_requested' }, semantic_intent: { primary_intent: 'human_handoff', topics: ['human'] } };
async function runWith(turnSpec, responses, { seed, settings } = {}) {
  const scenario = { name: 'closing', turns: [{ text: 'Quero falar com um atendente', gemini: turnSpec }], auditor_responses: responses };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: settings || ex.loadSettings(), inventory: fixtures.inventory, seed });
  return { result, world: result.world, outbound: result.world.tables.channel_events.filter(row => row.direction === 'outbound').at(-1) };
}

test('handoff autorizado: o CORE executa e persiste (fila humana, lead travado, evento com handoff) sem reescrita nem chamada extra', async () => {
  const { world, outbound } = await runWith(humanRequest, [], { settings: handoffSettings(), seed: w => { w.rpcOverrides = lockHuman(w); } });
  const execution = outbound.raw_payload.handoff_execution;
  assert.equal(execution.executed, true, JSON.stringify(execution));
  assert.equal(execution.operation_evidence, 'dispatch_record_persisted');
  assert.equal(outbound.handoff, true);
  assert.equal(world.tables.sales_leads[0].ai_locked, true);
  assert.equal(world.tables.sales_leads[0].state.human_dispatch.status, 'queued_unassigned');
  assert.equal(outbound.raw_payload.dialogue_repair, undefined);
  assert.equal(world.log.gemini.length, 1, 'uma única chamada ao modelo');
});

test('handoff decidido mas não comprovado: nenhuma reescrita de texto o encobre', async () => {
  const repaired = body({ reply: 'Certo, seguimos por aqui.', response_contract: contract() });
  const { world, outbound } = await run(humanRequest, [repaired]).then(value => ({ world: value.result.world, outbound: value.outbound }));
  assert.equal(outbound.raw_payload.handoff_execution.decided, true);
  assert.equal(outbound.raw_payload.handoff_execution.executed, false);
  assert.equal(outbound.raw_payload.dialogue_repair.attempted, false);
  assert.equal(outbound.raw_payload.dialogue_repair.skipped, 'handoff_decided_not_executed');
  assert.equal(world.log.gemini.length, 1, 'nenhuma chamada de reescrita');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.doesNotMatch(outbound.message_text, /Certo, seguimos/);
});

test('a reescrita usa o orçamento Gemini do tenant: uma reserva por chamada; sem orçamento nenhuma chamada sai e o turno cai no fallback seguro', async () => {
  const repaired = body({ reply: 'Entendi, obrigado por avisar. Posso ajudar com mais alguma informação do veículo?', response_contract: contract() });
  const reserves = [];
  const counted = await run(announced, [repaired]).then(() => null);
  void counted;
  const scenario = { name: 'budget', turns: [{ text: 'Air-bag acionado no painel', gemini: announced }], auditor_responses: [repaired] };
  const withBudget = (allowedCalls) => ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory,
    seed: world => { let used = 0; world.rpcOverrides = { magia_gemini_reserve: (w, p) => { reserves.push(p); return used++ < allowedCalls ? { allowed: true } : { allowed: false, reason: 'tenant_daily_limit' }; } }; } });
  const ok = await withBudget(10);
  const gemini = ok.world.log.gemini.length;
  assert.ok(reserves.length >= gemini && reserves.every(r => r.p_tenant_id && Number.isFinite(r.p_daily_limit)), 'toda chamada reserva o orçamento do tenant antes de sair');
  reserves.length = 0;
  const denied = await withBudget(1);
  const out = denied.world.tables.channel_events.filter(row => row.direction === 'outbound').at(-1);
  assert.equal(denied.world.log.gemini.length, 1, 'sem orçamento a reescrita não sai');
  assert.equal(out.raw_payload.dialogue_repair.status, 'failed');
  assert.match(out.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.equal(denied.world.log.simulated_sends.length, 1, 'uma única mensagem entregue');
});

test('reescrita rejeitada: bloqueio preservado, sem mensagem perdida, sem envio duplicado e sem transferência inventada', async () => {
  const again = body({ reply: 'Já estou chamando um atendente.', response_contract: contract({ handoff_announced: true }) });
  const { world, outbound } = await run(announced, [again]).then(value => ({ world: value.result.world, outbound: value.outbound }));
  const queue = world.tables.conversation_turn_queue[0];
  assert.equal(world.log.simulated_sends.length, 1, 'exatamente uma entrega');
  assert.equal(world.tables.conversation_turn_delivery_attempts.filter(row => row.status === 'confirmed').length, 1);
  assert.equal(queue.phase, 'ready');
  assert.equal(queue.claimed.length, 0, 'a mensagem foi consumida pela entrega confirmada, não perdida');
  assert.ok(!outbound.handoff, 'nenhum handoff inventado');
  assert.equal(world.tables.sales_leads[0]?.ai_locked ?? false, false);
  assert.doesNotMatch(outbound.message_text, /atendente/i);
  assert.equal(world.log.failures.length, 0, 'sem falha de fila');
});
