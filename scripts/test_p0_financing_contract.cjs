const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function engine() {
  const exposed = code.replace(
    'try {\n  return { json: await runTurn() };',
    'return { salesDialogueFactLedger, salesValidatePrimaryDialogue, salesFinancingCommercialPolicy, salesFinancingCollection, salesFinancingTemperature, salesDocumentStatus };\ntry {\n  return { json: await runTurn() };'
  );
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', exposed).call(
    { helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-financing', remoteJid: '5511999999999@s.whatsapp.net', instance: 'genesis-instance', noria_preclaimed_turn: { boundary_id: 'finance-p0', messages: [] }, noria_business_context: { inventory: [] }, noria_client_policy: { profile: 'vehicle_sales_v1', capability: 'sales_v1', contract: 'noria_policy_v2', tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-financing', audio_enabled: false, scheduling_enabled: false } },
    {}, {}, () => ({})
  );
}

function context(offered) {
  const status = offered === true ? 'enabled' : offered === false ? 'disabled' : 'not_configured';
  return { tenant: { id: 'tenant-financing' }, noria_business_context: { commercial_policy: {
    contract: 'noria_commercial_policy_v1', tenant_id: 'tenant-financing',
    financing: { qualification_enabled: true, offered_by_business: offered === undefined ? null : offered,
      offered_by_business_status: status, hot_lead_percent: 30,
      required_documents: ['cpf', 'cnh', 'birth_date'] }
  } } };
}

function officialContext() {
  return { tenant: { id: 'tenant-financing' }, noria_business_context: { commercial_policy: {
    contract: 'noria_commercial_policy_v1', tenant_id: 'tenant-financing',
    financing: { qualification_enabled: true, offered_by_business: true, offered_by_business_status: 'enabled', hot_lead_percent: 30,
      required_documents: ['full_name', 'birth_date', 'identity_document_photo'],
      required_information: { full_name: { required: true }, birth_date: { required: true },
        identity_document_photo: { required: true, one_of: ['cnh', 'cpf'], format: 'photo' } } }
  } } };
}

const product = { id: 'tenant|vehicle|2024|', model: 'VEICULO', brand: 'MARCA', year: 2024, status: 'announced', price_cents: 5000000, offerable: true };
const plan = { requests: [{ id: 'financing', topic: 'financing' }], next_requirement: 'none', handoff_reason: 'none' };
function contract(reply, fact, facts) {
  return { primary_reply: reply, state: {}, primary_facts: facts, response_contract: { answers: [{ request_id: 'financing', excerpt: reply }], requested_fields: [], facts: fact ? [fact] : [], availability_asserted: false, assignment_confirmed: false, photo_sent: false } };
}

test('P0 financing contract separates qualification from commercial offer', async () => {
  const core = await engine();
  const requested = { transaction_mode: 'buy', payment_mode: 'financing', customer_name: 'Cliente Completo', deposit_cents: 1500000 };

  const enabled = core.salesDialogueFactLedger(context(true), null, {}, {}, {}, [], [product]);
  assert.equal(enabled.official.sales_policy.financing_qualification_enabled, true);
  assert.equal(enabled.official.sales_policy.financing_offered_by_business, true);
  assert.equal(enabled.official.sales_policy.financing_offered_by_business_status, 'enabled');
  assert.equal(core.salesValidatePrimaryDialogue(contract('Sim, existe essa modalidade.', { fact_id: 'official.sales_policy.financing_offered_by_business', value: 'sim', excerpt: 'existe essa modalidade' }, enabled.facts), plan, {}, { inventory: [product] }).status, 'accepted');
  assert.equal(core.salesFinancingCollection(context(true), { transaction_mode: 'buy', payment_mode: 'unknown' }, {}, product).active, false, 'consulta não inicia coleta');
  assert.equal(core.salesFinancingCollection(context(true), requested, {}, product).active, true, 'pedido semântico explícito pode iniciar coleta');

  const disabled = core.salesDialogueFactLedger(context(false), null, {}, {}, {}, [], [product]);
  assert.equal(disabled.official.sales_policy.financing_offered_by_business, false);
  assert.equal(disabled.official.sales_policy.financing_offered_by_business_status, 'disabled');
  assert.equal(core.salesValidatePrimaryDialogue(contract('Essa modalidade não está disponível.', { fact_id: 'official.sales_policy.financing_offered_by_business', value: 'false', excerpt: 'modalidade não está disponível' }, disabled.facts), plan, {}, { inventory: [product] }).status, 'accepted');
  assert.equal(core.salesFinancingCollection(context(false), requested, {}, product).active, false);
  assert.equal(core.salesFinancingTemperature(requested, product, {}, context(false)).temperature, 'unknown');

  const unconfigured = core.salesDialogueFactLedger(context(undefined), null, {}, {}, {}, [], [product]);
  assert.equal(unconfigured.official.sales_policy.financing_qualification_enabled, true);
  assert.equal(unconfigured.official.sales_policy.financing_offered_by_business, null);
  assert.equal(unconfigured.official.sales_policy.financing_offered_by_business_status, 'not_configured');
  assert.equal(core.salesFinancingCollection(context(undefined), requested, {}, product).active, false);
  assert.equal(core.salesValidatePrimaryDialogue(contract('Preciso confirmar essa possibilidade com a equipe.', { fact_id: 'official.sales_policy.financing_offered_by_business_status', value: 'not_configured', excerpt: 'confirmar essa possibilidade com a equipe' }, unconfigured.facts), plan, {}, { inventory: [product] }).status, 'accepted');
  const invented = core.salesValidatePrimaryDialogue(contract('Sim, oferecemos financiamento.', { fact_id: 'official.sales_policy.financing_offered_by_business', value: 'true', excerpt: 'oferecemos financiamento' }, unconfigured.facts), plan, {}, { inventory: [product] });
  assert.equal(invented.status, 'needs_human_review');
  assert.ok(invented.issues.includes('UNSUPPORTED_FACT:official.sales_policy.financing_offered_by_business'));
});

test('official financing contract accepts one document photo but never a typed CPF', async () => {
  const core = await engine();
  const state = { transaction_mode: 'buy', payment_mode: 'financing', customer_name: 'Maria de Souza', deposit_cents: 0 };
  const typedCpf = core.salesDocumentStatus([{ extracted: { source: 'customer_text', identity_scope: 'current_applicant', cpf: '52998224725' } }], state);
  assert.equal(typedCpf.cpf_received, true);
  assert.equal(typedCpf.identity_document_photo_received, false);
  assert.equal(core.salesFinancingCollection(officialContext(), state, typedCpf, product).next_field, 'birth_date');

  const cnhPhoto = core.salesDocumentStatus([{ extracted: { source: 'document_photo', cnh: '12345678901', name: 'Maria de Souza', birth_date: '1990-05-16' } }], state);
  assert.equal(cnhPhoto.identity_document_photo_received, true);
  assert.equal(core.salesFinancingCollection(officialContext(), state, cnhPhoto, product).ready, true);

  const cpfPhoto = core.salesDocumentStatus([{ extracted: { source: 'document_photo', cpf: '52998224725', name: 'Maria de Souza', birth_date: '1990-05-16' } }], state);
  assert.equal(cpfPhoto.identity_document_photo_received, true);
  assert.equal(core.salesFinancingCollection(officialContext(), state, cpfPhoto, product).ready, true);

  const split = core.salesDocumentStatus([
    { extracted: { source: 'customer_text', identity_scope: 'current_applicant', name: 'Maria de Souza' } },
    { extracted: { source: 'customer_text', identity_scope: 'current_applicant', birth_date: '1990-05-16' } },
    { extracted: { source: 'document_photo', cnh: '12345678901', name: 'Maria de Souza' } },
  ], { ...state, customer_name: '' });
  assert.equal(split.full_name_received, true);
  assert.equal(split.birth_date_received, true);
  assert.equal(split.identity_document_photo_received, true);
});
