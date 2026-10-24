const test = require('node:test');
const assert = require('node:assert/strict');
const ex = require('./homolog/genesis_executor.cjs');
const fs = require('node:fs');
const path = require('node:path');
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8')).inventory;
async function run(alwaysInvalid = false, empty = false) {
  let calls = 0;
  const result = await ex.runScenario({ name: 'invalid_primary', turns: [{ text: 'Olá', gemini: {} }] }, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory,
    geminiOverride: (_body, schema) => {
      if (!schema.properties?.semantic_intent) return undefined;
      calls++;
      if (empty && (alwaysInvalid || calls === 1)) return ex.cannedPrimaryBody({ reply: '',
        state: { deposit_cents: 99999999 }, dialogue_plan: { requests: [{ id: 'request_1', topic: 'other' }] },
        semantic_intent: { primary_intent: 'other', topics: ['greeting'] } });
      if (alwaysInvalid || calls === 1) return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"reply":"conteúdo sem contrato","state":{"deposit_cents":99999999}}' }] } }] };
      return ex.cannedPrimaryBody({ reply: 'Olá! Como posso ajudar?', semantic_intent: { primary_intent: 'other', topics: ['greeting'] } });
    },
  });
  return { calls, world: result.world };
}
test('resposta sem contrato pode ser regenerada uma vez antes de qualquer efeito comercial', async () => {
  const r = await run();
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 1);
  assert.notEqual(r.world.tables.sales_leads[0]?.deposit_cents, 99999999);
});
test('segunda resposta inválida não cria loop nem envia texto sem contrato', async () => {
  const r = await run(true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 0);
});

test('resposta vazia a um pedido textual é regenerada antes de aplicar estado', async () => {
  const r = await run(false, true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 1);
  assert.notEqual(r.world.tables.sales_leads[0]?.deposit_cents, 99999999);
});

test('duas respostas vazias não são publicadas nem geram regeneração ilimitada', async () => {
  const r = await run(true, true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 0);
});
