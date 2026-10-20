const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const line of fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function engine() {
  const exposed = code.replace(
    'try {\n  return { json: await runTurn() };',
    'return { salesDialogueFactLedger, salesValidatePrimaryDialogue, salesMentionedPriceCents, salesVehiclePriceClaimCents };\ntry {\n  return { json: await runTurn() };'
  );
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', exposed).call(
    { helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a', remoteJid: '5511999999999@s.whatsapp.net', instance: 'genesis-instance', noria_preclaimed_turn: { boundary_id: 'ledger-p0', messages: [] }, noria_business_context: { inventory: [] }, noria_client_policy: { profile: 'vehicle_sales_v1', capability: 'sales_v1', contract: 'noria_policy_v2', tenant_slug: 'wesley_automoveis', tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a', audio_enabled: false, scheduling_enabled: false } },
    process.env, {}, () => ({})
  );
}

async function rest(pathname, params = {}) {
  const url = new URL(process.env.SUPABASE_URL + '/rest/v1/' + pathname);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } });
  if (!response.ok) throw new Error('SUPABASE_READ_FAILED:' + response.status);
  return response.json();
}

test('P0 v2_1_28 ledger: four recorded messages reproduce against read-only production evidence', { timeout: 30000 }, async (t) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return t.skip('Supabase credentials unavailable');
  const executionIds = ['362511', '362521', '362537', '362546'];
  const records = await Promise.all(executionIds.map(async executionId => {
    const rows = await rest('channel_events', { select: 'raw_payload,message_text,ai_error', 'raw_payload->build_metadata->>execution_id': 'eq.' + executionId });
    assert.equal(rows.length, 1, 'recorded execution must be uniquely readable: ' + executionId);
    return rows[0];
  }));
  const inboundIds = records.map(row => row.raw_payload.grouped_message_ids[0]);
  const inbound = await rest('channel_events', { select: 'external_message_id,message_text', external_message_id: 'in.(' + inboundIds.join(',') + ')' });
  const sequence = inboundIds.map(id => inbound.find(row => row.external_message_id === id)?.message_text);
  assert.deepEqual(sequence, ['Ola, quais motocas têm', 'E carros ?', 'Qual o carro com menos km rodados ?', 'Fazem financiamento?']);
  assert.ok(records.every(row => row.raw_payload.build_metadata.core_sha256 === 'f14be5f652e8a337e57d14007a65a08c5b017939e9ae3771668ae64ce9cab99d'));
  assert.ok(records.every(row => row.raw_payload.build_metadata.ext_sha256 === '00de082c87823877c8bd64aa61b2f63d3595b84eabb8efae36902338ca2b18cd'));

  const settingsRows = await rest('tenant_settings', { select: 'settings', tenant_id: 'eq.74b57037-9349-4a9e-889c-b65fb63c983a' });
  const settings = settingsRows[0]?.settings;
  assert.equal(settings.sales.hot_lead_rule, 'deposit_30_and_financing_documents_v1');
  assert.equal(settings.sales.collect_documents, true);
  assert.deepEqual(settings.sales.required_financing_documents, ['cpf', 'cnh', 'birth_date']);

  const motorcycleInventory = records[0].raw_payload.catalog_context.products;
  const carInventory = records[1].raw_payload.catalog_context.products;
  const liveInventory = [...motorcycleInventory, ...carInventory];
  const sandbox = await engine();
  const context = { settings: { settings }, tenant: { id: '74b57037-9349-4a9e-889c-b65fb63c983a', name: settings.business_facts.name }, noria_business_context: { commercial_policy: {
    contract: 'noria_commercial_policy_v1', tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
    financing: { qualification_enabled: true, offered_by_business: null, offered_by_business_status: 'not_configured', hot_lead_percent: 30, required_documents: ['cpf', 'cnh', 'birth_date'] }
  } } };
  const ledger = sandbox.salesDialogueFactLedger(context, null, {}, {}, {}, [], liveInventory);
  assert.equal(ledger.official.sales_policy.financing_qualification_enabled, true);
  assert.equal(ledger.official.sales_policy.financing_offered_by_business, null);
  assert.equal(ledger.official.sales_policy.financing_offered_by_business_status, 'not_configured');
  assert.equal(ledger.official.inventory_by_id[motorcycleInventory[2].id].model, motorcycleInventory[2].model);
  assert.equal(ledger.official.inventory_by_id[carInventory[3].id].advertised_price_cents, carInventory[3].price_cents);

  const catalogPlan = { requests: [{ id: 'catalog', topic: 'catalog' }], next_requirement: 'none', handoff_reason: 'none' };
  const catalogContract = {
    primary_reply: 'Crosser e Onix são opções anunciadas.',
    state: {},
    primary_facts: ledger.facts,
    response_contract: { answers: [{ request_id: 'catalog', excerpt: 'Crosser e Onix são opções anunciadas' }], requested_fields: [], facts: [
      { fact_id: 'official.inventory.3', value: motorcycleInventory[2].model, excerpt: 'Crosser' },
      { fact_id: 'official.inventory.7', value: carInventory[3].model, excerpt: 'Onix' }
    ], availability_asserted: false, assignment_confirmed: false, photo_sent: false }
  };
  const catalogAudit = sandbox.salesValidatePrimaryDialogue(catalogContract, catalogPlan, {}, { inventory: liveInventory });
  assert.equal(catalogAudit.status, 'accepted', JSON.stringify(catalogAudit));

  assert.deepEqual(sandbox.salesMentionedPriceCents('O veículo tem 14 mil km rodados'), []);
  assert.deepEqual(sandbox.salesVehiclePriceClaimCents('O veículo tem 14 mil km rodados'), []);

  const financingPlan = { requests: [{ id: 'financing', topic: 'financing' }], next_requirement: 'none', handoff_reason: 'none' };
  const financingAudit = sandbox.salesValidatePrimaryDialogue({
    primary_reply: 'Preciso confirmar essa possibilidade com a equipe.', state: {}, primary_facts: ledger.facts,
    response_contract: { answers: [{ request_id: 'financing', excerpt: 'confirmar essa possibilidade com a equipe' }], requested_fields: [], facts: [{ fact_id: 'official.sales_policy.financing_offered_by_business_status', value: 'not_configured', excerpt: 'confirmar essa possibilidade com a equipe' }], availability_asserted: false, assignment_confirmed: false, photo_sent: false }
  }, financingPlan, {}, { inventory: liveInventory });
  assert.equal(financingAudit.status, 'accepted', JSON.stringify(financingAudit));
});
