const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const ext = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const validation = ext.nodes.find(node => node.name === 'Validar identidade e capacidade do tenant').parameters.jsCode;
const policy = ext.nodes.find(node => node.name.startsWith('EXT | Política')).parameters.jsCode;
const tenantId = '74b57037-9349-4a9e-889c-b65fb63c983a';
const input = { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', instance: 'genesis', remoteJid: '5511999999999@s.whatsapp.net', noria_extension: 'genesis', noria_contract_version: '1.0' };
const settings = { whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1', sales: { sheet_id: '1234567890123456789012345', google_sheets_access_token_env: 'GOOGLE_SHEETS_ACCESS_TOKEN', whatsapp_catalog_price_mode: 'sheet_authorized' } };

function values() {
  const rows = [['MODELO','MARCA','PRECO','COR','KM','ANO','COMBUSTIVEL','STATUS']];
  for (let n = 1; n <= 6; n += 1) rows.push([n === 6 ? 'CB 600RR' : `Modelo ${n}`, n === 6 ? 'Honda' : 'Marca', n === 6 ? '34980' : String(20000 + n), 'Preto', '1000', n === 6 ? '2007' : '2018', 'Gasolina', 'ANUNCIADO']);
  return { values: rows };
}
function snapshotRows() {
  return values().values.slice(1).map((row, index) => ({ vehicle_id: `${row[1].toLowerCase()}|${row[0].toLowerCase()}|${row[5]}|preto`, sheet_row: index + 2, brand: row[1], model: row[0], model_year: Number(row[5]), color: 'Preto', mileage_km: 1000, fuel: 'Gasolina', category: row[0] === 'CB 600RR' ? 'motorcycle' : 'car', status: 'announced', price_cents: Number(row[2]) * 100, availability_confirmed: false, price_source: 'genesis_sheet', observations: '', source_observed_at: '2026-10-14T13:00:00Z', synced_at: '2026-10-14T13:00:00Z' }));
}

function helper(calls, authorizedRows = snapshotRows()) {
  return { helpers: { httpRequest: async request => {
    calls.push(request);
    if (request.url.includes('/tenants?')) return [{ id: tenantId, slug: 'wesley_automoveis', status: 'active' }];
    if (request.url.includes('/tenant_settings?')) return [{ settings }];
    if (request.url.includes('/channels?')) return [{ external_id: 'genesis', status: 'active' }];
    if (request.url.includes('genesis_inventory_vehicles')) return authorizedRows;
    throw new Error(`unexpected ${request.url}`);
  } } };
}

test('bootstrap validates settings without inventory I/O; turn dispatch resolves the displayed sixth product', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key', GOOGLE_SHEETS_ACCESS_TOKEN: 'token' };
  const calls = [];
  const verified = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', validation).call(helper(calls), input, env, {}, () => ({}));
  assert.equal(verified.json.noria_verified_settings.sales.sheet_id, settings.sales.sheet_id);
  const bootstrap = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', policy).call(helper(calls), { ...verified.json, noria_dispatch_phase: 'bootstrap' }, env, {}, () => ({}));
  assert.equal(bootstrap.json.noria_business_context.phase, 'bootstrap');
  assert.equal(calls.some(call => call.url.includes('sheets.googleapis.com')), false);

  const catalog = values().values.slice(1).map((row, index) => ({ id: `${row[1].toLowerCase()}|${row[0].toLowerCase()}|${row[5]}|${row[3].toLowerCase()}`, model: row[0], brand: row[1], year: Number(row[5]), color: row[3] }));
  const dispatch = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', policy).call(helper(calls), {
    ...verified.json, noria_dispatch_phase: 'turn', contract: 'noria_business_operation_v1', operation: 'conversation.evaluate',
    payload: { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', session_id: 'initial', request_id: 'event-6:claim-token', turn: { grouped_messages: [{ id: 'm6', event_id: 'event-6', text: '6' }] }, commercial_state: { state: {}, revision: 4, ai_locked: false }, catalog_context: { products: catalog, displayed_at: '2026-10-14T13:00:00.000Z', source: 'genesis_sheet' } }
  }, env, {}, () => ({}));
  const business = dispatch.json.noria_business_context;
  assert.equal(business.resolved_selection.product.model, 'CB 600RR');
  assert.equal(business.resolved_selection.product.price_cents, 3498000);
  assert.equal(business.conversation_facts.contract, 'noria_genesis_conversation_facts_v1');
  assert.equal(business.conversation_facts.selection_status, 'resolved');
  assert.equal(business.conversation_facts.selection_source, 'current_turn');
  assert.equal(business.conversation_facts.selected_product.id, business.resolved_selection.product.id);
  assert.equal(business.conversation_facts.selected_product.km, 1000);
  assert.equal(business.conversation_facts.selected_product.fuel, 'Gasolina');
  assert.equal(business.conversation_facts.selected_product.availability_verified, false);
  assert.equal(business.session_id, 'initial');
  const snapshotCall = calls.find(call => call.url.includes('genesis_inventory_vehicles'));
  assert.match(snapshotCall.headers.Authorization, /^Bearer key$/);
  assert.equal(calls.some(call => call.url.includes('sheets.googleapis.com') || call.url.includes('/gviz/')), false);
});

test('EXT facts use the persisted SKU only while it remains offerable, and keep missing attributes null', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' };
  const rows = snapshotRows();
  const id = rows[5].vehicle_id;
  rows[5] = { ...rows[5], mileage_km: null, color: '', fuel: '', availability_confirmed: false };
  const base = { ...input, noria_verified_settings: { ...settings, tenant_id: tenantId },
    noria_dispatch_phase: 'turn', operation: 'conversation.evaluate',
    payload: { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', session_id: 'initial', request_id: 'event-facts:claim-token',
      turn: { grouped_messages: [{ event_id: 'event-facts', text: 'me fala os detalhes' }] },
      commercial_state: { state: { product_id: id }, revision: 2, ai_locked: false }, catalog_context: { products: [] } } };
  const invoke = async authorizedRows => (await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', policy).call(
    helper([], authorizedRows), base, env, {}, () => ({}))).json.noria_business_context.conversation_facts;
  const known = await invoke(rows);
  assert.equal(known.selection_status, 'resolved');
  assert.equal(known.selection_source, 'persisted_lead');
  assert.equal(known.selected_product.id, id);
  assert.equal(known.selected_product.km, null);
  assert.equal(known.selected_product.fuel, null);
  assert.equal(known.selected_product.color, null);
  const sold = await invoke(rows.map(row => row.vehicle_id === id ? { ...row, status: 'sold' } : row));
  assert.equal(sold.selection_status, 'unavailable');
  assert.equal(sold.selected_product, null);
  const noLongerInStock = await invoke(rows.filter(row => row.vehicle_id !== id));
  assert.equal(noLongerInStock.selection_status, 'unavailable');
  assert.equal(noLongerInStock.selection_source, 'no_longer_offerable');
  assert.equal(noLongerInStock.selected_product, null);
});

test('EXT never reuses a sold ordinal selection or the previous lead as current product facts', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' };
  const rows = snapshotRows();
  const selected = rows[5];
  const previous = rows[0];
  const catalog = rows.map(row => ({ id: row.vehicle_id, model: row.model, brand: row.brand }));
  const data = { ...input, noria_verified_settings: { ...settings, tenant_id: tenantId },
    noria_dispatch_phase: 'turn', operation: 'conversation.evaluate',
    payload: { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', session_id: 'initial',
      request_id: 'event-sold-ordinal:claim-token',
      turn: { grouped_messages: [{ event_id: 'event-sold-ordinal', text: '6' }] },
      commercial_state: { state: { product_id: previous.vehicle_id }, revision: 3, ai_locked: false },
      catalog_context: { products: catalog } } };
  const soldRows = rows.map(row => row.vehicle_id === selected.vehicle_id
    ? { ...row, status: 'sold', availability_confirmed: false } : row);
  const result = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', policy)
    .call(helper([], soldRows), data, env, {}, () => ({}));
  const facts = result.json.noria_business_context.conversation_facts;
  assert.equal(result.json.noria_business_context.resolved_selection.product.id, selected.vehicle_id);
  assert.equal(facts.selection_status, 'unavailable');
  assert.equal(facts.selection_source, 'no_longer_offerable');
  assert.equal(facts.selected_product, null);
});

test('CORE topology has exactly the bounded Genesis turn dispatch before the shared engine', () => {
  const prepare = core.nodes.find(node => node.name === 'CORE | Preparar dispatch Genesis');
  const dispatch = core.nodes.find(node => node.name === 'CORE | Executar EXT Genesis por turno');
  const engine = core.nodes.find(node => node.name.includes('Motor conversacional'));
  assert.ok(prepare && dispatch && engine);
  assert.equal(core.connections['CORE | Executar EXT Gênesis'].main[0][0].node, prepare.name);
  assert.equal(core.connections[prepare.name].main[0][0].node, dispatch.name);
  assert.equal(core.connections[dispatch.name].main[0][0].node, engine.name);
  assert.equal(dispatch.onError, 'continueRegularOutput');
  assert.match(prepare.parameters.jsCode, /magia_claim_turn/);
  assert.match(prepare.parameters.jsCode, /catalog_context/);
  assert.match(prepare.parameters.jsCode, /noria_dispatch_skip/);
  assert.match(engine.parameters.jsCode, /core-preclaimed-turn-dispatch-v1/);
  assert.match(engine.parameters.jsCode, /NORIA_EXT_DISPATCH_UNAVAILABLE/);
  assert.doesNotMatch(engine.parameters.jsCode, /genesisCommercialEngine\.cjs|\/gviz\//);
});

test('inventory authentication failure keeps the claimed dispatch identity', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key', GOOGLE_SHEETS_ACCESS_TOKEN: 'token' };
  const calls = [];
  const verified = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', validation).call(helper(calls), input, env, {}, () => ({}));
  const result = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', policy).call({ helpers: { httpRequest: async request => {
    calls.push(request);
    if (request.url.includes('genesis_inventory_vehicles')) throw new Error('HTTP 401 database credential rejected');
    return helper([]).helpers.httpRequest(request);
  } } }, {
    ...verified.json, noria_dispatch_phase: 'turn', contract: 'noria_business_operation_v1', operation: 'conversation.evaluate',
    payload: { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', session_id: 'session-current', request_id: 'event-1:claim-token', turn: { grouped_messages: [{ id: 'm1', event_id: 'event-1', text: 'qual o preço?' }] }, commercial_state: { state: {}, revision: 1, ai_locked: false }, catalog_context: { products: [] } }
  }, env, {}, () => ({}));
  const business = result.json.noria_business_context;
  assert.equal(business.status, 'error');
  assert.equal(business.error.code, 'INVENTORY_SNAPSHOT_AUTH_UNAVAILABLE');
  assert.equal(business.session_id, 'session-current');
  assert.equal(business.request_id, 'event-1:claim-token');
  assert.equal(business.provenance, 'genesis_extension_turn_dispatch_v1');
  assert.doesNotMatch(JSON.stringify(business), /refresh token expired/i);
});

test('pre-dispatch catalog recovery requires delivered evidence for the active session and retries a failed claim', async () => {
  const prepare = core.nodes.find(node => node.name === 'CORE | Preparar dispatch Genesis').parameters.jsCode;
  const run = async ({ events = [], failLead = false } = {}) => {
    const calls = [];
    const result = await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData', prepare).call({ helpers: { httpRequest: async request => {
      calls.push(request);
      if (request.url.includes('magia_claim_turn')) return { claimed: true, token: 'claim-token', boundary_id: 'session-current', messages: [{ id: 'm1', event_id: 'event-1', text: '6' }] };
      if (request.url.includes('sales_leads?')) { if (failLead) throw new Error('network timeout'); return [{ stage_key: 'sales_qualifying', ai_locked: false, revision: 3, state: {}, product: null }]; }
      if (request.url.includes('channel_events?')) return events;
      if (request.url.includes('magia_finish_turn')) return { finished: true, outcome: 'retry' };
      throw new Error(`unexpected ${request.url}`);
    } } }, { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', remoteJid: '5511999999999@s.whatsapp.net', noria_client_policy: { contract: 'noria_policy_v2', tenant_id: tenantId, tenant_slug: 'wesley_automoveis' } }, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' }, {}, () => ({}));
    return { result: result.json, calls };
  };
  const stale = await run({ events: [{ id: 'old', delivery_status: 'sent', created_at: '2026-10-01T00:00:00Z', raw_payload: { conversation_session_id: 'session-old', catalog_item_ids: ['old-6'], grouped_message_ids: ['old-message'] } }] });
  assert.deepEqual(stale.result.payload.catalog_context.products, []);
  const current = await run({ events: [{ id: 'current', delivery_status: 'sent', created_at: '2026-10-14T00:00:00Z', raw_payload: { conversation_session_id: 'session-current', catalog_context: { contract: 'noria_catalog_context_v1', session_id: 'session-current', products: [{ id: 'displayed-6' }] } } }] });
  assert.equal(current.result.payload.catalog_context.products[0].id, 'displayed-6');
  const failed = await run({ failLead: true });
  assert.equal(failed.result.noria_dispatch_skip, 'preparation_failed');
  assert.ok(failed.calls.some(call => call.url.includes('magia_finish_turn') && call.body.p_outcome === 'retry'));
});
