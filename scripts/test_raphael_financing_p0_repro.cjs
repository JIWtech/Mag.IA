// Exclusively synthetic test fixtures (never real production customer PII)
const SYNTHETIC_CPF = '52998224725';
const SYNTHETIC_BIRTH_DATE_INPUT = '15/05/1992';
const SYNTHETIC_BIRTH_DATE_ISO = '1992-05-15';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Frontend services
const { applyIncomingEventToConversations } = require('../app/src/services/conversations/applyIncomingEvent.js');
const { applyIncomingEventToKanban } = require('../app/src/services/kanban/applyIncomingEvent.js');
const { eventsToConversations } = require('../app/src/services/conversations/eventsToConversations.js');
const { eventsToKanban } = require('../app/src/services/kanban/eventsToKanban.js');
const { emptyKanban } = require('../app/src/services/kanban/kanbanHelpers.js');

const inventory = [
  {
    id: 'nissan|versa sl|2013|prata',
    brand: 'Nissan',
    model: 'Versa SL',
    commercial_name: 'Nissan Versa SL 1.6 Flex 16V 2013 Prata',
    year: 2013,
    color: 'Prata',
    price_cents: 3500000,
    status: 'announced',
    offerable: true,
    price_source: 'genesis_sheet',
  },
];

const salesConfig = {
  stages: {
    sales_new: { name: 'Pátio - Novos contatos', allow_ai: true },
    sales_qualifying: { name: 'IA - Qualificação automotiva', allow_ai: true },
    sales_financing: { name: 'Fila de financiamento', allow_ai: false },
    sales_human: { name: 'Atendimento humano', allow_ai: false },
    sales_closed: { name: 'Negócio fechado', allow_ai: false },
  },
  stage_keys: {
    new: 'sales_new',
    qualifying: 'sales_qualifying',
    financing: 'sales_financing',
    human: 'sales_human',
    closed: 'sales_closed',
  },
  hot_lead_rule: 'deposit_and_financing_documents_v2',
  collect_documents: true,
  required_financing_documents: ['cpf', 'birth_date'],
};

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
      photo_anchor_event_id: '',
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

function semanticIntent({ primary = 'other', secondary = [], purpose = 'none', evidence = [] } = {}) {
  return {
    primary_intent: primary,
    secondary_intents: secondary,
    topics: [],
    customer_disposition: { value: 'active', evidence_ids: [] },
    catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
    customer_vehicle: { purpose, evidence_ids: evidence },
    references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
    conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false },
    ambiguities: [],
    confidence: 'high',
  };
}

function primaryResponse({ product = inventory[0], reply = 'Olá! Como posso ajudar?' } = {}) {
  const state = emptyState();
  return {
    action: 'reply',
    reason: 'none',
    reply,
    state,
    dialogue_plan: {
      requests: [{ id: 'request_1', topic: 'purchase' }],
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
    semantic_intent: semanticIntent({ primary: 'purchase', evidence: [] }),
    response_contract: {
      answers: [{ request_id: 'request_1', excerpt: reply.slice(0, Math.max(3, Math.min(45, reply.length))) }],
      requested_fields: [],
      facts: [],
      availability_asserted: false,
      assignment_confirmed: false,
      photo_sent: false,
    },
  };
}

function buildContext({ selection = 'none', product = null, operations = {}, eventId = 'e0' } = {}) {
  return {
    contract: 'noria_business_result_v1',
    tenant_slug: 'wesley_automoveis',
    phase: 'turn',
    session_id: 'initial',
    request_id: eventId + ':token-turn',
    inventory,
    offerable_catalog: inventory,
    conversation_facts: {
      contract: 'noria_genesis_conversation_facts_v1',
      selection_status: selection,
      selection_source: selection === 'none' ? 'none' : 'model_selection',
      selected_product: product,
    },
    operations: {
      'customer.name_progress': {
        contract: 'noria_business_result_v1',
        operation: 'customer.name_progress',
        status: 'ok',
        data: { reply: '' },
        handoff: { required: false, reason: null, message: null },
      },
      ...operations,
    },
  };
}

async function runCoreTurn({
  messages = [{ id: 'm0', event_id: 'e0', text: 'Oi' }],
  lead = null,
  geminiResponse = null,
  context = null,
  simulateMergeFail = false,
  simulateMergeAlreadyApplied = false,
  simulateAssignmentTimeout = false,
  businessHoursOpen = true,
  existingAssignment = null,
}) {
  const sent = [];
  const savedEvents = [];
  const patchedMedia = [];
  const assignmentCalls = [];
  const salesSaveCalls = [];
  let currentLead = lead ? { ...lead } : null;

  const firstEventId = messages[0]?.event_id || 'e0';
  const mockContext = context || buildContext({ eventId: firstEventId });
  mockContext.session_id = 'initial';
  mockContext.request_id = firstEventId + ':token-turn';

  const request = async ({ url, method = 'GET', body }) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').at(-1);

    if (parsed.hostname === 'generativelanguage.googleapis.com') {
      const resp = geminiResponse || primaryResponse();
      if (resp?.reply && resp?.response_contract?.answers?.[0]) {
        resp.response_contract.answers[0].excerpt = resp.reply.slice(0, Math.max(3, Math.min(45, resp.reply.length)));
      }
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(resp) }] } }] };
    }

    if (parsed.hostname === 'evo.test') {
      sent.push(body?.text || '');
      return { key: { id: 'outbound-msg-id' } };
    }

    if (table === 'tenants') {
      return [{ id: 'tenant-genesis-id', slug: 'wesley_automoveis', status: 'active', name: 'Gênesis Automóveis' }];
    }

    if (table === 'tenant_settings') {
      return [{
        tenant_id: 'tenant-genesis-id',
        settings: {
          conversation_capability: 'sales_v1',
          whatsapp_processing_mode: 'conversation_core_v1',
          grounding_mode: 'canonical_v2',
          system_prompt: 'Gênesis',
          ai_model: 'gemini-3.5-flash-lite',
          ai_enabled: true,
          gemini_daily_limit: 100,
          sdr_rules: { hot_lead_percent: 30 },
          sales: salesConfig,
          business_hours: {
            enabled: true,
            is_open: businessHoursOpen,
            next_opening: { formatted: 'segunda-feira às 08h00' },
          },
        },
      }];
    }

    if (table === 'channels') {
      return [{ id: 'channel-genesis', external_id: 'genesis-instance', status: 'active' }];
    }

    if (table === 'contacts') return [];
    if (table === 'magia_contact_exclusion_status') return { blocked: false };
    if (table === 'sales_documents') return [];
    if (table === 'team_agents') return [{ id: 'usr-wesley', name: 'Wesley', role: 'operator' }];
    if (table === 'magia_commit_turn') return { committed: true };
    if (table === 'magia_finish_turn') return {};
    if (table === 'magia_begin_turn_delivery') return { id: 'delivery-attempt' };
    if (table === 'magia_confirm_turn_delivery') return { confirmed: true };

    if (table === 'magia_merge_channel_event_raw') {
      if (simulateMergeFail) {
        throw new Error('Connection timeout on merge RPC');
      }
      patchedMedia.push(body);
      if (simulateMergeAlreadyApplied) {
        return [{ applied: false, reason: 'already_applied' }];
      }
      return [{ applied: true, reason: 'merged' }];
    }

    if (table === 'magia_sales_save') {
      salesSaveCalls.push(body);
      const stage = body.p_stage;
      const allowAi = salesConfig.stages?.[stage]?.allow_ai === true;
      currentLead = {
        id: currentLead?.id || 'lead-raphael-test',
        tenant_id: 'tenant-genesis-id',
        channel_type: 'whatsapp',
        chat_id: '5521999990000@s.whatsapp.net',
        session_id: 'initial',
        revision: (currentLead?.revision || 0) + 1,
        stage_key: stage,
        state: body.p_state,
        product: body.p_product || null,
        hot: false,
        ai_locked: !allowAi,
        interest_registered: body.p_register === true,
      };
      return currentLead;
    }

    if (table === 'sales_leads') {
      if (method === 'PATCH') {
        currentLead = { ...currentLead, ...body, revision: (currentLead.revision || 0) + 1 };
        return [currentLead];
      }
      return currentLead ? [currentLead] : [];
    }

    if (table === 'channel_events') {
      if (method === 'POST') {
        const ev = { ...body, id: 'event-' + Date.now(), created_at: new Date().toISOString() };
        savedEvents.push(ev);
        if (body?.raw_payload?.command === 'assign_conversation') {
          assignmentCalls.push(body);
          if (simulateAssignmentTimeout) {
            throw new Error('timeout on assign_conversation');
          }
          currentLead = {
            ...currentLead,
            revision: (currentLead?.revision || 0) + 1,
            ai_locked: true,
            state: {
              ...(currentLead?.state || {}),
              human_dispatch: {
                status: 'assigned',
                assignee_id: 'usr-wesley',
                assignee_name: 'Wesley',
                within_business_hours: businessHoursOpen,
                next_opening: null,
              },
            },
          };
          return ev;
        }
        return [ev];
      }
      if (method === 'PATCH') {
        return [{ id: 'updated-event' }];
      }
      if (parsed.searchParams.get('service') === 'eq.conversation_assigned') {
        if (existingAssignment) {
          return [existingAssignment];
        }
        return assignmentCalls.map(c => ({
          id: 'assign-ev-1',
          created_at: new Date().toISOString(),
          command_id: c.command_id,
          sent_by_user: 'Wesley',
          service: 'conversation_assigned',
          raw_payload: c.raw_payload,
        }));
      }
      if (parsed.searchParams.get('id')?.startsWith('in.')) {
        return messages.map(m => ({ id: m.event_id || 'e0', external_message_id: m.id || 'm0' }));
      }
      if (parsed.searchParams.get('id')?.startsWith('eq.')) {
        const reqId = parsed.searchParams.get('id').replace('eq.', '');
        const foundMsg = messages.find(m => m.event_id === reqId);
        return [{ id: reqId, external_message_id: foundMsg?.id || 'ext-' + reqId }];
      }
      return [];
    }

    throw new Error('Unexpected request: ' + method + ' ' + url);
  };

  const ingress = {
    tenant_slug: 'wesley_automoveis',
    tenant_id: 'tenant-genesis-id',
    remoteJid: '5521999990000@s.whatsapp.net',
    instance: 'genesis-instance',
    noria_preclaimed_turn: {
      claimed: true,
      token: 'token-turn',
      boundary_id: 'initial',
      messages,
    },
    noria_business_context: mockContext,
    noria_client_policy: {
      profile: 'vehicle_sales_v1',
      capability: 'sales_v1',
      contract: 'noria_policy_v2',
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-genesis-id',
      audio_enabled: false,
      scheduling_enabled: false,
    },
  };

  const envVars = {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
    GEMINI_ENABLED: 'true',
    GEMINI_API_KEY: 'fake-gemini',
    EVOLUTION_API_URL_WESLEY_AUTOMOVEIS: 'https://evo.test',
    EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS: 'fake-evo',
    EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS: 'genesis-instance',
  };

  try {
    const fn = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode);
    const result = await fn.call({ helpers: { httpRequest: request } }, ingress, envVars, {}, () => ({}));
    return {
      ok: true,
      result: result.json,
      sent,
      savedEvents,
      patchedMedia,
      salesSaveCalls,
      currentLead,
    };
  } catch (err) {
    return {
      ok: false,
      error: err,
      sent,
      savedEvents,
      patchedMedia,
      salesSaveCalls,
      currentLead,
    };
  }
}

// ==============================================================================
// 17-CASE INTEGRATED MATRIX FOR RAPHAEL REGA P0 FINANCING & FRONTEND SYNC
// ==============================================================================

test('Caso 1: Cliente escolhe Versa e pergunta sobre financiamento', async () => {
  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'O Nissan Versa 2013 está disponível! Qual valor você pretende dar de entrada?';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.payment_evidence = 'e1';
  resp.state.product_id = inventory[0].id;
  resp.state.product_evidence = 'e1';
  resp.state.product_variant_evidence = 'e1';

  const res = await runCoreTurn({
    messages: [{
      id: 'm1', event_id: 'e1',
      text: 'Olá, tenho interesse no Nissan Versa 2013 prata, como funciona o financiamento?',
    }],
    geminiResponse: resp,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.state.payment_mode, 'financing');
  assert.equal(res.currentLead.state.product_id, inventory[0].id);
  assert.equal(res.currentLead.stage_key, 'sales_qualifying');
});

test('Caso 2: Cliente envia nome completo', async () => {
  const lead = {
    id: 'lead-test',
    revision: 1,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      payment_evidence: 'e1',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: '',
    },
  };

  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'Prazer, Raphael! Para a simulação, por favor me envie seu CPF e data de nascimento.';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.product_id = inventory[0].id;
  resp.state.customer_name = 'Raphael Rega';
  resp.state.name_evidence = 'e2';

  const res = await runCoreTurn({
    messages: [{ id: 'm2', event_id: 'e2', text: 'Raphael Rega' }],
    lead,
    geminiResponse: resp,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.state.customer_name, 'Raphael Rega');
});

test('Caso 3: Cliente envia CPF e nascimento juntos (formato Raphael)', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
      dialogue_context: {
        financing_next_field: 'documents',
      },
    },
  };

  const res = await runCoreTurn({
    messages: [{
      id: 'm3', event_id: 'e3',
      text: '52998224725\n15/05/1992',
    }],
    lead,
  });

  assert.equal(res.ok, true);
  assert.equal(res.patchedMedia.length, 1);
  const patch = res.patchedMedia[0];
  assert.equal(patch.p_event, 'e3');
  assert.equal(patch.p_external_message, 'm3');
  assert.equal(patch.p_patch.sales_media[0].kind, 'document');
  assert.equal(patch.p_patch.sales_media[0].has_cpf, true);
  assert.equal(patch.p_patch.sales_media[0].has_birth_date, true);
  assert.equal(patch.p_patch.sales_media[0].extracted, undefined); // PII sanitizada de channel_events e Realtime
  assert.equal(res.salesSaveCalls.length >= 1, true);
  const docs = res.salesSaveCalls[0].p_documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].extracted.cpf, '52998224725');
  assert.equal(docs[0].extracted.birth_date, '1992-05-15');
});

test('Caso 4: Cliente envia CNH separadamente', async () => {
  const lead = {
    id: 'lead-test',
    revision: 3,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{
      id: 'm4', event_id: 'e4',
      text: 'CPF 52998224725',
    }],
    lead,
  });

  assert.equal(res.ok, true);
  assert.equal(res.patchedMedia.length, 1);
  assert.equal(res.patchedMedia[0].p_patch.sales_media[0].has_cpf, true);
  assert.equal(res.patchedMedia[0].p_patch.sales_media[0].extracted, undefined);
  assert.equal(res.salesSaveCalls.length >= 1, true);
  const docs = res.salesSaveCalls[0].p_documents;
  assert.equal(docs[0].extracted.cpf, '52998224725');
});

test('Caso 5: Cliente ainda não informou entrada', async () => {
  const lead = {
    id: 'lead-test',
    revision: 1,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: null,
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm5', event_id: 'e5', text: '52998224725\n15/05/1992' }],
    lead,
  });

  assert.equal(res.ok, true);
  // Must NOT trigger handoff before deposit is provided!
  assert.equal(res.currentLead.stage_key, 'sales_qualifying');
  assert.equal(res.currentLead.ai_locked, false);
});

test('Caso 6: Cliente solicita financiamento sem entrada (zero deposit)', async () => {
  const lead = {
    id: 'lead-test',
    revision: 1,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: null,
      customer_name: 'Raphael Rega',
    },
  };

  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'Perfeito, sem entrada. Me informe seu CPF e data de nascimento para a simulação.';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.product_id = inventory[0].id;
  resp.state.customer_name = 'Raphael Rega';
  resp.state.deposit_cents = 0;

  const res = await runCoreTurn({
    messages: [{ id: 'm6', event_id: 'e6', text: 'preferencialmente sem entrada' }],
    lead,
    geminiResponse: resp,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.state.deposit_cents, 0);
});

test('Caso 7: Cliente completa os requisitos comerciais autorizados', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
      financing: {
        documents_complete: false,
      },
    },
  };

  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'Ótimo! Recebemos as informações necessárias. Vamos analisar as possibilidades de financiamento e retornaremos em breve com uma resposta.';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.product_id = inventory[0].id;
  resp.state.customer_name = 'Raphael Rega';
  resp.state.deposit_cents = 0;

  const res = await runCoreTurn({
    messages: [{ id: 'm7', event_id: 'e7', text: '52998224725\n15/05/1992' }],
    lead,
    geminiResponse: resp,
  });

  assert.equal(res.ok, true);
  // Transitions to sales_financing, ai_locked: true
  assert.equal(res.currentLead.stage_key, 'sales_financing');
  assert.equal(res.currentLead.ai_locked, true);
});

test('Caso 8: CORE persiste documentos e o metadata merge com sucesso', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm8', event_id: 'e8', text: '52998224725\n15/05/1992' }],
    lead,
  });

  assert.equal(res.ok, true);
  assert.equal(res.patchedMedia.length, 1);
  const mergeCall = res.patchedMedia[0];
  assert.equal(mergeCall.p_event, 'e8');
  assert.equal(mergeCall.p_external_message, 'm8');
  assert.equal(mergeCall.p_conversation, '5521999990000@s.whatsapp.net');
  assert.equal(mergeCall.p_patch.sales_media[0].kind, 'document');
  assert.equal(mergeCall.p_patch.sales_media[0].readable, true);
  assert.equal(mergeCall.p_patch.sales_media[0].has_cpf, true);
  assert.equal(mergeCall.p_patch.sales_media[0].has_birth_date, true);
  assert.equal(mergeCall.p_patch.sales_media[0].extracted, undefined); // PII sanitizada de channel_events e Realtime
  assert.equal(res.salesSaveCalls.length >= 1, true);
  const docs = res.salesSaveCalls[0].p_documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].extracted.cpf, '52998224725');
  assert.equal(docs[0].extracted.birth_date, '1992-05-15');
});

test('Caso 9: Timeout durante a persistência lança SALES_MEDIA_PERSISTENCE_FAILED e não confirma falsamente', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm9', event_id: 'e9', text: '52998224725\n15/05/1992' }],
    lead,
    simulateMergeFail: true,
  });

  // Outbound message was NOT sent before persistence succeeded!
  assert.equal(res.sent.length, 0);
  assert.equal(res.result.error, 'SALES_MEDIA_PERSISTENCE_FAILED');
  const errEv = res.savedEvents.find(e => e.service === 'technical_error');
  assert.equal(errEv?.ai_error, 'SALES_MEDIA_PERSISTENCE_FAILED');
});

test('Caso 10: Reprocessamento idempotente aceita already_applied sem erro', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm10', event_id: 'e10', text: '52998224725\n15/05/1992' }],
    lead,
    simulateMergeAlreadyApplied: true,
  });

  assert.equal(res.ok, true);
  assert.equal(res.patchedMedia.length, 1);
});

test('Caso 11: Transferência de financiamento confirmada envia resposta autorizada', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'Ótimo! Recebemos as informações necessárias. Vamos analisar as possibilidades de financiamento e retornaremos em breve com uma resposta.';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.product_id = inventory[0].id;
  resp.state.customer_name = 'Raphael Rega';
  resp.state.deposit_cents = 0;

  const res = await runCoreTurn({
    messages: [{ id: 'm11', event_id: 'e11', text: '52998224725\n15/05/1992' }],
    lead,
    geminiResponse: resp,
    businessHoursOpen: true,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.stage_key, 'sales_financing');
  assert.equal(res.currentLead.ai_locked, true);
  assert.match(
    res.sent[0],
    /Ótimo! Recebemos as informações necessárias\. Vamos analisar as possibilidades de financiamento e retornaremos em breve com uma resposta\./
  );
});

test('Caso 12: Transferência incerta mantém ai_locked e mensagem de verificação', async () => {
  const lead = {
    id: 'lead-test',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
    },
  };

  const resp = primaryResponse({ product: inventory[0] });
  resp.reply = 'Ótimo! Recebemos as informações necessárias. Vamos analisar as possibilidades de financiamento e retornaremos em breve com uma resposta.';
  resp.state.intent = 'buy';
  resp.state.transaction_mode = 'buy';
  resp.state.payment_mode = 'financing';
  resp.state.product_id = inventory[0].id;
  resp.state.customer_name = 'Raphael Rega';
  resp.state.deposit_cents = 0;

  const res = await runCoreTurn({
    messages: [{ id: 'm12', event_id: 'e12', text: '52998224725\n15/05/1992' }],
    lead,
    geminiResponse: resp,
    simulateAssignmentTimeout: true,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.ai_locked, true);
  assert.equal(
    res.sent[0],
    'Recebi sua mensagem. Seu atendimento está registrado e passará por verificação da nossa equipe em breve.'
  );
});

test('Caso 13: Operador assume antes da transferência e é preservado', async () => {
  const existingAssignEvent = {
    id: 'assign-wesley-prior',
    created_at: new Date(Date.now() - 5000).toISOString(),
    command_id: 'assign-cmd-wesley',
    sent_by_user: 'Wesley',
    service: 'conversation_assigned',
    raw_payload: {
      assignee: { id: 'usr-wesley', name: 'Wesley' },
    },
  };

  const lead = {
    id: 'lead-test',
    revision: 3,
    stage_key: 'sales_human',
    ai_locked: true,
    state: {
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
      human_dispatch: {
        status: 'assigned',
        assignee_id: 'usr-wesley',
        assignee_name: 'Wesley',
      },
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm13', event_id: 'e13', text: 'Alguma novidade?' }],
    lead,
    existingAssignment: existingAssignEvent,
  });

  assert.equal(res.ok, true);
  assert.equal(res.currentLead.stage_key, 'sales_human');
  assert.equal(res.currentLead.ai_locked, true);
  assert.equal(res.currentLead.state.human_dispatch.assignee_name, 'Wesley');
});

test('Caso 14: IA não retoma após human lock', async () => {
  const lead = {
    id: 'lead-test',
    revision: 4,
    stage_key: 'sales_human',
    ai_locked: true,
    state: {
      payment_mode: 'financing',
      customer_name: 'Raphael Rega',
    },
  };

  const res = await runCoreTurn({
    messages: [{ id: 'm14', event_id: 'e14', text: 'Boa tarde Wesley' }],
    lead,
  });

  assert.equal(res.ok, true);
  assert.equal(res.sent.length, 0);
  assert.equal(res.currentLead.ai_locked, true);
});

test('Caso 15: Tela de conversas atualiza sua classificação em tempo real', () => {
  const initialConversations = [{
    id: 'conv-whatsapp:5521999990000:lead-test:wesley_automoveis',
    canonicalKey: 'whatsapp:5521999990000:lead-test:wesley_automoveis',
    tenantSlug: 'wesley_automoveis',
    externalConversationId: '5521999990000',
    contact: 'Raphael Rega',
    status: 'ia_ativa',
    stage: 'IA - Qualificação automotiva',
    owner: 'Assistente IA',
    ownerKind: 'ai',
    ownerId: null,
    salesStageKey: 'sales_qualifying',
    tags: ['sales_qualification'],
    messages: [],
  }];

  // 15.1 Qualificação -> Financiamento
  const financingEvent = {
    id: 'ev-financing',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    service: 'sales_qualification',
    stage: 'Fila de financiamento',
    raw_payload: {
      sales_stage: 'sales_financing',
      payment_mode: 'financing',
    },
    created_at: new Date().toISOString(),
  };

  const convsAfterFinancing = applyIncomingEventToConversations(
    initialConversations,
    financingEvent,
    'wesley_automoveis',
    { kanbanColumns: [] }
  );

  assert.equal(convsAfterFinancing[0].salesStageKey, 'sales_financing');
  assert.equal(convsAfterFinancing[0].tags.includes('Financiamento'), true);

  // 15.2 Financiamento -> Atribuição manual a Wesley (conversation_assigned)
  const assignEvent = {
    id: 'ev-assign',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    service: 'conversation_assigned',
    stage: 'Atendimento humano',
    sent_by_user: 'Wesley',
    raw_payload: {
      command: 'assign_conversation',
      sales_stage: 'sales_human',
      assignee: { id: 'usr-wesley', name: 'Wesley' },
    },
    created_at: new Date(Date.now() + 1000).toISOString(),
  };

  const convsAfterAssign = applyIncomingEventToConversations(
    convsAfterFinancing,
    assignEvent,
    'wesley_automoveis',
    { kanbanColumns: [] }
  );

  assert.equal(convsAfterAssign[0].owner, 'Wesley');
  assert.equal(convsAfterAssign[0].ownerKind, 'agent');
  assert.equal(convsAfterAssign[0].status, 'atendimento_humano');
  assert.equal(convsAfterAssign[0].salesStageKey, 'sales_human');
});

test('Caso 16: Kanban acompanha a etapa real e move cartões entre colunas', () => {
  const initialColumns = [
    { id: 'sales_qualifying', title: 'IA - Qualificação automotiva', automationKey: 'sales_qualifying', cards: [{
      id: 'conv-whatsapp:5521999990000:lead-test:wesley_automoveis',
      canonicalKey: 'whatsapp:5521999990000:lead-test:wesley_automoveis',
      externalConversationId: '5521999990000',
      title: 'Raphael Rega',
      stage: 'IA - Qualificação automotiva',
      salesStageKey: 'sales_qualifying',
      owner: 'Assistente IA',
      ownerKind: 'ai',
      lastActivityAt: new Date(Date.now() - 10000).toISOString(),
    }] },
    { id: 'sales_financing', title: 'Fila de financiamento', automationKey: 'sales_financing', cards: [] },
    { id: 'sales_human', title: 'Atendimento humano', automationKey: 'sales_human', cards: [] },
    { id: 'sales_closed', title: 'Negócio fechado', automationKey: 'sales_closed', cards: [] },
  ];

  // 16.1 Transição 1: Qualificação -> Financiamento
  const financingEvent = {
    id: 'ev-fin-kanban',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    stage: 'Fila de financiamento',
    raw_payload: {
      sales_stage: 'sales_financing',
    },
    created_at: new Date(Date.now() - 5000).toISOString(),
  };

  const colsFinancing = applyIncomingEventToKanban(initialColumns, financingEvent, 'wesley_automoveis');
  assert.equal(colsFinancing[0].cards.length, 0); // Removed from qualifying
  assert.equal(colsFinancing[1].cards.length, 1); // Added to financing
  assert.equal(colsFinancing[1].cards[0].salesStageKey, 'sales_financing');

  // 16.2 Transição 2: Financiamento -> Atendimento humano (Wesley assume)
  const assignEvent = {
    id: 'ev-assign-kanban',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    service: 'conversation_assigned',
    stage: 'Atendimento humano',
    sent_by_user: 'Wesley',
    raw_payload: {
      command: 'assign_conversation',
      sales_stage: 'sales_human',
      assignee: { id: 'usr-wesley', name: 'Wesley' },
    },
    created_at: new Date(Date.now() - 2000).toISOString(),
  };

  const colsHuman = applyIncomingEventToKanban(colsFinancing, assignEvent, 'wesley_automoveis');
  assert.equal(colsHuman[1].cards.length, 0); // Removed from financing
  assert.equal(colsHuman[2].cards.length, 1); // Added to human
  assert.equal(colsHuman[2].cards[0].owner, 'Wesley');
  assert.equal(colsHuman[2].cards[0].salesStageKey, 'sales_human');

  // 16.3 Transição 3: Atendimento humano -> Encerrado
  const closeEvent = {
    id: 'ev-close-kanban',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    service: 'conversation_closed',
    stage: 'Finalizado',
    created_at: new Date().toISOString(),
  };

  const colsClosed = applyIncomingEventToKanban(colsHuman, closeEvent, 'wesley_automoveis');
  assert.equal(colsClosed[2].cards.length, 0); // Removed from human
  assert.equal(colsClosed[3].cards.length, 1); // Added to closed
  assert.equal(colsClosed[3].cards[0].salesStageKey, 'sales_closed');
});

test('Caso 17: Clínica Núbia permanece inalterada', () => {
  const nubiaColumns = emptyKanban();
  assert.equal(nubiaColumns.length, 5);
  assert.equal(nubiaColumns[0].id, 'novas_conversas');
  assert.equal(nubiaColumns[1].id, 'conversas_andamento');
  assert.equal(nubiaColumns[2].id, 'conversas_humanos');
  assert.equal(nubiaColumns[3].id, 'verificar_sinal');
  assert.equal(nubiaColumns[4].id, 'agendamentos');

  const nubiaEvent = {
    id: 'ev-nubia',
    tenant_slug: 'clinica_nubia',
    channel_type: 'whatsapp',
    external_conversation_id: '5511888880000',
    stage: 'Conversas em andamento',
    message_text: 'Gostaria de agendar uma consulta odontológica',
    created_at: new Date().toISOString(),
  };

  const convs = eventsToConversations([nubiaEvent], 'clinica_nubia', [], nubiaColumns);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].stage, 'Conversas em andamento');
  assert.equal(convs[0].tags.includes('Financiamento'), false);
});

test('Caso 18: Matriz semântica rigorosa de propostas de entrada de financiamento', async () => {
  // Mandated test cases from audit finding 3:
  // 1. "Tem como dar R$ 10 mil de entrada?" — pergunta de viabilidade (deposit = null)
  // 2. "Se eu der 15 mil, quanto fica?" — hipótese/pergunta (deposit = null)
  // 3. "Posso dar 5 mil?" — pergunta direta sobre quantia (deposit = null)
  // 4. "Vou dar R$ 10 mil de entrada." — proposta afirmativa (deposit = 1000000)
  // 5. "Dá para financiar sem entrada?" — pergunta sobre sem entrada (deposit = null)
  // 6. "Preferencialmente sem entrada." — preferência (deposit = 0)
  // 7. "Se não der sem entrada, posso dar R$ 5 mil." — alternativa condicional (deposit = 500000)
  // Plus explicit constraint: "Não consigo dar entrada agora." (deposit = 0)

  // 1. Tem como dar R$ 10 mil de entrada? (Pergunta de viabilidade -> null)
  const lead1 = { id: 'l1', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r1 = await runCoreTurn({ messages: [{ id: 'm18_1', event_id: 'e18_1', text: 'Tem como dar R$ 10 mil de entrada?' }], lead: lead1 });
  assert.equal(r1.ok, true);
  assert.equal(r1.currentLead.state.deposit_cents, null);

  // 2. Se eu der 15 mil, quanto fica? (Hipótese / pergunta -> null)
  const lead2 = { id: 'l2', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r2 = await runCoreTurn({ messages: [{ id: 'm18_2', event_id: 'e18_2', text: 'Se eu der 15 mil, quanto fica?' }], lead: lead2 });
  assert.equal(r2.ok, true);
  assert.equal(r2.currentLead.state.deposit_cents, null);

  // 3. Posso dar 5 mil? (Pergunta direta -> null)
  const lead3 = { id: 'l3', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r3 = await runCoreTurn({ messages: [{ id: 'm18_3', event_id: 'e18_3', text: 'Posso dar 5 mil?' }], lead: lead3 });
  assert.equal(r3.ok, true);
  assert.equal(r3.currentLead.state.deposit_cents, null);

  // 4. Vou dar R$ 10 mil de entrada. (Proposta afirmativa -> 1000000)
  const lead4 = { id: 'l4', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r4 = await runCoreTurn({ messages: [{ id: 'm18_4', event_id: 'e18_4', text: 'Vou dar R$ 10 mil de entrada.' }], lead: lead4 });
  assert.equal(r4.ok, true);
  assert.equal(r4.currentLead.state.deposit_cents, 1000000);

  // 5. Dá para financiar sem entrada? (Pergunta -> null)
  const lead5 = { id: 'l5', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r5 = await runCoreTurn({ messages: [{ id: 'm18_5', event_id: 'e18_5', text: 'Dá para financiar sem entrada?' }], lead: lead5 });
  assert.equal(r5.ok, true);
  assert.equal(r5.currentLead.state.deposit_cents, null);

  // 6. Preferencialmente sem entrada. (Preferência com evidência -> 0)
  const lead6 = { id: 'l6', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r6 = await runCoreTurn({ messages: [{ id: 'm18_6', event_id: 'e18_6', text: 'Preferencialmente sem entrada.' }], lead: lead6 });
  assert.equal(r6.ok, true);
  assert.equal(r6.currentLead.state.deposit_cents, 0);

  // 7. Se não der sem entrada, posso dar R$ 5 mil. (Alternativa condicional -> 500000)
  const lead7 = { id: 'l7', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r7 = await runCoreTurn({ messages: [{ id: 'm18_7', event_id: 'e18_7', text: 'Se não der sem entrada, posso dar R$ 5 mil.' }], lead: lead7 });
  assert.equal(r7.ok, true);
  assert.equal(r7.currentLead.state.deposit_cents, 500000);

  // 8. Não consigo dar entrada agora. (Restrição informada -> 0)
  const lead8 = { id: 'l8', revision: 1, stage_key: 'sales_qualifying', state: { ...emptyState(), intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', product_id: inventory[0].id } };
  const r8 = await runCoreTurn({ messages: [{ id: 'm18_8', event_id: 'e18_8', text: 'Não consigo dar entrada agora.' }], lead: lead8 });
  assert.equal(r8.ok, true);
  assert.equal(r8.currentLead.state.deposit_cents, 0);
});

test('Caso 19: Isolamento completo de segurança e documentos entre dois tenants', async () => {
  // Tenant A: Gênesis Automóveis (wesley_automoveis / tenant-genesis-id)
  const leadGenesis = {
    id: 'lead-genesis-iso',
    revision: 2,
    stage_key: 'sales_qualifying',
    state: {
      intent: 'buy',
      transaction_mode: 'buy',
      payment_mode: 'financing',
      product_id: inventory[0].id,
      deposit_cents: 0,
      customer_name: 'Raphael Rega',
      dialogue_context: { financing_next_field: 'documents' },
    },
  };

  const resGenesis = await runCoreTurn({
    messages: [{ id: 'm-gen', event_id: 'e-gen', text: '52998224725\n15/05/1992' }],
    lead: leadGenesis,
  });

  assert.equal(resGenesis.ok, true);
  // Gênesis persisted documents with tenant-genesis-id
  assert.equal(resGenesis.salesSaveCalls[0].p_tenant, 'tenant-genesis-id');
  assert.equal(resGenesis.patchedMedia[0].p_tenant, 'tenant-genesis-id');
  // Raw PII stripped from Realtime payload
  assert.equal(resGenesis.patchedMedia[0].p_patch.sales_media[0].extracted, undefined);

  // Tenant B: Clínica Núbia (clinica_nubia / tenant-nubia-id)
  // Must NOT receive or process Gênesis sales documents or events
  const nubiaContext = {
    contract: 'noria_business_result_v1',
    tenant_slug: 'clinica_nubia',
    phase: 'turn',
    session_id: 'initial',
    request_id: 'e-nubia:token-turn',
    tenant: { id: 'tenant-nubia-id', slug: 'clinica_nubia' },
    operations: {},
  };

  // Ensure Nubia Kanban and conversation projection strictly discards Gênesis events
  const nubiaColumns = emptyKanban();
  const crossEvents = [
    {
      id: 'e-gen-event',
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-genesis-id',
      channel_type: 'whatsapp',
      external_conversation_id: '5521999990000',
      direction: 'inbound',
      message_text: '52998224725',
      stage: 'Qualificação',
      created_at: new Date().toISOString(),
    },
  ];

  const nubiaConvs = eventsToConversations(crossEvents, 'clinica_nubia', [], nubiaColumns);
  // Cross-tenant event must NOT appear in Nubia conversations
  assert.equal(nubiaConvs.length, 0);

  const nubiaKanban = eventsToKanban(crossEvents, 'clinica_nubia', [], nubiaColumns);
  // Cross-tenant cards must NOT appear in any Nubia column
  const totalNubiaCards = nubiaKanban.reduce((acc, col) => acc + col.cards.length, 0);
  assert.equal(totalNubiaCards, 0);
});

test('Caso 20: Comprovação autoritativa dos 5 caminhos de propagação comercial (Kanban e Conversas)', async () => {
  const genesisColumns = [
    { id: 'sales_new', automationKey: 'sales_new', title: 'Pátio - Novos contatos', cards: [] },
    { id: 'sales_qualifying', automationKey: 'sales_qualifying', title: 'IA - Qualificação automotiva', cards: [] },
    { id: 'sales_financing', automationKey: 'sales_financing', title: 'Fila de financiamento', cards: [] },
    { id: 'sales_human', automationKey: 'sales_human', title: 'Atendimento humano', cards: [] },
    { id: 'sales_after_sales', automationKey: 'sales_after_sales', title: 'Pós-venda', cards: [] },
    { id: 'sales_closed', automationKey: 'sales_closed', title: 'Negócio fechado', cards: [] },
  ];

  // Base conversation & card state in qualifying
  let currentConvs = [
    {
      id: 'conv-whatsapp:5521999990000',
      canonicalKey: 'whatsapp:5521999990000:wesley_automoveis',
      externalConversationId: '5521999990000',
      contact: 'Raphael Rega',
      stage: 'IA - Qualificação automotiva',
      salesStageKey: 'sales_qualifying',
      tags: [],
      messages: [],
    },
  ];

  let currentKanban = [
    { id: 'sales_new', automationKey: 'sales_new', title: 'Pátio - Novos contatos', cards: [] },
    {
      id: 'sales_qualifying',
      automationKey: 'sales_qualifying',
      title: 'IA - Qualificação automotiva',
      cards: [
        {
          id: 'card-1',
          conversationId: 'conv-whatsapp:5521999990000',
          contact: 'Raphael Rega',
          externalConversationId: '5521999990000',
          channelType: 'whatsapp',
          stage: 'IA - Qualificação automotiva',
        },
      ],
    },
    { id: 'sales_financing', automationKey: 'sales_financing', title: 'Fila de financiamento', cards: [] },
    { id: 'sales_human', automationKey: 'sales_human', title: 'Atendimento humano', cards: [] },
    { id: 'sales_after_sales', automationKey: 'sales_after_sales', title: 'Pós-venda', cards: [] },
    { id: 'sales_closed', automationKey: 'sales_closed', title: 'Negócio fechado', cards: [] },
  ];

  // --- CAMINHO 1: Operação manual no Kanban (magia_sales_move) ---
  const manualMoveEvent = {
    id: 'ev-manual-move',
    tenant_slug: 'wesley_automoveis',
    tenant_id: 'tenant-genesis-id',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    sender_type: 'system',
    service: 'conversation_assigned',
    stage: 'Fila de financiamento',
    handoff: true,
    ai_provider: 'sales_operator',
    raw_payload: {
      sales_lead_id: 'lead-test',
      sales_stage: 'sales_financing',
      sales_stage_key: 'sales_financing',
      operator_id: 'usr-wesley',
    },
    created_at: new Date().toISOString(),
  };

  currentConvs = applyIncomingEventToConversations(currentConvs, manualMoveEvent, 'wesley_automoveis', { kanbanColumns: genesisColumns });
  currentKanban = applyIncomingEventToKanban(currentKanban, manualMoveEvent, 'wesley_automoveis');

  assert.equal(currentConvs[0].salesStageKey, 'sales_financing');
  assert.equal(currentConvs[0].stage, 'Fila de financiamento');
  assert.equal(currentConvs[0].tags.includes('Financiamento'), true);
  assert.equal(currentKanban.find(c => c.id === 'sales_financing').cards.length, 1);
  assert.equal(currentKanban.find(c => c.id === 'sales_qualifying').cards.length, 0);

  // --- CAMINHO 2: Turno automático de IA qualificando para Fila de financiamento ---
  const autoTurnEvent = {
    id: 'ev-auto-turn',
    tenant_slug: 'wesley_automoveis',
    tenant_id: 'tenant-genesis-id',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    sender_type: 'ai',
    service: 'sales_interest',
    stage: 'Fila de financiamento',
    handoff: true,
    ai_provider: 'sales_core',
    raw_payload: {
      sales_lead_id: 'lead-test',
      sales_stage: 'sales_financing',
      financing: true,
      sales_media: [{ kind: 'document', readable: true, has_cpf: true, has_birth_date: true }],
    },
    created_at: new Date(Date.now() + 1000).toISOString(),
  };

  currentConvs = applyIncomingEventToConversations(currentConvs, autoTurnEvent, 'wesley_automoveis', { kanbanColumns: genesisColumns });
  currentKanban = applyIncomingEventToKanban(currentKanban, autoTurnEvent, 'wesley_automoveis');

  assert.equal(currentConvs[0].salesStageKey, 'sales_financing');
  assert.equal(currentKanban.find(c => c.id === 'sales_financing').cards.length, 1);

  // --- CAMINHO 3: Handoff para atendente humano ---
  const handoffEvent = {
    id: 'ev-handoff',
    tenant_slug: 'wesley_automoveis',
    tenant_id: 'tenant-genesis-id',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    sender_type: 'system',
    service: 'conversation_assigned',
    stage: 'Atendimento humano',
    handoff: true,
    raw_payload: {
      sales_stage: 'sales_human',
      assignee: { id: 'usr-wesley', name: 'Wesley' },
    },
    created_at: new Date(Date.now() + 2000).toISOString(),
  };

  currentConvs = applyIncomingEventToConversations(currentConvs, handoffEvent, 'wesley_automoveis', { kanbanColumns: genesisColumns });
  currentKanban = applyIncomingEventToKanban(currentKanban, handoffEvent, 'wesley_automoveis');

  assert.equal(currentConvs[0].salesStageKey, 'sales_human');
  assert.equal(currentConvs[0].owner, 'Wesley');
  assert.equal(currentKanban.find(c => c.id === 'sales_human').cards.length, 1);
  assert.equal(currentKanban.find(c => c.id === 'sales_financing').cards.length, 0);

  // --- CAMINHO 4: Execução silenciosa (after-sales com reply='' e sem disparo externo) ---
  const silentEvent = {
    id: 'ev-silent-after-sales',
    tenant_slug: 'wesley_automoveis',
    tenant_id: 'tenant-genesis-id',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990000',
    direction: 'outbound',
    sender_type: 'ai',
    service: 'sales_qualification',
    stage: 'Pós-venda',
    handoff: false,
    ai_provider: 'sales_core',
    raw_payload: {
      sales_lead_id: 'lead-test',
      sales_stage: 'sales_after_sales',
      after_sales: true,
    },
    created_at: new Date(Date.now() + 3000).toISOString(),
  };

  currentConvs = applyIncomingEventToConversations(currentConvs, silentEvent, 'wesley_automoveis', { kanbanColumns: genesisColumns });
  currentKanban = applyIncomingEventToKanban(currentKanban, silentEvent, 'wesley_automoveis');

  assert.equal(currentConvs[0].salesStageKey, 'sales_after_sales');
  assert.equal(currentKanban.find(c => c.id === 'sales_after_sales').cards.length, 1);
  assert.equal(currentKanban.find(c => c.id === 'sales_human').cards.length, 0);

  // --- CAMINHO 5: Reconciliação autoritativa via banco (loadClientData / eventsToKanban) ---
  // Suponha que o WebSocket tenha caído e o banco sales_leads tenha stage_key = 'sales_financing'
  const dbEvents = [silentEvent];
  const dbSalesLeads = [
    {
      id: 'lead-test',
      channel_type: 'whatsapp',
      chat_id: '5521999990000',
      session_id: 'initial',
      stage_key: 'sales_financing',
      ai_locked: true,
      state: { payment_mode: 'financing', deposit_cents: 0 },
    },
  ];

  const reconciledKanban = eventsToKanban(dbEvents, 'wesley_automoveis', [], { columns: genesisColumns }, [], dbSalesLeads);
  const finCol = reconciledKanban.find(c => c.id === 'sales_financing');
  assert.equal(finCol.cards.length, 1);
  assert.equal(finCol.cards[0].externalConversationId, '5521999990000');
});

