const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/app/node_modules/typescript');
const source = fs.readFileSync(root + '/n8n/sources/genesis_extension.js', 'utf8');
const ast = ts.createSourceFile('extension.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = ast.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(ast)).join('\n');
const inventory = [
  { id: 'ninja', model: 'Ninja 650', brand: 'Kawasaki', category: 'motorcycle', status: 'announced', offerable: true, observations: 'Sem histórico de leilão' },
  { id: 'versa', model: 'Versa', brand: 'Nissan', category: 'car', status: 'announced', offerable: true },
  { id: 'unknown', model: 'Modelo novo', status: 'announced', offerable: true },
];
function harness() { const c = {}; vm.createContext(c); vm.runInContext(code, c); return c; }
const semantic = intent => ({ valid: true, auction: { intent, evidence_ids: ['inbound-1'], product_id: 'ninja' } });
const operation = (op, payload = {}) => harness().executeBusinessOperation(op, { tenant_slug: 'wesley_automoveis', inventory, ...payload });
test('metadata oficial classifica moto nova e desconhecida não é carro', () => {
  const c = harness(); assert.equal(c.isMotorcycle(inventory[0]), true); assert.equal(c.isMotorcycle(inventory[2]), null);
  assert.deepEqual(Array.from(c.filterOfferableCatalog(inventory, 'cars'), x => x.id), ['versa']);
  assert.equal(c.filterOfferableCatalog(inventory, 'all').length, 3);
});
test('snapshot preserva categoria oficial e desconhecida sem adivinhar pelo modelo', () => {
  const rows = harness().parseSupabaseInventoryRows(inventory.map((p, i) => ({...p, vehicle_id:p.id, brand:p.brand || 'Marca', model_year:2024, price_cents:100000})));
  assert.deepEqual(Array.from(rows, p => p.category), ['motorcycle', 'car', 'unknown']);
});
test('consulta com negação usa categoria semântica e não palavra motos', async () => {
  const result = await operation('inventory.filter_catalog', { query: 'Não quero motos, só carros', semantic_catalog: { category:'cars' } });
  assert.deepEqual(Array.from(result.data.items, p => p.id), ['versa']);
  const missing = await operation('inventory.filter_catalog', { query: 'Não quero motos, só carros' });
  assert.equal(missing.data.requires_clarification, true); assert.equal(missing.data.count, 0);
});
test('política de leilão não vira oferta nem encaminhamento', async () => {
  const result = await operation('auction.evaluate_handoff', {text:'Vocês compram carro de leilão?', semantic_intent:semantic('policy_inquiry')});
  assert.equal(result.handoff.required, false); assert.equal(result.data.intent, 'policy_inquiry'); assert.equal(result.handoff.message, null);
});
test('oferta concreta validada segue regra de negócio sem mensagem fixa', async () => {
  const result = await operation('auction.evaluate_handoff', {text:'Quero vender meu carro de leilão', semantic_intent:semantic('customer_vehicle_offer')});
  assert.equal(result.handoff.required, true); assert.equal(result.handoff.reason, 'auction_vehicle_purchase'); assert.equal(result.handoff.message, null);
});
test('palavras leilão e sinistro sem semântica não decidem transferência', async () => {
  for (const text of ['leilão', 'sinistro', 'meu carro de leilão']) {
    const result = await operation('auction.evaluate_handoff', {text}); assert.equal(result.handoff.required, false);
  }
});
test('observação negativa permanece literal e nunca confirma leilão positivo', async () => {
  const result = await operation('auction.evaluate_handoff', {semantic_intent:semantic('inventory_history')});
  assert.equal(result.handoff.required, false); assert.equal(result.handoff.message, null);
  assert.equal(result.data.inventory_history.documented, false); assert.equal(result.data.inventory_history.auction_history, null);
  assert.equal(result.data.inventory_history.observation, 'Sem histórico de leilão');
});
test('interesse em produto removido não transfere nem usa cópia obsoleta', async () => {
  const result = await operation('auction.evaluate_handoff', { product:{id:'removed', auction_history:true}, semantic_intent:{...semantic('inventory_interest'), auction:{intent:'inventory_interest',product_id:'removed',evidence_ids:['inbound-1']}} });
  assert.equal(result.handoff.required, false); assert.equal(result.data.vehicle, null);
});
test('intenção inválida ou sem evidência não habilita handoff', async () => {
  for (const s of [{...semantic('customer_vehicle_offer'),valid:false},{valid:true,auction:{intent:'customer_vehicle_offer',evidence_ids:[]}}]) {
    assert.equal((await operation('auction.evaluate_handoff', {semantic_intent:s})).handoff.required,false);
  }
});
test('build_context e financing.evaluate propagam semântica de financiamento', async () => {
  const s = {valid:true,primary_intent:'financing',secondary_intents:[]};
  assert.equal((await operation('commercial.build_context', {semantic_intent:s})).data.financing.active,true);
  assert.equal((await operation('financing.evaluate', {semantic_intent:s})).data.is_financing_question,true);
  assert.equal((await operation('commercial.build_context', {text:'financiamento'})).data.financing.active,false);
});
test('operação permanece isolada ao tenant Gênesis', async () => {
  const result = await operation('auction.evaluate_handoff', {tenant_slug:'royal_4x4',semantic_intent:semantic('customer_vehicle_offer')});
  assert.equal(result.status,'error'); assert.equal(result.error,'CROSS_TENANT_OPERATION_DISALLOWED');
});
test('fonte completa continua sintaticamente válida no runtime n8n', () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; assert.doesNotThrow(() => new AsyncFunction('$json','$env',source));
});
