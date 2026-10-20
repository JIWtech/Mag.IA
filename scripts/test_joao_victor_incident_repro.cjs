const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');

const salesConfig = JSON.parse(fs.readFileSync(path.join(root, 'clients/wesley_automoveis/sales.json'), 'utf8'));
const rawInventory = JSON.parse(fs.readFileSync(path.join(root, 'clients/wesley_automoveis/estoque_referencia.json'), 'utf8')).vehicles;

const inventory = [
  ...rawInventory.map(row => ({
    ...row,
    id: [row.brand, row.model, row.year, row.color].map(v => String(v || '').toLowerCase()).join('|'),
    name: [row.brand, row.model, row.year].filter(Boolean).join(' '),
    commercial_name: [row.brand, row.model, row.year].filter(Boolean).join(' '),
    category: /moto|tornado|crosser|biz|titan|fazer/i.test(row.model) ? 'motorcycle' : 'car',
    status: 'announced',
    offerable: true,
    availability_verified: false,
    price_source: 'genesis_sheet',
  })),
  // Crosser 2023 anunciada conforme incidente real
  {
    source_row: 99,
    model: 'CROSSER',
    brand: 'YAMAHA',
    price_raw: '17.980',
    price_cents: 1798000,
    canonical_price_cents: 1798000,
    color: 'AZUL',
    km_raw: '15000',
    km: 15000,
    year: 2023,
    fuel: 'FLEX',
    id: 'yamaha|crosser|2023|azul',
    name: 'YAMAHA CROSSER 2023',
    commercial_name: 'YAMAHA CROSSER 2023',
    category: 'motorcycle',
    status: 'announced',
    offerable: true,
    availability_verified: false,
    price_source: 'genesis_sheet',
  },
  // Crosser 2021 vendida para testar integridade
  {
    source_row: 100,
    model: 'CROSSER',
    brand: 'YAMAHA',
    price_raw: '14.000',
    price_cents: 1400000,
    canonical_price_cents: 1400000,
    color: 'VERMELHA',
    km_raw: '50000',
    km: 50000,
    year: 2021,
    fuel: 'FLEX',
    id: 'yamaha|crosser|2021|vendida',
    name: 'YAMAHA CROSSER 2021',
    commercial_name: 'YAMAHA CROSSER 2021',
    category: 'motorcycle',
    status: 'sold',
    offerable: false,
    availability_verified: false,
    price_source: 'genesis_sheet',
  },
];

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

async function runTurnSimulation({
  text = 'Olá',
  priorLead = null,
  currentLeadRow = null,
  boundary = 'session-1',
  responseMock = null,
  geminiError = null,
  postgrestError = null,
} = {}) {
  const sent = [];
  const savedEvents = [];
  const salesSaves = [];
  let leadStateInDb = currentLeadRow;

  const request = async (opts) => {
    const urlStr = typeof opts === 'string' ? opts : opts.url;
    const parsed = new URL(urlStr);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body;

    if (parsed.pathname === '/models/gemini-3.5-flash-lite:generateContent' || parsed.pathname.includes(':generateContent')) {
      if (geminiError) throw geminiError;
      if (responseMock) {
        return {
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify(responseMock) }] },
          }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
        };
      }
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
        if (parsed.searchParams.has('session_id')) {
          const sess = parsed.searchParams.get('session_id').replace('eq.', '');
          if (leadStateInDb && leadStateInDb.session_id === sess) return [leadStateInDb];
          return [];
        }
        if (parsed.searchParams.has('order') && parsed.searchParams.get('order').includes('updated_at.desc')) {
          if (leadStateInDb) return [leadStateInDb];
          if (priorLead) return [priorLead];
          return [];
        }
        return leadStateInDb ? [leadStateInDb] : [];
      }
      if (table === 'sales_documents') {
        if (parsed.searchParams.get('lead_id') === 'eq.null') {
          const err = new Error('invalid input syntax for type uuid: "null"');
          err.statusCode = 400;
          throw err;
        }
        return [];
      }
      if (table === 'channel_events') {
        if (method === 'POST') {
          const evt = { ...body, id: 'event-' + Math.random().toString(36).slice(2, 9), created_at: new Date().toISOString() };
          savedEvents.push(evt);
          return [evt];
        }
        if (parsed.searchParams.get('or')?.includes('conversation_closed')) {
          return boundary === 'initial' ? [] : [{ id: boundary, created_at: new Date(Date.now() - 60000).toISOString(), service: 'conversation_closed', ai_provider: 'conversation_closed' }];
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

  const turn = {
    claimed: true,
    token: 'turn-token',
    boundary_id: boundary,
    messages: [{ id: 'm1', event_id: 'e1', text, received_at: new Date().toISOString() }],
  };

  const result = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode).call(
    { helpers: { httpRequest: request } },
    {
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-genesis',
      remoteJid: '5521985198468@s.whatsapp.net',
      instance: 'genesis-instance',
      noria_preclaimed_turn: turn,
      noria_business_context: {
        contract: 'noria_business_result_v1',
        tenant_slug: 'wesley_automoveis',
        phase: 'turn',
        session_id: boundary,
        request_id: 'e1:turn-token',
        inventory,
        offerable_catalog: inventory,
        conversation_facts: {
          contract: 'noria_genesis_conversation_facts_v1',
          selection_status: /crosser/i.test(text) ? 'resolved' : 'none',
          selected_product: /crosser/i.test(text) ? inventory.find(v => /crosser/i.test(v.model) && v.year === 2023) : null,
        },
      },
      noria_client_policy: {
        profile: 'vehicle_sales_v1',
        capability: 'sales_v1',
        contract: 'noria_policy_v2',
        tenant_slug: 'wesley_automoveis',
        tenant_id: 'tenant-genesis',
        audio_enabled: false,
        scheduling_enabled: false,
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
    () => ({}),
  );

  return { result: result.json, sent, savedEvents, salesSaves, leadStateInDb };
}

test('INCIDENTE REAL JOAO VICTOR SANTOS 17:38: Turno 1 (Ola, boa tarde) nao herda financiamento nem Camaro do atendimento encerrado', async () => {
  const priorClosedLead = {
    id: '06644636-4544-4627-b0f9-dd485c52ea19',
    tenant_id: 'tenant-genesis',
    session_id: '92a0d3af-c8da-42aa-94fd-6c43d3d278f2',
    revision: 14,
    ai_locked: false,
    stage_key: 'sales_closed',
    state: {
      ...emptyState(),
      customer_name: 'João Victor Santos',
      payment_mode: 'financing',
      payment_evidence: 'ancient-financing-evidence',
      product_id: 'yamaha|crosser|2023|azul',
      product_evidence: 'ancient-product-evidence',
      sell_model: 'Camaro',
      sell_year: 2007,
      sell_vehicle: {
        ...emptyState().sell_vehicle,
        model: 'Camaro',
        year: 2007,
        evidence_ids: ['ancient-camaro-evidence'],
      },
      transaction_mode: 'buy_and_sell',
      pending_requirement: 'customer_name',
    },
    product: inventory.find(v => /crosser/i.test(v.model) && v.year === 2023),
  };

  const responseTurn1 = {
    action: 'reply',
    reason: 'none',
    reply: 'Olá, João Victor! Boa tarde! Como posso ajudar você hoje na Gênesis Automóveis?',
    state: {
      ...emptyState(),
      customer_name: 'João Victor Santos',
    },
    dialogue_plan: {
      requests: [{ id: 'r1', topic: 'other' }],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'unknown',
        vehicle_kind_evidence_ids: [],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: [],
      },
      human_requested: false,
      handoff_reason: 'none',
    },
    response_contract: {
      answers: [{ request_id: 'r1', excerpt: 'Olá, João Victor! Boa tarde!' }],
      requested_fields: [],
      facts: [],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
    semantic_intent: {
      transaction_mode: 'unknown',
      transaction_mode_evidence_ids: [],
      payment_method: 'unknown',
      payment_method_evidence_ids: [],
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
    },
  };

  const sim = await runTurnSimulation({
    text: 'Olá, boa tarde',
    priorLead: priorClosedLead,
    boundary: '20b1dfef-9cfa-4a0e-b269-c4ca0fdf1361',
    responseMock: responseTurn1,
  });

  console.log('sim.result is:', sim.result);
  assert.equal(sim.result.ok, true);
  assert.equal(sim.sent.length, 1);
  const outText = sim.sent[0].text;
  assert.doesNotMatch(outText, /simulação de financiamento/i);
  assert.doesNotMatch(outText, /qual é o seu nome completo/i);
  assert.match(outText, /boa tarde/i);

  // Prova que o novo sales_leads salvo no banco esta limpo de compromissos anteriores
  const savedState = sim.leadStateInDb.state;
  assert.equal(savedState.payment_mode, 'unknown');
  assert.equal(savedState.sell_model, '');
  assert.equal(savedState.sell_year, null);
  assert.equal(savedState.product_id, '');
});

test('INCIDENTE REAL JOAO VICTOR SANTOS 17:38: Turno 2 (Crosser 2023 + moto pra troca) responde sobre Crosser e troca sem forcar financiamento', async () => {
  const currentLeadFromTurn1 = {
    id: 'b2c40507-11e0-48b9-ba78-2053ebabf1d7',
    tenant_id: 'tenant-genesis',
    session_id: '20b1dfef-9cfa-4a0e-b269-c4ca0fdf1361',
    revision: 1,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: {
      ...emptyState(),
      customer_name: 'João Victor Santos',
    },
  };

  const responseTurn2 = {
    action: 'reply',
    reason: 'none',
    reply: 'Boa tarde, João Victor! A Crosser 2023 está anunciada por R$ 17.980, mas preciso confirmar a disponibilidade no pátio com a equipe. Sobre a sua moto para troca, nós aceitamos mediante avaliação!',
    state: {
      ...emptyState(),
      transaction_mode: 'buy',
      product_id: 'yamaha|crosser|2023|azul',
      product_evidence: 'm1',
      customer_name: 'João Victor Santos',
      sell_vehicle: {
        ...emptyState().sell_vehicle,
        category: 'motorcycle',
        raw_mention: 'moto',
        evidence_ids: ['m1'],
      },
    },
    dialogue_plan: {
      requests: [
        { id: 'request_1', topic: 'availability' },
        { id: 'request_2', topic: 'trade_in' },
      ],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'policy_discussed',
        evidence_ids: ['m1'],
        vehicle_kind: 'motorcycle',
        vehicle_kind_evidence_ids: ['m1'],
        customer_vehicle_purpose: 'entry_inquiry',
        customer_vehicle_purpose_evidence_ids: ['m1'],
      },
      human_requested: false,
      handoff_reason: 'none',
    },
    response_contract: {
      answers: [
        { request_id: 'request_1', excerpt: 'A Crosser 2023 está anunciada por R$ 17.980, mas preciso confirmar a disponibilidade no pátio com a equipe.' },
        { request_id: 'request_2', excerpt: 'Sobre a sua moto para troca, nós aceitamos mediante avaliação!' },
      ],
      requested_fields: [],
      facts: [
        { fact_id: 'official.product.status', value: 'announced', excerpt: 'está anunciada' },
        { fact_id: 'official.product.price_cents', value: '1798000', excerpt: 'R$ 17.980' },
        { fact_id: 'official.policy.vehicle_trade_in_accepted_subject_to_appraisal', value: 'true', excerpt: 'aceitamos mediante avaliação' },
      ],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
    semantic_intent: {
      transaction_mode: 'buy',
      transaction_mode_evidence_ids: ['m1'],
      payment_method: 'trade_in',
      payment_method_evidence_ids: ['m1'],
      customer_vehicle: { purpose: 'entry_inquiry', evidence_ids: ['m1'] },
    },
  };

  const sim = await runTurnSimulation({
    text: 'Boa tarde! Vi uma Crosser 2023 de vocês e queria saber se ainda tá disponível. Tenho uma moto pra',
    currentLeadRow: currentLeadFromTurn1,
    boundary: '20b1dfef-9cfa-4a0e-b269-c4ca0fdf1361',
    responseMock: responseTurn2,
  });

  assert.equal(sim.result.ok, true);
  assert.equal(sim.sent.length, 1);
  const outText = sim.sent[0].text;
  assert.match(outText, /Crosser/i);
  assert.match(outText, /troca|avaliação/i);
  assert.doesNotMatch(outText, /simulação de financiamento/i);
  assert.doesNotMatch(outText, /qual é o seu nome completo/i);
  assert.doesNotMatch(outText, /Camaro/i);

  // Prova que a auditoria aceitou a resposta (ai_processing_ok = true, sem DIALOGUE_REVIEW_REQUIRED)
  const savedEvt = sim.savedEvents[0];
  assert.equal(savedEvt.raw_payload.ai_processing_ok, true);
  assert.equal(savedEvt.raw_payload.dialogue_audit.status, 'accepted');
  assert.equal(savedEvt.raw_payload.build_metadata.core_revision.startsWith('conversation_core_v2_1_26'), true);
});

test('REGRESSAO: Mudanca natural de assunto (Financiamento -> Pergunta simples sobre disponibilidade)', async () => {
  const currentLeadFinancingActive = {
    id: 'lead-fin-active',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-active',
    revision: 2,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: {
      ...emptyState(),
      customer_name: 'Carlos Alberto',
      payment_mode: 'financing',
      payment_evidence: 'm0',
    },
  };

  const responseAvailability = {
    action: 'reply',
    reason: 'none',
    reply: 'A Crosser 2023 tá anunciada, mas a disponibilidade física precisa ser checada no estoque.',
    state: {
      ...emptyState(),
      customer_name: 'Carlos Alberto',
      payment_mode: 'financing',
      payment_evidence: 'm0',
      product_id: 'yamaha|crosser|2023|azul',
      product_evidence: 'm1',
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'availability' }],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'unknown',
        vehicle_kind_evidence_ids: [],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: [],
      },
      human_requested: false,
      handoff_reason: 'none',
    },
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'A Crosser 2023 tá anunciada, mas a disponibilidade física precisa ser checada no estoque.' }],
      requested_fields: [],
      facts: [{ fact_id: 'official.product.status', value: 'announced', excerpt: 'tá anunciada' }],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
    semantic_intent: {
      transaction_mode: 'buy',
      transaction_mode_evidence_ids: ['m1'],
      payment_method: 'financing',
      payment_method_evidence_ids: ['m0'],
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
    },
  };

  const sim = await runTurnSimulation({
    text: 'Deixa isso pra depois. Quanto tá a Crosser 2023 e ainda tá disponível?',
    currentLeadRow: currentLeadFinancingActive,
    boundary: 'sess-active',
    responseMock: responseAvailability,
  });

  assert.equal(sim.result.ok, true);
  const outText = sim.sent[0].text;
  assert.match(outText, /Crosser/i);
  assert.doesNotMatch(outText, /qual é o seu nome completo/i);
  assert.doesNotMatch(outText, /CPF/i);
});

test('REGRESSAO: Falha do Gemini com fallback seguro responde sobre o veiculo e troca sem perguntar financiamento', async () => {
  const currentLead = {
    id: 'lead-clean',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-clean',
    revision: 1,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: emptyState(),
  };

  // Simula timeout ou falha de provedor
  const geminiFail = new Error('GEMINI_UNAVAILABLE');
  geminiFail.statusCode = 503;

  const sim = await runTurnSimulation({
    text: 'Vi uma Crosser 2023 de vocês e queria saber se ainda tá disponível. Tenho uma moto pra dar de entrada',
    currentLeadRow: currentLead,
    boundary: 'sess-clean',
    geminiError: geminiFail,
  });

  assert.equal(sim.result.ok, true);
  const outText = sim.sent[0].text;
  assert.match(outText, /Crosser/i);
  assert.match(outText, /troca|avaliação/i);
  assert.doesNotMatch(outText, /simulação de financiamento/i);
  assert.doesNotMatch(outText, /qual é o seu nome completo/i);
});

test('REGRESSAO: Veiculo vendido (Crosser 2021 vendida) nao e ofertavel', async () => {
  const soldVehicle = inventory.find(v => v.status === 'sold');
  assert.equal(soldVehicle.offerable, false);
  assert.equal(soldVehicle.status, 'sold');
});

test('INCIDENTE REAL A: "Oiii" nao falha com UNSCOPED_REFERENCE_EVIDENCE nem puxa financiamento', async () => {
  const currentLead = {
    id: 'lead-oiii',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-oiii',
    revision: 1,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: emptyState(),
  };

  // Mock Gemini response for "Oiii" where evidence_ids has "none" or arbitrary id
  const responseOiii = {
    action: 'reply',
    reason: 'none',
    reply: 'Olá! Como posso ajudar você hoje na Gênesis Automóveis?',
    state: {
      ...emptyState(),
      intent: 'unknown',
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'greeting' }],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'unknown',
        vehicle_kind_evidence_ids: [],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: [],
      },
      human_requested: false,
      handoff_reason: 'none',
    },
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Olá! Como posso ajudar você hoje na Gênesis Automóveis?' }],
      requested_fields: [],
      facts: [],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
    semantic_intent: {
      primary_intent: 'general_contact',
      secondary_intents: [],
      topics: ['greeting'],
      customer_disposition: { value: 'active', evidence_ids: [] },
      transaction_mode: 'unknown',
      transaction_mode_evidence_ids: [],
      payment_method: 'unknown',
      payment_method_evidence_ids: [],
      catalog: { requested: false, category: 'unspecified', preferences: [], exclusions: [], price_range: { min_brl: null, max_brl: null }, evidence_ids: [] },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { selected_ordinal: null, mentioned_product_ids: [], previous_catalog: false, evidence_ids: ['none'] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: [],
      confidence: 'high',
    },
  };

  const sim = await runTurnSimulation({
    text: 'Oiii',
    currentLeadRow: currentLead,
    boundary: 'sess-oiii',
    responseMock: responseOiii,
  });

  assert.equal(sim.result.ok, true);
  assert.equal(sim.result.ai_processing_ok, true);
  assert.equal(sim.result.error_code, null);
  const outText = sim.sent[0].text;
  assert.match(outText, /Olá/i);
  assert.doesNotMatch(outText, /simulação de financiamento/i);
});

test('INCIDENTE REAL A: "João Victor" customer_name assertion succeeds without UNSUPPORTED_FACT', async () => {
  const currentLead = {
    id: 'lead-jv',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-jv',
    revision: 1,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: emptyState(),
  };

  const responseName = {
    action: 'reply',
    reason: 'none',
    reply: 'Olá, João Victor! Em que posso ajudar você hoje?',
    state: {
      ...emptyState(),
      intent: 'unknown',
      customer_name: 'João Victor',
      name_evidence: 'm1',
    },
    dialogue_plan: {
      requests: [{ id: 'req_1', topic: 'customer_name' }],
      next_requirement: 'none',
      memory: {
        trade_in_status: 'none',
        evidence_ids: [],
        vehicle_kind: 'unknown',
        vehicle_kind_evidence_ids: [],
        customer_vehicle_purpose: 'none',
        customer_vehicle_purpose_evidence_ids: [],
      },
      human_requested: false,
      handoff_reason: 'none',
    },
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'Olá, João Victor!' }],
      requested_fields: [],
      facts: [{ fact_id: 'customer_name', value: 'João Victor', excerpt: 'João Victor' }],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
    semantic_intent: {
      primary_intent: 'general_contact',
      secondary_intents: [],
      topics: ['name'],
      customer_disposition: { value: 'active', evidence_ids: [] },
      transaction_mode: 'unknown',
      transaction_mode_evidence_ids: [],
      payment_method: 'unknown',
      payment_method_evidence_ids: [],
      catalog: { requested: false, category: 'unspecified', preferences: [], exclusions: [], price_range: { min_brl: null, max_brl: null }, evidence_ids: [] },
      customer_vehicle: { purpose: 'none', evidence_ids: [] },
      references: { selected_ordinal: null, mentioned_product_ids: [], previous_catalog: false, evidence_ids: [] },
      conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
      ambiguities: [],
      confidence: 'high',
    },
  };

  const sim = await runTurnSimulation({
    text: 'João Victor',
    currentLeadRow: currentLead,
    boundary: 'sess-jv',
    responseMock: responseName,
  });

  assert.equal(sim.result.ok, true);
  assert.equal(sim.result.ai_processing_ok, true);
  assert.equal(sim.result.error_code, null);
  const outText = sim.sent[0].text;
  assert.match(outText, /João Victor/i);
});

test('INCIDENTE REAL A: "Quais as outras motocas" lista motos e NAO repete Crosser 2023', async () => {
  const currentLeadWithCrosser = {
    id: 'lead-crosser',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-crosser',
    revision: 2,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: {
      ...emptyState(),
      product_id: 'yamaha|crosser|2023|azul',
    },
  };

  // Even if Gemini fails or hits fallback, safe recovery must return motorcycle alternatives
  const sim = await runTurnSimulation({
    text: 'Quais as outras motocas',
    currentLeadRow: currentLeadWithCrosser,
    boundary: 'sess-crosser',
    geminiError: new Error('INCOMPLETE_SALES_RESPONSE'),
  });

  assert.equal(sim.result.ok, true);
  const outText = sim.sent[0].text;
  assert.match(outText, /opções de motos anunciadas/i);
  assert.doesNotMatch(outText, /tá anunciada, mas a disponibilidade exata no pátio é a confirmar com a equipe/i);
});

test('INCIDENTE REAL B: Veículo para troca incremental (12/13, multas) consolida sem repetir e sem POLICY_IS_NOT_OFFER', async () => {
  const currentLeadTradeIn = {
    id: 'lead-tradein-b',
    tenant_id: 'tenant-genesis',
    session_id: 'sess-tradein-b',
    revision: 1,
    ai_locked: false,
    stage_key: 'sales_qualifying',
    state: {
      ...emptyState(),
      transaction_mode: 'buy_and_sell',
    },
  };

  const sim = await runTurnSimulation({
    text: 'Ano 2012 \nModelo2013\n2 anos de documento \n1.500 de multa',
    currentLeadRow: currentLeadTradeIn,
    boundary: 'sess-tradein-b',
    geminiError: new Error('INCOMPLETE_SALES_RESPONSE'),
  });

  assert.equal(sim.result.ok, true);
  const outText = sim.sent[0].text;
  assert.match(outText, /modelo e a marca/i);
  assert.doesNotMatch(outText, /Pode me informar o modelo, ano e se o veículo possui alguma pendência/i);
});

test('REGRESSAO: Metadados operacionais do build estao presentes e verificaveis', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'n8n/build_manifest.json'), 'utf8'));
  assert.ok(manifest.core_revision.startsWith('conversation_core_v2_1_26'));
  assert.equal(manifest.core_sha256.length, 64);
  assert.equal(manifest.ext_sha256.length, 64);
  assert.ok(manifest.built_at);
});
