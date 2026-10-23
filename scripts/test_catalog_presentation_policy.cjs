// Política de apresentação do estoque (settings.sales.catalog_presentation) e veículo fora do estoque.
// Caso de origem (Gênesis 22/10 22:59): lead de anúncio pergunta "Posso ter mais informações sobre isso?" e recebe
// a lista do estoque inteiro; o dono pediu que a IA pergunte o que o cliente procura e nunca negue um carro que não
// está no pátio (a loja busca com parceiros): nesse caso transfere e atribui a um atendente.
// Funções REAIS do CORE gerado e do EXT, executadas pelo executor de homologação com respostas do modelo simuladas.
// Rodar: node --test scripts/test_catalog_presentation_policy.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const salesOutbound = world => world.tables.channel_events.filter(row => row.direction === 'outbound' && row.ai_provider !== 'core_error').at(-1);
const lockHuman = world => ({ ...world.rpcOverrides, magia_sales_save: (w, p) => { const r = ex.RPC.magia_sales_save(w, p); if (p.p_stage === 'sales_human') { w.tables.sales_leads.find(l => l.id === r.id).ai_locked = true; r.ai_locked = true; } return r; } });

const policy = { list_requires_criteria: true, max_items: 1 };
const sourcing = { id: 'busca_veiculo', name: 'Busca de veículo', description: 'Veículo que não está no estoque', requires: 'no_inventory_product', confirmation: 'Conseguimos buscar esse carro pra você!' };
function settingsWith({ presentation = null, humanServices = undefined } = {}) {
  const settings = JSON.parse(JSON.stringify(ex.loadSettings()));
  settings.sales.stages = { ...(settings.sales.stages || {}), sales_human: { allow_ai: false, closed: false } };
  if (presentation) settings.sales.catalog_presentation = presentation;
  settings.business_facts = { ...(settings.business_facts || {}), human_services: humanServices };
  delete settings.business_facts.opening_hours;
  return settings;
}
const catalogAsk = (catalog = {}) => ({
  reply: 'Claro! Me conta qual carro você procura, o ano ou a faixa de preço, que eu verifico pra você',
  semantic_intent: { primary_intent: 'inventory_search', topics: ['catalog'], catalog: { requested: true, evidence_ids: ['in-1'], ...catalog } },
  response_contract: { answers: [{ request_id: 'request_1', excerpt: 'Me conta qual carro você procura' }] },
  dialogue_plan: { requests: [{ topic: 'catalog' }] }
});
async function turn(text, gemini, options) {
  const scenario = { name: 'catalog_policy', turns: [{ text, gemini }], auditor_responses: [] };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: settingsWith(options), inventory: fixtures.inventory,
    seed: w => { w.rpcOverrides = lockHuman(w); } });
  return { world: result.world, outbound: salesOutbound(result.world) };
}
const listedCount = text => fixtures.inventory.filter(p => new RegExp('\\b' + p.model + '\\b', 'i').test(text)).length;

test('sem política: o pedido genérico continua listando o estoque (comportamento anterior)', async () => {
  const { outbound } = await turn('Posso ter mais informações sobre isso?', catalogAsk());
  assert.ok(listedCount(outbound.message_text) >= 2, outbound.message_text);
});

test('com política e sem critério: nenhuma lista; a resposta pergunta o que o cliente procura', async () => {
  const { outbound } = await turn('Posso ter mais informações sobre isso?', catalogAsk(), { presentation: policy });
  assert.equal(outbound.raw_payload.catalog_routing?.withheld, 'criteria_required', JSON.stringify(outbound.raw_payload.catalog_routing));
  assert.equal(listedCount(outbound.message_text), 0, outbound.message_text);
  assert.match(outbound.message_text, /qual carro você procura/);
  assert.equal(outbound.raw_payload.dialogue_recovery, undefined);
});

test('com política e critério: no máximo max_items opções', async () => {
  const { outbound } = await turn('Tem carro até 100 mil?', catalogAsk({ price_max_cents: 10000000 }), { presentation: policy });
  assert.equal(outbound.raw_payload.catalog_routing?.withheld, undefined);
  assert.ok(listedCount(outbound.message_text) <= policy.max_items, outbound.message_text);
});

test('veículo fora do estoque: confirma com o texto do tenant, transfere e não nega', async () => {
  const gemini = {
    reply: 'No momento não temos Corolla no estoque.',
    semantic_intent: { primary_intent: 'purchase', topics: ['availability'] },
    dialogue_plan: { requests: [{ topic: 'availability' }], human_service_id: 'busca_veiculo' }
  };
  const { outbound } = await turn('Vocês têm Corolla 2020?', gemini, { humanServices: [sourcing] });
  assert.equal(outbound.handoff, true, JSON.stringify(outbound.raw_payload.handoff_execution));
  assert.equal(outbound.raw_payload.human_service?.id, 'busca_veiculo');
  assert.ok(outbound.message_text.startsWith('Conseguimos buscar esse carro pra você!'), outbound.message_text);
  assert.doesNotMatch(outbound.message_text, /não temos/i);
});

test('veículo do estoque selecionado neste turno: o serviço de busca não se aplica', async () => {
  const product = fixtures.inventory[1];
  const gemini = {
    reply: 'A Montana 2018 está anunciada. Quer mais detalhes?',
    semantic_intent: { primary_intent: 'product_details', topics: ['details'],
      references: { mentioned_product_ids: [product.id], evidence_ids: ['in-1'], product_references: [{ product_id: product.id, role: 'interest', evidence_ids: ['in-1'] }], product_role: 'interest' } },
    dialogue_plan: { requests: [{ topic: 'details' }], human_service_id: 'busca_veiculo' }
  };
  const { outbound } = await turn('Quero a Montana 2018', gemini, { humanServices: [sourcing] });
  assert.notEqual(outbound.handoff, true);
  assert.equal(outbound.raw_payload.human_service, undefined);
});
