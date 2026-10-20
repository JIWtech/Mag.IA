const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Load Environment
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const root = path.resolve(__dirname, '..');
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const salesConfig = JSON.parse(fs.readFileSync(path.join(root, 'clients/wesley_automoveis/sales.json'), 'utf8'));

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

// Sanitized exact snapshot of Supabase genesis_inventory_vehicles (11 rows)
const CANONICAL_SUPABASE_SNAPSHOT = [
  { id: 'nissan|versa sl|2013|prata', model: 'VERSA SL', brand: 'NISSAN', year: 2013, color: 'PRATA', price_cents: 2798000, status: 'announced', offerable: true, category: 'car', commercial_name: 'Nissan VERSA SL 2013' },
  { id: 'mercedes|c180|2015|', model: 'C180', brand: 'MERCEDES', year: 2015, color: '', price_cents: 9498000, status: 'announced', offerable: true, category: 'car', commercial_name: 'Mercedes C180 2015' },
  { id: 'toyota|land prado|2005|', model: 'LAND PRADO', brand: 'TOYOTA', year: 2005, color: '', price_cents: 8998000, status: 'announced', offerable: true, category: 'car', commercial_name: 'Toyota LAND PRADO 2005' },
  { id: 'chevrolet|onix|2020|', model: 'ONIX', brand: 'CHEVROLET', year: 2020, color: '', price_cents: 4698000, status: 'announced', offerable: true, category: 'car', commercial_name: 'Chevrolet ONIX 2020' },
  { id: 'honda|tornado 300l|2025|vermelho', model: 'TORNADO 300L', brand: 'HONDA', year: 2025, color: 'VERMELHO', price_cents: 2898000, status: 'announced', offerable: true, category: 'motorcycle', commercial_name: 'Honda TORNADO 300L 2025' },
  { id: 'honda|pcx|2023|branca', model: 'PCX', brand: 'HONDA', year: 2023, color: 'BRANCA', price_cents: 1749900, status: 'announced', offerable: true, category: 'motorcycle', commercial_name: 'Honda PCX 2023' },
  { id: 'yamaha|crosser|2023|', model: 'CROSSER', brand: 'YAMAHA', year: 2023, color: '', price_cents: 1798000, status: 'announced', offerable: true, category: 'motorcycle', commercial_name: 'Yamaha CROSSER 2023' },
  { id: 'honda|cb 600rr|2007|', model: 'CB 600RR', brand: 'HONDA', year: 2007, color: '', price_cents: 3498000, status: 'announced', offerable: true, category: 'motorcycle', commercial_name: 'Honda CB 600RR 2007' },
  { id: 'renault|sandero gt line|2016|branco', model: 'SANDERO GT LINE', brand: 'RENAULT', year: 2016, color: 'BRANCO', price_cents: 3699900, status: 'sold', offerable: false, category: 'car', commercial_name: 'Renault SANDERO GT LINE 2016' },
  { id: 'yamaha|crosser|2021|preto', model: 'CROSSER', brand: 'YAMAHA', year: 2021, color: 'PRETO', price_cents: 1349900, status: 'sold', offerable: false, category: 'motorcycle', commercial_name: 'Yamaha CROSSER 2021' },
  { id: 'honda|pcx|2018|prata', model: 'PCX', brand: 'HONDA', year: 2018, color: 'PRATA', price_cents: 1398000, status: 'unverified', offerable: false, category: 'motorcycle', commercial_name: 'Honda PCX 2018' },
];
const PROD_INVENTORY = CANONICAL_SUPABASE_SNAPSHOT;

function emptyState() {
  return {
    intent: 'unknown',
    transaction_mode: 'unknown',
    payment_mode: 'unknown',
    payment_evidence: '',
    customer_name: '',
    name_evidence: '',
    product_id: '',
    product_evidence: '',
    product_variant_evidence: '',
    deposit_cents: null,
    deposit_evidence: '',
    sell_brand: '',
    sell_model: '',
    sell_year: null,
    sell_brand_evidence: '',
    sell_model_evidence: '',
    sell_year_evidence: '',
    sell_vehicle: {
      brand: '',
      model: '',
      year: null,
      category: 'unknown',
      mileage_km: null,
      auction_history: 'unknown',
      sinister_history: 'unknown',
      raw_mention: '',
      description_summary: '',
      reported_facts: [],
      concerns: [],
      maintenance_history: [],
      evidence_ids: [],
      maintenance_reported: false,
      maintenance_evidence_ids: [],
      condition_reported: false,
      condition_evidence_ids: [],
      eligibility: 'unknown',
      rejection_reason: '',
      rejection_evidence_ids: [],
      rejected_at: '',
    },
    buy_interest: { brand: '', model: '', year: null, raw_mention: '', product_id: '', evidence_ids: [] },
  };
}

async function runTurnSimulation(turnParams) {
  const {
    text,
    remoteJid = '5521985198468@s.whatsapp.net',
    inventory = PROD_INVENTORY,
    inventoryUnavailable = false,
    responseMock = null
  } = turnParams;

  const sent = [];
  const savedEvents = [];
  const salesSaves = [];
  let leadStateInDb = null;
  const boundary = 'initial';

  const defaultMock = {
    action: 'catalog',
    reason: 'none',
    reply: 'Hoje temos estas opções de veículos disponíveis para consulta (disponibilidade a confirmar):\n\n1. Nissan VERSA SL 2013, Prata — R$ 27.980,00\n2. Mercedes C180 2015 — R$ 94.980,00\n3. Toyota LAND PRADO 2005 — R$ 89.980,00\n4. Chevrolet ONIX 2020 — R$ 46.980,00\n\nA disponibilidade de cada veículo precisa ser confirmada com a equipe.\n\nQual deles chamou mais sua atenção?',
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Hoje temos estas opções de veículos disponíveis para consulta (disponibilidade a confirmar):' }],
      requested_fields: [],
      facts: [
        { fact_id: 'inv_versa', value: '2798000', excerpt: 'Nissan VERSA SL 2013, Prata — R$ 27.980,00' },
        { fact_id: 'inv_c180', value: '9498000', excerpt: 'Mercedes C180 2015 — R$ 94.980,00' },
        { fact_id: 'inv_prado', value: '8998000', excerpt: 'Toyota LAND PRADO 2005 — R$ 89.980,00' },
        { fact_id: 'inv_onix', value: '4698000', excerpt: 'Chevrolet ONIX 2020 — R$ 46.980,00' }
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'catalog' }],
      next_requirement: 'none',
      catalog_list_requested: true,
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'car',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: []
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy',
      customer_name: 'João Victor Santos',
    },
    semantic_intent: {
      primary_intent: 'inventory_search',
      secondary_intents: [],
      topics: ['catalog'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: {
        requested: true,
        category: 'cars',
        price_min_cents: null,
        price_max_cents: null,
        preferences: [],
        exclusions: [],
        evidence_ids: ['m1']
      },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: []
    }
  };

  const actualMock = responseMock || defaultMock;

  const request = async (opts) => {
    const urlStr = typeof opts === 'string' ? opts : opts.url;
    const parsed = new URL(urlStr);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body;

    if (parsed.pathname.includes(':generateContent')) {
      return {
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(actualMock) }] },
        }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      };
    }

    if (parsed.pathname.startsWith('/rest/v1/')) {
      const table = parsed.pathname.replace('/rest/v1/', '').split('?')[0];

      if (table === 'tenants') {
        return [{ id: 'tenant-genesis', slug: 'wesley_automoveis', status: 'active' }];
      }
      if (table === 'tenant_settings') {
        return [{
          tenant_id: 'tenant-genesis',
          settings: {
            conversation_capability: 'sales_v1',
            whatsapp_processing_mode: 'conversation_core_v1',
            grounding_mode: 'canonical_v2',
            system_prompt: 'Gênesis Automóveis',
            ai_model: 'gemini-3.5-flash-lite',
            ai_enabled: true,
            sales: salesConfig,
            business_facts: { locations: [{ verified: true, address: 'Rua das Palmeiras, 100' }] },
            sdr_rules: { hot_lead_percent: 30, minimum_purchase_year: 1995 },
          },
        }];
      }
      if (table === 'channels') {
        return [{ id: 'chan-1', external_id: 'genesis-instance', status: 'active', type: 'whatsapp' }];
      }
      if (table === 'contacts') {
        return [{ id: 'contact-1', name: 'João Victor Santos', handle: '5521985198468', metadata: {} }];
      }
      if (table === 'sales_leads') {
        return leadStateInDb ? [leadStateInDb] : [];
      }
      if (table === 'sales_documents') {
        return [];
      }
      if (table === 'channel_events') {
        if (method === 'POST') {
          const evt = { ...body, id: 'event-' + Math.random().toString(36).slice(2, 9), created_at: new Date().toISOString() };
          savedEvents.push(evt);
          return [evt];
        }
        if (parsed.searchParams.get('or')?.includes('conversation_closed')) {
          return [];
        }
        return [];
      }
      if (table === 'rpc/magia_sales_save') {
        salesSaves.push(body);
        leadStateInDb = {
          id: 'lead-' + Math.random().toString(36).slice(2, 9),
          tenant_id: 'tenant-genesis',
          session_id: body.p_session,
          revision: (body.p_revision || 0) + 1,
          state: body.p_state,
          product: body.p_product || null,
          stage_key: body.p_stage,
          ai_locked: false,
          interest_registered: body.p_register === true,
        };
        return leadStateInDb;
      }
      if (table === 'rpc/magia_commit_turn') return { committed: true };
      if (table === 'rpc/magia_finish_turn') return {};
      if (table === 'rpc/magia_begin_turn_delivery') return { id: 'delivery-1' };
      if (table === 'rpc/magia_confirm_turn_delivery') return { confirmed: true };
      return [];
    }

    if (urlStr.includes('message/sendText') || urlStr.includes('messages')) {
      sent.push(body);
      return { key: { id: 'out-1' } };
    }

    return [];
  };

  const businessContext = inventoryUnavailable
    ? {
      contract: 'noria_business_result_v1',
      tenant_slug: 'wesley_automoveis',
      phase: 'turn',
      session_id: boundary,
      request_id: 'e1:turn-token-1',
      status: 'error',
      error: { code: 'INVENTORY_SNAPSHOT_UNAVAILABLE', message: 'Simulated EXT inventory failure' },
      inventory: []
    }
    : {
      contract: 'noria_business_result_v1',
      tenant_slug: 'wesley_automoveis',
      phase: 'turn',
      session_id: boundary,
      request_id: 'e1:turn-token-1',
      status: 'ok',
      inventory: inventory,
      offerable_catalog: inventory.filter(v => v.offerable !== false && v.status === 'announced'),
      catalog_filters: {
        all: inventory.filter(v => v.offerable !== false && v.status === 'announced'),
        cars: inventory.filter(v => v.offerable !== false && v.status === 'announced' && v.category === 'car'),
        motorcycles: inventory.filter(v => v.offerable !== false && v.status === 'announced' && v.category === 'motorcycle'),
      },
      conversation_facts: {
        contract: 'noria_genesis_conversation_facts_v1',
        selection_status: 'none',
        selected_product: null
      }
    };

  const turn = {
    claimed: true,
    token: 'turn-token-1',
    boundary_id: boundary,
    messages: [{ id: 'm1', event_id: 'e1', text, received_at: new Date().toISOString() }],
  };

  const runner = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode);

  const result = await runner.call(
    { helpers: { httpRequest: request } },
    {
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-genesis',
      remoteJid,
      instance: 'genesis-instance',
      noria_preclaimed_turn: turn,
      noria_business_context: businessContext,
      noria_client_policy: {
        profile: 'vehicle_sales_v1',
        capability: 'sales_v1',
        contract: 'noria_policy_v2',
        tenant_slug: 'wesley_automoveis',
        tenant_id: 'tenant-genesis',
        audio_enabled: false,
        scheduling_enabled: false,
        stages: salesConfig.stages,
        stage_keys: salesConfig.stage_keys,
      },
    },
    {
      SUPABASE_URL: 'https://db.test',
      SUPABASE_SERVICE_ROLE_KEY: 'fake',
      GEMINI_ENABLED: 'true',
      GEMINI_API_KEY: 'fake',
      EVOLUTION_API_URL_WESLEY_AUTOMOVEIS: 'https://evo.test',
      EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS: 'fake',
      EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS: 'genesis-instance',
    },
    {},
    () => ({})
  );

  return { result: result.json, sent, savedEvents, salesSaves, leadStateInDb };
}

// =========================================================================
// TEST SUITE: P0 CATALOG HOTFIX VERIFICATION
// =========================================================================

function genesisExtTurnInput() {
  return {
    tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
    tenant_slug: 'wesley_automoveis',
    noria_extension: 'genesis',
    noria_dispatch_phase: 'turn',
    operation: 'conversation.evaluate',
    payload: {
      contract: 'noria_business_operation_v1',
      operation: 'conversation.evaluate',
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      tenant_slug: 'wesley_automoveis',
      session_id: 'session-genesis-test-1',
      request_id: 'm1:turn-token-genesis-1',
      turn: { message: 'Quais carros ?', grouped_messages: [{ id: 'm1', event_id: 'e1', text: 'Quais carros ?' }] },
      commercial_state: { stage_key: 'sales_qualifying', ai_locked: false, revision: 1, state: {}, product: null },
      catalog_context: { products: [], displayed_at: null, source: 'none' }
    },
    noria_verified_settings: {
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      whatsapp_processing_mode: 'conversation_core_v1',
      conversation_capability: 'sales_v1',
      whatsapp_audio_enabled: true,
      appointment_scheduling: { enabled: false },
      sales: salesConfig
    }
  };
}

test('TEST 1: Genesis EXT snapshot contract returns 11 vehicles with 4 cars and 4 motorcycles', async () => {
  let httpRequestCalled = false;
  const extHelpers = {
    httpRequest: async (opts) => {
      httpRequestCalled = true;
      return CANONICAL_SUPABASE_SNAPSHOT.map(v => ({
        vehicle_id: v.id,
        sheet_row: 1,
        brand: v.brand,
        model: v.model,
        model_year: v.year,
        color: v.color || '',
        category: v.category,
        status: v.status,
        price_cents: v.price_cents,
        availability_confirmed: v.offerable,
        price_source: 'genesis_supabase_snapshot',
        observations: ''
      }));
    }
  };

  const extRunner = new AsyncFunction('$json', '$env', extCode);
  const extResult = await extRunner.call(
    { helpers: extHelpers },
    {
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      tenant_slug: 'wesley_automoveis',
      noria_extension: 'genesis',
      noria_dispatch_phase: 'turn',
      operation: 'conversation.evaluate',
      payload: {
        contract: 'noria_business_operation_v1',
        operation: 'conversation.evaluate',
        tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
        tenant_slug: 'wesley_automoveis',
        session_id: 'session-genesis-test-1',
        request_id: 'm1:turn-token-genesis-1',
        turn: { message: 'Quais carros ?', grouped_messages: [{ id: 'm1', event_id: 'e1', text: 'Quais carros ?' }] },
        commercial_state: { stage_key: 'sales_qualifying', ai_locked: false, revision: 1, state: {}, product: null },
        catalog_context: { products: [], displayed_at: null, source: 'none' }
      },
      noria_verified_settings: {
        tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
        whatsapp_processing_mode: 'conversation_core_v1',
        conversation_capability: 'sales_v1',
        whatsapp_audio_enabled: true,
        appointment_scheduling: { enabled: false },
        sales: salesConfig
      }
    },
    process.env
  );

  assert.ok(httpRequestCalled, 'EXT must query database');
  assert.equal(extResult.json.noria_business_context.status, 'ok', 'Status must be ok without ReferenceError');
  assert.equal(extResult.json.noria_business_context.error, undefined, 'There must be no error');
  const inv = extResult.json.noria_business_context.inventory;
  assert.equal(inv.length, 11, 'Must return all 11 inventory vehicles');
  const offerableCars = inv.filter(v => v.category === 'car' && v.offerable !== false && v.status === 'announced');
  const offerableBikes = inv.filter(v => v.category === 'motorcycle' && v.offerable !== false && v.status === 'announced');
  assert.equal(offerableCars.length, 4, 'Must have exactly 4 announced offerable cars');
  assert.equal(offerableBikes.length, 4, 'Must have exactly 4 announced offerable motorcycles');
});

const hasLiveSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
test('INTEGRATION: Genesis EXT reads the real Supabase inventory without snapshot fallback',
  { skip: !hasLiveSupabase }, async () => {
    const extRunner = new AsyncFunction('$json', '$env', extCode);
    const extResult = await extRunner.call({
      helpers: {
        httpRequest: async opts => {
          const response = await fetch(opts.url, { method: opts.method, headers: opts.headers });
          if (!response.ok) throw new Error('SUPABASE_HTTP_' + response.status);
          return response.json();
        }
      }
    }, genesisExtTurnInput(), process.env);
    assert.equal(extResult.json.noria_business_context.status, 'ok');
    const inventory = extResult.json.noria_business_context.inventory;
    assert.ok(Array.isArray(inventory) && inventory.length > 0, 'Live inventory must be nonempty');
    assert.ok(inventory.some(vehicle => vehicle.id === 'honda|tornado 300l|2025|vermelho'),
      'Live inventory must contain the canonical Tornado ID');
  });

test('TEST 2: "Quais carros ?" presented with available stock -> presents 4 cars, sets catalogPresented=true and catalog_item_ids', async () => {
  const { result, sent, savedEvents } = await runTurnSimulation({
    text: 'Quais carros ?',
    inventory: PROD_INVENTORY,
    inventoryUnavailable: false
  });

  assert.ok(result.ok, 'Turn should complete ok');
  assert.equal(sent.length, 1, 'One WhatsApp message must be sent');

  // Must present cars with real canonical prices
  const reply = sent[0].text;
  assert.ok(reply.includes('Versa') || reply.includes('C180') || reply.includes('Prado') || reply.includes('Onix'), 'Reply must name available cars: ' + reply);

  // Find outbound event in savedEvents
  const outboundEvt = savedEvents.find(e => e.direction === 'outbound');
  assert.ok(outboundEvt, 'Outbound event must be logged');
  assert.equal(outboundEvt.raw_payload.dialogue_audit.status, 'accepted', 'Dialogue audit must accept reply with canonical facts and prices');
  assert.equal(outboundEvt.raw_payload.dialogue_audit.issues.length, 0, 'Must have zero audit issues: ' + JSON.stringify(outboundEvt.raw_payload.dialogue_audit.issues));
  assert.ok(outboundEvt.raw_payload.catalog_item_ids, 'catalog_item_ids must be populated when catalog is presented');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.length >= 1, 'At least one car presented');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('nissan|versa sl|2013|prata') || outboundEvt.raw_payload.catalog_item_ids.includes('mercedes|c180|2015|'), 'Must include offerable car IDs');

  // Must NOT include sold cars or motorcycles
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('renault|sandero gt line|2016|branco'), 'Sold Sandero must NEVER be presented');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('yamaha|crosser|2021|preto'), 'Sold Crosser must NEVER be presented');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('honda|tornado 300l|2025|vermelho'), 'Motorcycles must not be in car catalog');
});

test('TEST 3: "Quais motos ?" presented with available stock -> presents 4 motorcycles and excludes sold/unverified', async () => {
  const mockGeminiBikes = {
    action: 'catalog',
    reason: 'none',
    reply: 'Temos as seguintes motos anunciadas em nosso estoque: Honda Tornado 300L 2025, Honda PCX 2023, Yamaha Crosser 2023 e Honda CB 600RR 2007. Alguma delas te interessa?',
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Temos as seguintes motos anunciadas em nosso estoque: Honda Tornado 300L 2025, Honda PCX 2023, Yamaha Crosser 2023 e Honda CB 600RR 2007.' }],
      requested_fields: [],
      facts: [
        { fact_id: 'inv_tornado', value: '2898000', excerpt: 'Honda Tornado 300L 2025' },
        { fact_id: 'inv_pcx2023', value: '1749900', excerpt: 'Honda PCX 2023' },
        { fact_id: 'inv_crosser', value: '1798000', excerpt: 'Yamaha Crosser 2023' },
        { fact_id: 'inv_cb600rr', value: '3498000', excerpt: 'Honda CB 600RR 2007' }
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'catalog' }],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'motorcycle',
        vehicle_kind_evidence_ids: ['e1'],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: []
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy',
      customer_name: 'Michel',
    },
    semantic_intent: {
      primary_intent: 'inventory_search',
      secondary_intents: [],
      topics: ['catalog'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: {
        requested: true,
        category: 'motorcycles',
        price_min_cents: null,
        price_max_cents: null,
        preferences: [],
        exclusions: [],
        evidence_ids: ['e1']
      },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: []
    }
  };

  const { result, sent, savedEvents } = await runTurnSimulation({
    text: 'Quais motos ?',
    inventory: PROD_INVENTORY,
    inventoryUnavailable: false,
    responseMock: mockGeminiBikes
  });

  assert.ok(result.ok, 'Turn should complete ok');
  assert.equal(sent.length, 1, 'One WhatsApp message must be sent');
  const outboundEvt = savedEvents.find(e => e.direction === 'outbound');
  assert.ok(outboundEvt, 'Outbound event must be logged');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids, 'catalog_item_ids must be present for motorcycle catalog');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('honda|tornado 300l|2025|vermelho'),
    'Must include Tornado 300L: ' + JSON.stringify({ ids: outboundEvt.raw_payload.catalog_item_ids, reply: sent[0]?.text, ai_error: outboundEvt.ai_error, plan: outboundEvt.raw_payload.dialogue_plan_failure, audit: outboundEvt.raw_payload.dialogue_audit, context: outboundEvt.raw_payload.catalog_context }));
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('yamaha|crosser|2023|'), 'Must include Crosser 2023');

  // Sold and unverified MUST NOT be included
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('yamaha|crosser|2021|preto'), 'Sold Crosser 2021 must NOT be in catalog items');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('honda|pcx|2018|prata'), 'Unverified PCX 2018 must NOT be in catalog items');
});

test('TEST 4: EXT Failure / Inventory Unavailable -> rejects model fluff, delivers truthful notice, catalog_item_ids=null', async () => {
  // Simulate Gemini returning the EXACT incident response:
  // "Confira os carros disponíveis em nosso estoque. Temos ótimas opções para você!"
  const mockIncidentGemini = {
    action: 'catalog',
    reason: 'none',
    reply: 'Confira os carros disponíveis em nosso estoque. Temos ótimas opções para você!',
    response_contract: {
      answers: [{ request_id: 'request_1', excerpt: 'Confira os carros disponíveis em nosso estoque.' }],
      requested_fields: [],
      facts: [],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'request_1', topic: 'catalog' }],
      next_requirement: 'none',
      catalog_list_requested: true,
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'car',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: []
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy',
      customer_name: 'João Victor Santos',
    },
    semantic_intent: {
      primary_intent: 'inventory_search',
      secondary_intents: [],
      topics: ['catalog'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: {
        requested: true,
        category: 'cars',
        price_min_cents: null,
        price_max_cents: null,
        preferences: [],
        exclusions: [],
        evidence_ids: ['m1']
      },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: []
    }
  };

  const { result, sent, savedEvents } = await runTurnSimulation({
    text: 'Quais carros ?',
    inventory: [],
    inventoryUnavailable: true,
    responseMock: mockIncidentGemini
  });

  const outboundEvt = savedEvents.find(e => e.direction === 'outbound');
  assert.ok(outboundEvt, 'Outbound event must be logged');

  // 1. Dialogue audit must reject the model fluff
  assert.ok(outboundEvt.raw_payload.dialogue_audit, 'Dialogue audit must be present');
  assert.equal(outboundEvt.raw_payload.dialogue_audit.status, 'needs_human_review', 'Audit must reject fluff when inventory is unavailable');
  assert.ok(
    outboundEvt.raw_payload.dialogue_audit.issues.includes('INVENTORY_UNAVAILABLE_CATALOG_CLAIM') ||
    outboundEvt.raw_payload.dialogue_audit.issues.includes('UNFULFILLED_CATALOG_REQUEST'),
    'Audit issues must explain rejection: ' + JSON.stringify(outboundEvt.raw_payload.dialogue_audit.issues)
  );

  // 2. Reply MUST NOT be the false model promise
  assert.equal(sent.length, 1, 'Must send message');
  const deliveredReply = sent[0].text;
  assert.notEqual(deliveredReply, 'Confira os carros disponíveis em nosso estoque. Temos ótimas opções para você!');
  assert.ok(
    deliveredReply.includes('Não consegui consultar agora os veículos') ||
    deliveredReply.includes('dificuldade temporária'),
    'Reply must be truthful technical notice: ' + deliveredReply
  );

  // 3. ZERO ghost catalog items
  assert.equal(outboundEvt.raw_payload.catalog_item_ids, undefined, 'catalog_item_ids must be undefined/absent when inventory is unavailable');
});

test('TEST 5: Anti-hardcoding verification - No forbidden conversational text injected in sources', async () => {
  const auditScript = path.join(__dirname, '../scripts/audit_anti_hardcode.cjs');
  const { execSync } = require('node:child_process');
  const output = execSync(`node "${auditScript}"`, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.ok(output.includes('ANTI-HARDCODE AUDIT PASSED'), 'Audit anti-hardcode must pass 100%');
});

test('TEST 6: "Quais as outras motocas?" with prior Crosser 2023 focus -> presents alternatives and excludes Crosser 2023', async () => {
  const mockAlternatives = {
    action: 'catalog',
    reason: 'none',
    reply: 'Além da Crosser, temos estas outras opções de motos em nosso estoque: Honda Tornado 300L 2025, Honda PCX 2023 e Honda CB 600RR 2007. Alguma delas te interessa?',
    response_contract: {
      answers: [{ request_id: 'request_1', excerpt: 'Além da Crosser, temos estas outras opções de motos em nosso estoque: Honda Tornado 300L 2025, Honda PCX 2023 e Honda CB 600RR 2007.' }],
      requested_fields: [],
      facts: [
        { fact_id: 'inv_tornado', value: '2898000', excerpt: 'Honda Tornado 300L 2025' },
        { fact_id: 'inv_pcx2023', value: '1749900', excerpt: 'Honda PCX 2023' },
        { fact_id: 'inv_cb600rr', value: '3498000', excerpt: 'Honda CB 600RR 2007' }
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'request_1', topic: 'catalog' }],
      next_requirement: 'none',
      catalog_list_requested: true,
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'motorcycle',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: []
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy',
      customer_name: 'João Victor Santos',
      product_id: 'yamaha|crosser|2023|'
    },
    semantic_intent: {
      primary_intent: 'inventory_search',
      secondary_intents: [],
      topics: ['catalog'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: {
        requested: true,
        category: 'motorcycles',
        price_min_cents: null,
        price_max_cents: null,
        preferences: [],
        exclusions: ['model=CROSSER'],
        evidence_ids: ['m1']
      },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: true, requires_clarification: false },
      ambiguities: []
    }
  };

  const { result, sent, savedEvents } = await runTurnSimulation({
    text: 'Quais as outras motocas?',
    inventory: PROD_INVENTORY,
    inventoryUnavailable: false,
    responseMock: mockAlternatives
  });

  assert.ok(result.ok, 'Turn should complete ok');
  assert.equal(sent.length, 1, 'One WhatsApp message must be sent');
  const outboundEvt = savedEvents.find(e => e.direction === 'outbound');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids, 'catalog_item_ids must be present');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('honda|tornado 300l|2025|vermelho'), 'Must present Tornado 300L');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('honda|pcx|2023|branca'), 'Must present PCX 2023');
  assert.ok(outboundEvt.raw_payload.catalog_item_ids.includes('honda|cb 600rr|2007|'), 'Must present CB 600RR');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('yamaha|crosser|2021|preto'), 'Must not present sold Crosser 2021');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('honda|pcx|2018|prata'), 'Must not present unverified PCX 2018');
  assert.ok(!outboundEvt.raw_payload.catalog_item_ids.includes('yamaha|crosser|2023|'), 'Must exclude prior Crosser 2023 from alternatives');
});

test('TEST 7: Sold vehicle (Crosser 2021) and unverified vehicle (PCX 2018) are NOT offerable', async () => {
  const soldCrosser = PROD_INVENTORY.find(v => v.id === 'yamaha|crosser|2021|preto');
  assert.ok(soldCrosser, 'Sold Crosser must exist in test inventory');
  assert.equal(soldCrosser.status, 'sold');
  assert.equal(soldCrosser.offerable, false);

  const unverifiedPcx = PROD_INVENTORY.find(v => v.id === 'honda|pcx|2018|prata');
  assert.ok(unverifiedPcx, 'Unverified PCX must exist in test inventory');
  assert.equal(unverifiedPcx.status, 'unverified');
  assert.equal(unverifiedPcx.offerable, false);

  const soldSandero = PROD_INVENTORY.find(v => v.id === 'renault|sandero gt line|2016|branco');
  assert.ok(soldSandero, 'Sold Sandero must exist in test inventory');
  assert.equal(soldSandero.status, 'sold');
  assert.equal(soldSandero.offerable, false);
});

test('TEST 8: Incidente 1 (354466) - "Aceitam a minha moto de entrada e o resto financiado ?" validates trade_in_policy, avoids sell_model, delivers natural reply', async () => {
  const mockTradeInPolicy = {
    action: 'reply',
    reason: 'none',
    reply: 'Sim! Aceitamos sua moto como parte da entrada, mediante avaliação presencial da nossa equipe. O restante pode ser financiado com nossos bancos parceiros. Qual veículo do nosso estoque você tem interesse em comprar?',
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Sim! Aceitamos sua moto como parte da entrada' }],
      requested_fields: [],
      facts: [
        { fact_id: 'trade_in_policy', value: 'true', excerpt: 'Aceitamos sua moto como parte da entrada' }
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'trade_in' }],
      next_requirement: 'purchase_product',
      catalog_list_requested: false,
      memory: {
        trade_in_status: 'policy_discussed',
        evidence_ids: ['m1'],
        vehicle_kind: 'motorcycle',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'entry_inquiry',
        customer_vehicle_purpose_evidence_ids: ['m1']
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy_and_sell',
      payment_mode: 'financing',
      customer_name: 'João Victor Santos'
    },
    semantic_intent: {
      primary_intent: 'trade_in',
      secondary_intents: ['financing'],
      topics: ['trade_in', 'financing'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
      customer_vehicle: { purpose: 'entry_inquiry', evidence_ids: ['m1'] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: []
    }
  };

  const { result, sent, savedEvents, salesSaves } = await runTurnSimulation({
    text: 'Aceitam a minha moto de entrada e o resto financiado ?',
    inventory: PROD_INVENTORY,
    inventoryUnavailable: false,
    responseMock: mockTradeInPolicy
  });

  assert.ok(result.ok, 'Turn should complete ok');
  assert.equal(sent.length, 1, 'One WhatsApp message must be sent');
  const sentText = sent[0]?.text || sent[0];
  assert.match(sentText, /Aceitamos sua moto como parte da entrada/i, 'Must send the model reply, not fallback');
  assert.doesNotMatch(sentText, /dificuldade temporária|não consegui/i, 'Must NOT trigger fallback');

  const outboundEvt = savedEvents.find(e => e.direction === 'outbound');
  assert.ok(!outboundEvt.ai_error, 'Must have no ai_error (no UNSUPPORTED_FACT:trade_in_policy)');

  const lastSave = salesSaves.at(-1);
  const pendingReq = lastSave?.p_state?.dialogue_context?.pending_requirement || lastSave?.p_state?.pending_requirement;
  assert.notEqual(pendingReq, 'sell_model', 'Pending requirement must NOT be sell_model on pure entry_inquiry');
});

test('TEST 10: rejected dialogue does not advance pending_requirement', async () => {
  const mockHallucinatedPrice = {
    action: 'reply',
    reason: 'none',
    reply: 'O Nissan Versa SL 2013 sai por R$ 50.000,00 à vista.',
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'O Nissan Versa SL 2013 sai por R$ 50.000,00' }],
      requested_fields: ['customer_cpf'],
      facts: [
        { fact_id: 'nissan|versa sl|2013|prata:price', value: '5000000', excerpt: 'R$ 50.000,00' }
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'price' }],
      next_requirement: 'customer_cpf',
      catalog_list_requested: false,
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'car',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: []
      },
      human_requested: false,
      handoff_reason: 'none'
    },
    state: {
      ...emptyState(),
      intent: 'buy',
      transaction_mode: 'buy'
    },
    semantic_intent: {
      primary_intent: 'pricing_inquiry',
      secondary_intents: [],
      topics: ['pricing'],
      confidence: 'high',
      customer_disposition: { value: 'active', evidence_ids: [] },
      catalog: { requested: false, category: 'car', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: ['nissan|versa sl|2013|prata'], evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: []
    }
  };

  const { result, sent, savedEvents, salesSaves } = await runTurnSimulation({
    text: 'Qual o valor do Versa ?',
    inventory: PROD_INVENTORY,
    inventoryUnavailable: false,
    responseMock: mockHallucinatedPrice
  });

  assert.ok(result.ok, 'Turn must complete safely');
  const lastSave = salesSaves.at(-1);
  const pendingReq = lastSave?.p_state?.dialogue_context?.pending_requirement || lastSave?.p_state?.pending_requirement;
  assert.notEqual(pendingReq, 'customer_cpf', 'Must NOT advance pending_requirement when dialogue was rejected');
});

test('TEST 11: rejected catalog prose recovers the already-rendered authorized catalog', async () => {
  const rejectedCatalogProse = {
    action: 'catalog', reason: 'none',
    reply: 'Posso ajudar com informações sobre os veículos.',
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Posso ajudar com informações sobre os veículos.' }],
      requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false
    },
    dialogue_plan: { requests: [{ id: 'req_1', topic: 'catalog' }], next_requirement: 'none', catalog_list_requested: true, memory: { trade_in_status: 'none', evidence_ids: [], vehicle_kind: 'motorcycle', vehicle_kind_evidence_ids: ['m1'], customer_vehicle_purpose: 'none', customer_vehicle_purpose_evidence_ids: [] }, human_requested: false, handoff_reason: 'none' },
    state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy' },
    semantic_intent: { primary_intent: 'inventory_search', secondary_intents: [], topics: ['catalog'], confidence: 'high', customer_disposition: { value: 'active', evidence_ids: [] }, catalog: { requested: true, category: 'motorcycles', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: ['m1'] }, customer_vehicle: { purpose: 'none', evidence_ids: [] }, references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] }, conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false }, ambiguities: [] }
  };
  const { sent, savedEvents } = await runTurnSimulation({ text: 'Quais motos?', responseMock: rejectedCatalogProse });
  const outbound = savedEvents.find(event => event.direction === 'outbound');
  assert.match(sent[0].text, /Tornado 300L|PCX|Crosser|CB 600RR/i);
  assert.equal(outbound.raw_payload.dialogue_recovery?.status, 'grounded_catalog');
  assert.ok(outbound.ai_error.includes('UNFULFILLED_CATALOG_REQUEST'));
  assert.equal(outbound.raw_payload.catalog_item_ids.length, 4);
});
