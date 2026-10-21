// Regressão do incidente de 21/10/2026 (UNSUPPORTED_AMOUNT:1000000): uma entrada declarada na mesma frase de uma pergunta de
// viabilidade era descartada, e a resposta que a citava era rejeitada pelo auditor. Executa funções REAIS do CORE gerado.
// Rodar: node --test scripts/test_genesis_declared_deposit.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);

async function engine() {
  const names = ['salesAmount', 'salesDeclaredAmount', 'salesDeclaredAmounts', 'salesValidate', 'salesSanitizeSemanticState', 'salesEmptyState', 'salesFinancingCollection', 'salesFinancingTemperature',
    'salesValidatePrimaryDialogue', 'salesApplyDeterministicDepositState'];
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'return { ' + names.join(',') + ' };\n' + hook[0])).call(
    { helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-deposit', remoteJid: '5511999999999@s.whatsapp.net', instance: 'genesis-instance', noria_preclaimed_turn: { boundary_id: 'deposit', messages: [], claimed: true, token: 'x' } },
    {}, {}, () => ({}));
}

const INCIDENT = 'Essa Honda cb ai, tenho 10 mil de entrada, da pra Dale ?';
const product = { id: 'honda|cb 600rr|2007|', brand: 'HONDA', model: 'CB 600RR', year: 2007, status: 'announced', price_cents: 3498000, canonical_price_cents: 3498000, offerable: true, availability_verified: true, category: 'motorcycle' };

test('entrada declarada na mesma frase de uma pergunta de viabilidade é lida; hipótese e pergunta pura continuam sem valor', async () => {
  const core = await engine();
  assert.equal(core.salesAmount(INCIDENT), null, 'o leitor de frase inteira continua como estava');
  assert.equal(core.salesDeclaredAmount(INCIDENT), 1000000, 'a cláusula "tenho 10 mil de entrada" é uma declaração');
  assert.equal(core.salesDeclaredAmount('tenho 10 mil de entrada. da pra financiar?'), 1000000);
  assert.equal(core.salesDeclaredAmount('Dando 6mil de entrada e parcelamento no cartão'), 600000, 'ocorrência de 19/10');
  assert.equal(core.salesDeclaredAmount('tenho R$ 10.000,50 de entrada, da pra fazer?'), 1000050, 'vírgula/ponto entre dígitos não separa cláusulas');
  for (const hypothetical of ['Tem como dar R$ 10 mil de entrada?', 'Se eu der 15 mil, quanto fica?', 'Dá pra dar 10 mil?', 'e se eu der 20 mil de entrada?']) {
    assert.equal(core.salesDeclaredAmount(hypothetical), null, hypothetical);
  }
  assert.equal(core.salesDeclaredAmount('tenho 10 mil de entrada. da pra fazer? tenho 20 mil de entrada'), null, 'declarações conflitantes não são escolhidas');
});

test('a entrada que o Gemini devolve com evidência é preservada; valor sem proveniência na mensagem é descartado', async () => {
  const core = await engine();
  const messages = [{ id: 'in-1', event_id: 'in-1', text: INCIDENT, direction: 'inbound' }];
  const base = { ...core.salesEmptyState(), intent: 'buy', transaction_mode: 'buy', product_id: product.id, product_evidence: 'in-1', payment_mode: 'financing', payment_evidence: 'in-1', deposit_evidence: 'in-1' };
  const validate = (deposit, over = {}) => core.salesValidate({ action: 'reply', reason: 'none', reply: 'Posso ajudar com isso.', state: { ...base, deposit_cents: deposit, ...over } },
    over.messages || messages, [product], { settings: { settings: {} } }, new Map(), null, {}).state;
  assert.equal(validate(1000000).deposit_cents, 1000000, 'o valor está literalmente na mensagem do cliente');
  assert.equal(validate(1000000).deposit_evidence, 'in-1');
  assert.equal(validate(1500000).deposit_cents, null, 'valor inventado pela IA, ausente da mensagem, continua bloqueado');
  assert.equal(validate(1000000, { deposit_evidence: 'in-9' }).deposit_cents, null, 'sem evidência existente');
  assert.equal(validate(99999999, { messages: [{ ...messages[0], text: 'tenho 999999 mil de entrada, da pra?' }] }).deposit_cents, null, 'entrada maior que o preço do veículo');
  assert.equal(validate(1000000).product_id, product.id, 'a Honda CB 600RR segue selecionada');
});

test('o auditor aceita a entrada declarada e continua bloqueando valores inventados ou derivados sem autorização', async () => {
  const core = await engine();
  const plan = { requests: [{ id: 'financing', topic: 'financing' }], next_requirement: 'documents', handoff_reason: 'none' };
  const contract = (reply, facts = []) => ({ primary_reply: reply, state: {}, primary_facts: facts, response_contract: { answers: [{ request_id: 'financing', excerpt: reply }], requested_fields: [], facts: [],
    fact_evidence_mode: 'standard', availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false } });
  const audit = (reply, deposit_cents) => core.salesValidatePrimaryDialogue(contract(reply), plan, {}, { inventory: [product], product, deposit_cents }).issues;
  assert.deepEqual(audit('Com R$ 10.000,00 de entrada dá para seguir com a simulação.', 1000000), [], 'entrada declarada e preservada');
  assert.deepEqual(audit('O valor do veículo é R$ 34.980,00.', null), [], 'preço oficial');
  assert.ok(audit('Com R$ 10.000,00 de entrada dá para seguir.', null).includes('UNSUPPORTED_AMOUNT:1000000'), 'sem entrada comprovada no estado o valor continua não autorizado');
  assert.ok(audit('Com R$ 12.000,00 de entrada dá para seguir.', 1000000).includes('UNSUPPORTED_AMOUNT:1200000'), 'valor inventado pela IA');
  assert.ok(audit('Fica um saldo de R$ 24.980,00 a financiar.', 1000000).includes('UNSUPPORTED_AMOUNT:2498000'), 'cálculo derivado só vale se a EXT autorizar');
  assert.ok(audit('Parcelas de R$ 899,00.', 1000000).includes('UNSUPPORTED_AMOUNT:89900'), 'parcela inventada');
});

test('avanço para documentos respeita financing_require_deposit_for_progress; os 30% só classificam a temperatura', async () => {
  const core = await engine();
  const financing = required => ({ tenant: { id: 'tenant-deposit' }, noria_business_context: { commercial_policy: { contract: 'noria_commercial_policy_v1', tenant_id: 'tenant-deposit',
    financing: { qualification_enabled: true, collection_enabled: true, offered_by_business: true, offered_by_business_status: 'enabled', hot_lead_percent: 30, deposit_required_for_progress: required,
      required_documents: ['full_name', 'birth_date', 'identity_document_photo'],
      required_information: { full_name: { required: true }, birth_date: { required: true }, identity_document_photo: { required: true, one_of: ['cnh', 'cpf'], format: 'photo' } } } } } });
  const state = deposit => ({ transaction_mode: 'buy', payment_mode: 'financing', customer_name: 'Cliente Teste Silva', name_evidence: 'evt-1', deposit_cents: deposit });
  const notRequired = core.salesFinancingCollection(financing(false), state(null), {}, product);
  assert.equal(notRequired.next_field, 'birth_date', 'sem exigência configurada, a coleta segue para documentos mesmo sem entrada');
  assert.ok(!notRequired.missing_fields.includes('deposit'));
  const required = core.salesFinancingCollection(financing(true), state(null), {}, product);
  assert.ok(required.missing_fields.includes('deposit') && required.ready === false, 'com a exigência configurada, a entrada passa a ser requisito');
  assert.ok(!core.salesFinancingCollection(financing(true), state(1000000), {}, product).missing_fields.includes('deposit'), 'entrada comprovada atende ao requisito');
  // 30% is the hot-lead threshold (temperature), never a minimum deposit
  const warm = core.salesFinancingTemperature(state(1000000), product, {}, financing(false));
  assert.equal(warm.threshold_cents, 1049400);
  assert.notEqual(warm.temperature, 'hot', '10 mil < 30% do preço: morno, mas a coleta não foi bloqueada');
  assert.equal(core.salesFinancingCollection(financing(false), state(1000000), {}, product).next_field, 'birth_date');
});
