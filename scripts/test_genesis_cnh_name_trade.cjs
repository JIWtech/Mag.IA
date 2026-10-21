// Regressão direcionada: situação da CNH (informativa), prova do nome entre sessões e compra direta × troca.
// Funções reais do EXT (commercial.decide) e do CORE gerado. Sem rede.
// Rodar: node --test scripts/test_genesis_cnh_name_trade.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const TENANT = '0b5e0000-0000-4000-8000-000000000001';
const TOKEN = '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f';

const settings = ({ identity = ['cnh', 'cpf'], brands = ['Peugeot', 'Citroen', 'Ford', 'Renault'] } = {}) => ({ whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1', tenant_id: TENANT,
  sales: { hot_lead_rule: 'deposit_30_and_financing_documents_v1', collect_documents: true, financing_require_deposit_for_progress: false,
    required_financing_documents: ['full_name', 'birth_date', 'identity_document_photo'], stage_keys: { initial: 'a' }, stages: {} },
  sdr_rules: { hot_lead_percent: 30, minimum_purchase_year: 1995, rejected_purchase_brands: brands },
  business_facts: { financing: { offered_by_business: true, required_information: { full_name: { required: true }, birth_date: { required: true },
    identity_document_photo: { required: true, one_of: identity, format: 'photo' } } } } });

async function decide(text, state, { cfg = settings(), documentStatus, vehicle } = {}) {
  const input = { noria_phase: 'commercial_decision', operation: 'commercial.decide', noria_extension: 'genesis', noria_contract_version: '2.0', tenant_id: TENANT, tenant_slug: 'wesley_automoveis',
    instance: 'inst', remoteJid: '5500@s.whatsapp.net', noria_verified_settings: cfg,
    turn: { claimed: true, token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'in-1', id: 'ext-1', text }] }, noria_business_context: { session_id: 'initial', request_id: 'in-1:' + TOKEN },
    ...(documentStatus ? { documentStatus } : {}),
    semantic_intent: { valid: true, primary_intent: 'financing', secondary_intents: [], topics: ['financing'], references: { evidence_ids: [], product_references: [], mentioned_product_ids: [] }, customer_disposition: { value: 'active', evidence_ids: [] },
      ...(vehicle ? { customer_vehicle: { ...vehicle, evidence_ids: ['in-1'] } } : {}) },
    state: { intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', payment_evidence: 'in-1', ...state } };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode).call({ helpers: { httpRequest: async () => { throw new Error('sem rede'); } } }, input,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  assert.equal(out.json.commercial_decision_status, 'ok', out.json.commercial_decision_error);
  return out.json.commercial_decision;
}
const collection = d => d.operations.financing.collection;

test('nome sem evidência (perfil ou herdado sem prova) não conclui a coleta; com evidência original continua válido entre sessões', async () => {
  const profile = collection(await decide('quero financiar', { customer_name: 'Cliente Teste Silva', name_verified: false }));
  assert.ok(profile.missing_fields.includes('customer_name'), 'nome sem evidência precisa ser confirmado');
  const proven = collection(await decide('quero financiar', { customer_name: 'Cliente Teste Silva', name_verified: true }));
  assert.ok(!proven.missing_fields.includes('customer_name'), 'evidência original preservada não é pedida de novo');
  const oneWord = collection(await decide('quero financiar', { customer_name: 'Cliente', name_verified: true }));
  assert.ok(oneWord.missing_fields.includes('customer_name'), 'primeiro nome continua não sendo nome completo');
});

test('CNH: pergunta informativa só enquanto desconhecida, nunca bloqueia, e respeita a política configurada', async () => {
  const base = { customer_name: 'Cliente Teste Silva', name_verified: true };
  const unknown = collection(await decide('quero financiar', base));
  assert.deepEqual(unknown.optional_fields, ['cnh_status']);
  assert.ok(!unknown.missing_fields.includes('cnh_status') && !unknown.missing_fields.includes('identity_document_photo') === false, 'CNH nunca entra em missing_fields; o documento de identidade segue exigido');
  for (const status of ['yes', 'no']) {
    const known = collection(await decide('quero financiar', { ...base, cnh_status: status, cnh_evidence: 'in-0' }));
    assert.deepEqual(known.optional_fields, [], 'já respondido: não pergunta de novo');
    assert.equal(known.cnh_status, status);
    assert.ok(known.missing_fields.includes('identity_document_photo'), 'sem CNH a foto do CPF continua sendo o caminho; nada é recusado');
  }
  const withDoc = collection(await decide('quero financiar', base, { documentStatus: { identity_document_photo_received: true, identity_document_types: ['cpf'] } }));
  assert.deepEqual(withDoc.optional_fields, [], 'documento de identidade já recebido: nada a perguntar');
  const noCnhPolicy = collection(await decide('quero financiar', base, { cfg: settings({ identity: ['cpf'] }) }));
  assert.deepEqual(noCnhPolicy.optional_fields, [], 'a política não aceita CNH: a pergunta não existe');
  const cash = collection(await decide('quero pagar à vista', { ...base, payment_mode: 'cash' }));
  assert.deepEqual(cash.optional_fields, [], 'compra à vista: sem documentos nem CNH');
});

test('marcas recusadas valem só para compra direta; Ford/Renault/Peugeot/Citroën na troca não são rejeitados', async () => {
  const ford = { brand: 'Ford', model: 'Ka', year: 2012 };
  const sale = await decide('quero vender meu Ford Ka 2012', { transaction_mode: 'sell', intent: 'sell' }, { vehicle: { ...ford, purpose: 'independent_sale' } });
  assert.equal(sale.operations.purchase_policy.reason, 'rejected_brand', 'compra direta de marca recusada');
  for (const [brand, model] of [['Ford', 'Ka'], ['Renault', 'Sandero'], ['Peugeot', '206'], ['Citroën', 'C3']]) {
    const trade = await decide(`posso dar meu ${brand} ${model} 2012 de entrada?`, { transaction_mode: 'buy' }, { vehicle: { brand, model, year: 2012, purpose: 'entry' } });
    assert.equal(trade.operations.purchase_policy.reason, null, brand + ' na troca');
    assert.equal(trade.operations.purchase_policy.evaluated, false, 'nenhuma regra de compra direta avaliada na troca');
  }
});

async function core(names) {
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(coreCode);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode.replace(hook[0], 'return { ' + names.join(',') + ' };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}

test('CORE: cnh_status só muda com declaração do cliente (yes/no + evidência); persiste; documento não presume CNH', async () => {
  const c = await core(['salesEmptyState', 'salesMergeState', 'salesFinancingCollection']);
  const empty = c.salesEmptyState();
  assert.equal(empty.cnh_status, 'unknown'); assert.equal(empty.cnh_evidence, '');
  const declared = c.salesMergeState(empty, { cnh_status: 'no', cnh_evidence: 'in-7' });
  assert.deepEqual([declared.cnh_status, declared.cnh_evidence], ['no', 'in-7']);
  const later = c.salesMergeState(declared, { cnh_status: 'unknown', cnh_evidence: '' });
  assert.deepEqual([later.cnh_status, later.cnh_evidence], ['no', 'in-7'], 'um turno sem declaração não apaga a resposta anterior');
  const junk = c.salesMergeState(empty, { cnh_status: 'talvez', cnh_evidence: 'x' });
  assert.deepEqual([junk.cnh_status, junk.cnh_evidence], ['unknown', '']);
  const ctx = { tenant: { id: 't' }, noria_business_context: { commercial_policy: { contract: 'noria_commercial_policy_v1', tenant_id: 't', financing: { qualification_enabled: true, collection_enabled: true, offered_by_business: true,
    offered_by_business_status: 'enabled', hot_lead_percent: 30, deposit_required_for_progress: false, required_documents: ['full_name', 'birth_date', 'identity_document_photo'],
    required_information: { full_name: { required: true }, birth_date: { required: true }, identity_document_photo: { required: true, one_of: ['cnh', 'cpf'], format: 'photo' } } } } } };
  const product = { id: 'p', brand: 'HONDA', model: 'CB', year: 2007, status: 'announced', price_cents: 3000000, canonical_price_cents: 3000000, offerable: true, availability_verified: true, category: 'motorcycle' };
  const state = (over = {}) => ({ ...empty, transaction_mode: 'buy', payment_mode: 'financing', customer_name: 'Cliente Teste Silva', name_verified: true, ...over });
  const col = c.salesFinancingCollection(ctx, state(), {}, product);
  assert.deepEqual(col.optional_fields, ['cnh_status']);
  assert.ok(!col.missing_fields.includes('cnh_status'));
  assert.deepEqual(c.salesFinancingCollection(ctx, state({ cnh_status: 'no', cnh_evidence: 'in-7' }), {}, product).optional_fields, []);
});

// ---------------------------------------------------------------- prova semântica do nome (CORE real, sem rede)
const FULL = 'João Victor Santos Borges';
async function nameEngine() {
  const c = await core(['salesValidate', 'salesEmptyState']);
  const product = { id: 'p', brand: 'HONDA', model: 'CB', year: 2007, status: 'announced', price_cents: 3000000, canonical_price_cents: 3000000, offerable: true, availability_verified: true, category: 'motorcycle' };
  return (messages, { name = FULL, evidence = 'm1', kind = 'self_declared', prior = {}, last = null, current = ['m1'] } = {}) => {
    const state = { ...c.salesEmptyState(), intent: 'buy', transaction_mode: 'buy', customer_name: name, name_evidence: evidence, name_proof_kind: kind };
    const out = c.salesValidate({ action: 'reply', reason: 'none', reply: 'ok', state }, messages, [product], { settings: { settings: {} } }, new Map(), null, prior,
      { lastAssistant: last, currentIds: new Set(current) }).state;
    return JSON.parse(JSON.stringify({ name: out.customer_name, evidence: out.name_evidence, verified: out.name_verified, proof: out.name_proof }));
  };
}
const msg = (id, text) => ({ id, text, direction: 'inbound' });

test('nome: declaração explícita, resposta à pergunta e nome espontâneo são aceitos com a prova verificável', async () => {
  const v = await nameEngine();
  for (const [text, kind] of [['Meu nome é ' + FULL, 'self_declared'], [FULL, 'answered_name_question'], [FULL, 'self_declared']]) {
    const r = v([msg('m1', text)], { kind });
    assert.deepEqual([r.name, r.evidence, r.verified], [FULL, 'm1', true], text + '/' + kind);
  }
});

test('nome: terceiro, veículo, frase comercial e id arbitrário não comprovam nada; o modelo precisa classificar e o CORE confere a prova', async () => {
  const v = await nameEngine();
  // o modelo classificou como "none" (irmão, veículo): o nome não é adotado
  for (const text of ['Meu irmão João vai levar o carro', 'Quero um Ford Ka']) {
    const r = v([msg('m1', text)], { name: 'João', kind: 'none' });
    assert.deepEqual([r.name, r.verified], ['', false], text);
  }
  // o modelo alegou declaração, mas a mensagem citada não contém o nome (o caso real: "Vendem celta? Camaro?")
  const wrong = v([msg('m1', 'Vendem celta? Camaro?')], { kind: 'self_declared' });
  assert.deepEqual([wrong.name, wrong.evidence, wrong.verified], ['', '', false]);
  // id que não é mensagem do cliente nesta conversa
  const stray = v([msg('m1', 'Meu nome é ' + FULL)], { evidence: 'inexistente', kind: 'self_declared' });
  assert.equal(stray.verified, false); assert.equal(stray.name, '');
});

test('nome: "sim" só confirma quando a última pergunta da IA apresentou exatamente aquele nome e a resposta é deste turno', async () => {
  const v = await nameEngine();
  const ask = { id: 'a1', text: 'Seu nome completo é ' + FULL + '?' };
  const ok = v([msg('m2', 'Sim')], { evidence: 'm2', kind: 'confirmed_presented_name', last: ask, current: ['m2'] });
  assert.deepEqual([ok.name, ok.evidence, ok.verified, ok.proof.question_id], [FULL, 'm2', true, 'a1']);
  const bare = v([msg('m2', 'Sim')], { evidence: 'm2', kind: 'confirmed_presented_name', last: { id: 'a2', text: 'Posso ajudar em mais alguma coisa?' }, current: ['m2'] });
  assert.deepEqual([bare.name, bare.verified], ['', false], '"sim" sem pergunta específica sobre o nome');
  const other = v([msg('m2', 'Sim')], { evidence: 'm2', kind: 'confirmed_presented_name', last: { id: 'a3', text: 'Seu nome é Maria Souza?' }, current: ['m2'] });
  assert.equal(other.verified, false, 'a pergunta apresentou outro nome');
  const old = v([msg('m0', 'Sim'), msg('m2', 'Quanto custa?')], { evidence: 'm0', kind: 'confirmed_presented_name', last: ask, current: ['m2'] });
  assert.equal(old.verified, false, 'confirmação de turno antigo não vale');
  const none = v([msg('m2', 'Sim')], { evidence: 'm2', kind: 'confirmed_presented_name', last: null, current: ['m2'] });
  assert.equal(none.verified, false);
});

test('nome: perfil/herdado sem prova continua não verificado; prova original preservada entre turnos e sessões; nome comprovado não é apagado', async () => {
  const v = await nameEngine();
  const turn = [msg('m9', 'Vendem celta? Camaro?')];
  const profile = v(turn, { name: FULL, evidence: '', kind: 'none', prior: { customer_name: FULL, name_evidence: '', name_verified: false }, current: ['m9'] });
  assert.deepEqual([profile.name, profile.verified, profile.evidence], [FULL, false, ''], 'nome de perfil/herdado sem prova segue para confirmação');
  const proven = v(turn, { name: FULL, evidence: '', kind: 'none', prior: { customer_name: FULL, name_evidence: 'm1', name_verified: true, name_proof: { kind: 'self_declared', evidence_id: 'm1', audit: 'confirmed' } }, current: ['m9'] });
  assert.deepEqual([proven.name, proven.verified, proven.evidence], [FULL, true, 'm1'], 'prova original preservada, nome não é apagado nem pedido de novo');
  const badLegacy = v([msg('m5', 'Vendem celta? Camaro?'), ...turn], { name: FULL, evidence: '', kind: 'none', prior: { customer_name: FULL, name_evidence: 'm5' }, current: ['m9'] });
  assert.equal(badLegacy.verified, false, 'estado antigo cuja evidência não comprova o nome (caso real) não é reaproveitado');
  const goodLegacy = v([msg('m5', 'Meu nome é ' + FULL), ...turn], { name: FULL, evidence: '', kind: 'none', prior: { customer_name: FULL, name_evidence: 'm5' }, current: ['m9'] });
  assert.deepEqual([goodLegacy.verified, goodLegacy.evidence], [false, ''], 'estado antigo sem name_verified nunca é considerado comprovado automaticamente');
  const swap = v(turn, { name: 'Outro Nome Qualquer', evidence: 'm9', kind: 'self_declared', prior: { customer_name: FULL, name_evidence: 'm1', name_verified: true, name_proof: { audit: 'confirmed' } }, current: ['m9'] });
  assert.deepEqual([swap.name, swap.verified], [FULL, true], 'um nome novo sem prova coerente não substitui o comprovado');
});

test('nome: a prova nova é provisória (audit=pending) e a prova já confirmada não é reauditada', async () => {
  const v = await nameEngine();
  const fresh = v([msg('m1', 'Meu nome é ' + FULL)], { kind: 'self_declared' });
  assert.equal(fresh.proof.audit, 'pending'); assert.equal(fresh.proof.previous.name_verified, false);
  const again = v([msg('m1', 'Meu nome é ' + FULL), msg('m2', 'Olá de novo, ' + FULL)], { evidence: 'm2', kind: 'self_declared', current: ['m2'],
    prior: { customer_name: FULL, name_evidence: 'm1', name_verified: true, name_proof: { kind: 'self_declared', evidence_id: 'm1', audit: 'confirmed' } } });
  assert.equal(again.proof.audit, 'confirmed', 'a prova original confirmada é mantida, sem novo julgamento');
  const unfinished = v([msg('m1', 'oi')], { name: FULL, evidence: '', kind: 'none', current: ['m1'],
    prior: { customer_name: FULL, name_evidence: 'm0', name_verified: true, name_proof: { audit: 'pending' } } });
  assert.equal(unfinished.verified, false, 'prova cuja auditoria nunca terminou não vale no turno seguinte');
});

test('auditoria semântica: o pedido leva a prova do nome na MESMA chamada e o veredito exige coerência com a classificação alegada', async () => {
  const c = await core(['salesSemanticAuditRequest', 'salesNameProofVerdict']);
  const base = c.salesSemanticAuditRequest('k', 'Oi', [], [], 'gemini-2.5-flash', false, []);
  assert.ok(!JSON.stringify(base).includes('name_proof'), 'sem prova pendente a auditoria é a de sempre');
  const proof = { customer_name: FULL, claimed_kind: 'self_declared', customer_message: 'Meu irmão ' + FULL + ' vai aí' };
  const req = c.salesSemanticAuditRequest('k', 'Oi', [], [], 'gemini-2.5-flash', false, [], proof);
  assert.ok(req.generationConfig.responseSchema.required.includes('name_proof_verdict'));
  assert.ok(JSON.parse(req.contents[0].parts[0].text).name_proof.customer_message.includes('irmão'));
  const verdict = (v, claimed = 'self_declared') => c.salesNameProofVerdict({ name_proof_verdict: v }, { claimed_kind: claimed });
  const ok = { relation: 'customer_self', belongs_to_customer: true, assistant_question_presents_name: false, customer_message_confirms_name: false };
  assert.equal(verdict(ok), 'confirmed');
  assert.equal(verdict({ ...ok, relation: 'third_party', belongs_to_customer: false }), 'rejected');
  assert.equal(verdict({ ...ok, relation: 'vehicle_or_product', belongs_to_customer: false }), 'rejected');
  assert.equal(verdict({ ...ok, belongs_to_customer: false }), 'rejected', 'relation self sem pertencimento não basta');
  assert.equal(verdict(ok, 'confirmed_presented_name'), 'rejected', 'confirmação exige pergunta específica E resposta afirmativa');
  assert.equal(verdict({ ...ok, assistant_question_presents_name: true, customer_message_confirms_name: true }, 'confirmed_presented_name'), 'confirmed');
  assert.equal(verdict({ ...ok, assistant_question_presents_name: true, customer_message_confirms_name: false }, 'confirmed_presented_name'), 'rejected', '"não" não confirma');
  assert.equal(c.salesNameProofVerdict({}, proof), 'unavailable');
});
