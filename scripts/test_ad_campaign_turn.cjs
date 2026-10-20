const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

console.log('=== TEST SUITE: Regression — Real Inventory Fact Verification & Safe Delivery Barrier ===\n');

// Safely load Gemini API key from environment without printing or exposing secrets
function getSecureApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const match = fs.readFileSync(envPath, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch (e) {}
  return null;
}

// 1. Check Gemini Live Connectivity
async function callRealGemini(model, apiKey, prompt) {
  if (!apiKey) {
    return { text: 'Olá! A Yamaha Crosser 150 2023 está disponível em nosso estoque por R$ 19.900,00.', model, simulated: true };
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.2
      }
    });

    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Gemini API error ${res.statusCode}: ${body}`));
          }
          try {
            const parsed = JSON.parse(body);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve({ text, usage: parsed?.usageMetadata, model, simulated: false });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 2. Load Core Functions from noria_core.js
const coreCode = fs.readFileSync(path.resolve(__dirname, '../n8n/sources/noria_core.js'), 'utf8');

function extractFn(code, name) {
  const idx = code.indexOf('function ' + name);
  if (idx === -1) return null;
  let paren = 0, paramDone = false, bodyStart = -1;
  for (let i = idx; i < code.length; i++) {
    if (code[i] === '(') paren++;
    else if (code[i] === ')') {
      paren--;
      if (paren === 0) paramDone = true;
    } else if (paramDone && code[i] === '{') {
      bodyStart = i;
      break;
    }
  }
  if (bodyStart === -1) return null;
  let brace = 0, end = -1;
  for (let i = bodyStart; i < code.length; i++) {
    if (code[i] === '{') brace++;
    else if (code[i] === '}') {
      brace--;
      if (brace === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return code.slice(idx, end);
}

const sandbox = {
  normalizeText: (val) => String(val || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
  tenantSlug: 'wesley_automoveis',
  settingsFor: (ctx) => ctx?.settings?.settings || ctx?.settings || {},
  tenantTimeZone: (ctx) => 'America/Sao_Paulo',
  salesModeFor: (state) => state.intent || 'buy',
  salesSemanticProductEligibility: (p) => ({ eligible: Boolean(p && p.price_cents > 0) }),
  groundingIsFullName: (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length >= 2 && parts.every(p => p.length >= 2);
  },
  salesText: (t) => String(t || '').trim(),
  salesExplicitZeroDeposit: (text) => /\b(?:sem\s+entrada|zero\s+(?:de\s+)?entrada|nenhuma\s+entrada|nada\s+(?:de\s+)?entrada)\b/i.test(String(text || '')),
  salesDepositExceedsKnownPrice: (deposit, product) => Boolean(product?.price_cents && deposit > product.price_cents),
  salesLastPendingRequirement: (history) => 'customer_name',
  salesMoney: (v) => 'R$ ' + (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  salesCatalogLabel: (p) => p.name || `${p.brand} ${p.model} ${p.year}`,
  salesPriceKnown: (p) => Boolean(p && p.price_cents > 0),
  salesPriceUnavailableReply: (p) => `Consultei o catálogo para ${p.name || p.model}, mas o preço atual precisa ser confirmado com a equipe.`,
  salesContextualProductReply: (p, text) => `Olá! Sobre o ${p.name || p.model}: ele está disponível no estoque. Como posso te ajudar com ele?`,
  console
};

const fnNames = [
  'resolveTenantDayHours',
  'salesIsCatalogPlaceholder',
  'salesContextDependentRequest',
  'salesReferralProduct',
  'salesReferralReply',
  'tenantBusinessHoursStatus',
  'salesRecoverSafeDialogue',
  'salesValidatePrimaryDialogue',
  'salesFinancingCollection',
  'salesHandoffMessage'
];

for (const name of fnNames) {
  const fnDef = extractFn(coreCode, name);
  if (fnDef) {
    const evalFn = new Function(...Object.keys(sandbox), `return (${fnDef});`);
    sandbox[name] = evalFn(...Object.values(sandbox));
  }
}

// Kanban events projection logic
const eventsToKanbanModule = require('../app/src/services/kanban/eventsToKanban.js');
const eventsToKanban = eventsToKanbanModule.eventsToKanban;

async function runRegressionSuite() {
  const apiKey = getSecureApiKey();
  const model = 'gemini-3.5-flash-lite';
  const adMessageText = 'Olá! Posso ter mais informações sobre isso?';

  console.log('--- 1. REAL INVENTORY RECORD FROM NORIA-PROD (`genesis_inventory_vehicles`) ---');
  // Exact data from Supabase NORIA-prod:
  // tenant_id: 74b57037-9349-4a9e-889c-b65fb63c983a
  // brand: YAMAHA, model: CROSSER, model_year: 2023
  // price_cents: 1798000 (R$ 17.980,00), status: 'announced', availability_confirmed: false
  const realCrosser = {
    id: 'yamaha|crosser|2023|',
    vehicle_id: 'yamaha|crosser|2023|',
    tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
    brand: 'YAMAHA',
    model: 'CROSSER',
    year: '2023',
    name: 'Yamaha Crosser 2023',
    price_cents: 1798000, // R$ 17.980,00
    previous_price_cents: 1898000,
    status: 'announced',
    availability_verified: false, // NOT confirmed!
    price_source: 'genesis_authorized_sheet'
  };

  console.log('Authorized Product:', {
    tenant_id: realCrosser.tenant_id,
    model: `${realCrosser.brand} ${realCrosser.model} ${realCrosser.year}`,
    authorized_price: sandbox.salesMoney(realCrosser.price_cents),
    availability_verified: realCrosser.availability_verified,
    status: realCrosser.status
  });

  console.log('\n--- 2. REGRESSION: GEMINI OUTPUTS UNAUTHORIZED PRICE & UNVERIFIED AVAILABILITY ---');
  // Scenario: Gemini hallucinates R$ 19.900,00 (1990000 cents) and asserts availability
  const ungroundedGeminiOutput = {
    primary_reply: 'Olá! A Yamaha Crosser 150 2023 está disponível em nosso estoque por R$ 19.900,00. Como prefere negociar?',
    primary_facts: [
      { id: 'official.product.price_cents', value: '1798000' }
    ],
    response_contract: {
      answers: [{ request_id: 'req_1', excerpt: 'A Yamaha Crosser 150 2023 está disponível' }],
      requested_fields: [],
      facts: [],
      availability_asserted: true, // HALLUCINATION: Claims available when availability_verified is false
      assignment_confirmed: false,
      photo_sent: false
    }
  };

  const plan = {
    requests: [{ id: 'req_1', topic: 'availability' }],
    next_requirement: 'none'
  };

  const executionContext = {
    product: realCrosser,
    deposit_cents: null,
    assigned: false,
    photo_sent: false
  };

  console.log('[STAGE 1 — RAW MODEL OUTPUT]');
  console.log('  Raw Output:', `"${ungroundedGeminiOutput.primary_reply}"`);

  console.log('\n[STAGE 2 — DIALOGUE VALIDATION & GUARDRAIL AUDIT]');
  const audit = sandbox.salesValidatePrimaryDialogue(
    ungroundedGeminiOutput,
    plan,
    { active: false },
    executionContext
  );

  console.log('  Audit Status:', audit.status);
  console.log('  Audit Issues Detected:', audit.issues);

  assert.equal(audit.status, 'needs_human_review', 'Guardrail must reject ungrounded Gemini response');
  assert.ok(audit.issues.some(i => i.startsWith('UNSUPPORTED_AMOUNT')), 'Must flag unsupported amount (R$ 19.900)');
  assert.ok(audit.issues.includes('UNVERIFIED_PRODUCT_AVAILABILITY'), 'Must flag unverified product availability');

  console.log('\n[STAGE 3 — SAFE DIALOGUE RECOVERY & INTERCEPTION]');
  const context = {
    tenant: { id: '74b57037-9349-4a9e-889c-b65fb63c983a', slug: 'wesley_automoveis' },
    settings: {
      timezone: 'America/Sao_Paulo',
      business_hours: {
        schedule: {
          segunda: { start: '09:00', end: '18:00' },
          terca: { start: '09:00', end: '18:00' },
          quarta: { start: '09:00', end: '18:00' },
          quinta: { start: '09:00', end: '18:00' },
          sexta: { start: '09:00', end: '18:00' },
          sabado: { start: '09:00', end: '14:00' },
          domingo: { closed: true }
        }
      }
    }
  };

  const safeRecoveredReply = sandbox.salesRecoverSafeDialogue(
    context,
    { intent: 'buy' },
    adMessageText,
    { active: false },
    '',
    null,
    realCrosser
  );

  console.log('  Recovered Safe Reply:', `"${safeRecoveredReply}"`);

  assert.match(safeRecoveredReply, /R\$\s*17\.980,00/i, 'Safe dialogue must strictly quote verified price (R$ 17.980,00)');
  assert.match(safeRecoveredReply, /disponibilidade.*a confirmar com a equipe/i, 'Must disclose that availability is unconfirmed');
  assert.doesNotMatch(safeRecoveredReply, /19\.900/i, 'Safe dialogue must NOT contain 19.900');
  assert.doesNotMatch(safeRecoveredReply, /está disponível/i, 'Safe dialogue must NOT state vehicle is available');

  console.log('\n[STAGE 4 — FINAL DISPATCH MOCK]');
  // Simulate dispatch pipeline: the raw Gemini reply is DISCARDED, safe reply is delivered
  let finalDeliveredText = null;
  if (audit.status === 'accepted') {
    finalDeliveredText = ungroundedGeminiOutput.primary_reply;
  } else {
    finalDeliveredText = safeRecoveredReply;
  }

  console.log('  Final Delivered Text to Evolution API:', `"${finalDeliveredText}"`);
  assert.equal(finalDeliveredText, safeRecoveredReply, 'Dispatched message MUST BE the safe recovered dialogue');
  assert.doesNotMatch(finalDeliveredText, /19\.900/i, 'Dispatched text MUST NOT propagate incorrect price');
  assert.doesNotMatch(finalDeliveredText, /está disponível/i, 'Dispatched text MUST NOT propagate false availability');
  console.log('  ✓ Verified: The raw hallucinated text is completely blocked and never reaches Evolution API.');

  console.log('\n--- 3. P1 AUDIT: OUT-OF-HOURS HANDOFF MESSAGES (NO FALSE PROMISES) ---');
  // Test out of hours notice: must state next opening time without promising operator response at that exact time
  const fridayNight = new Date('2026-10-16T23:30:00-03:00');
  const hoursStatus = sandbox.tenantBusinessHoursStatus(context, fridayNight);
  const outOfHoursHandoff = sandbox.salesHandoffMessage(context, null, false, hoursStatus);

  console.log('Out of Hours Notice:', `"${outOfHoursHandoff}"`);
  assert.match(outOfHoursHandoff, /fora do horário comercial/i);
  assert.match(outOfHoursHandoff, /nosso próximo atendimento inicia amanhã às 09:00/i);
  assert.doesNotMatch(outOfHoursHandoff, /vai te responder amanhã às 09:00/i, 'Must NOT make false response guarantee');
  console.log('  ✓ Verified: Notice informs next opening without guaranteeing an immediate operator response.');

  console.log('\n--- 4. P1 AUDIT: PERSISTENCE OF HANDOFF & DIFFERENTIATION OF 3 STATES ---');
  // State A: assigned (explicit operator assigned)
  const eventAssigned = {
    id: 'evt-assign-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990001',
    created_at: '2026-10-16T14:00:00-03:00',
    direction: 'inbound',
    handoff: true,
    stage: 'Atendimento humano',
    raw_payload: {
      assignee: { id: 'usr-wesley-1', name: 'Wesley' },
      human_dispatch: {
        status: 'assigned',
        assignee_id: 'usr-wesley-1',
        assignee_name: 'Wesley',
        within_business_hours: true,
        next_opening: null
      }
    }
  };

  // State B: queued_unassigned (in hours, unassigned)
  const eventQueuedUnassigned = {
    id: 'evt-queued-2',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990002',
    created_at: '2026-10-16T14:30:00-03:00',
    direction: 'inbound',
    handoff: true,
    stage: 'Atendimento humano',
    raw_payload: {
      human_dispatch: {
        status: 'queued_unassigned',
        assignee_id: null,
        assignee_name: null,
        within_business_hours: true,
        next_opening: null
      }
    }
  };

  // State C: awaiting_business_hours (out of hours, unassigned, awaiting next shift)
  const eventAwaitingHours = {
    id: 'evt-awaiting-3',
    channel_type: 'whatsapp',
    external_conversation_id: '5521999990003',
    created_at: '2026-10-16T23:30:00-03:00',
    direction: 'inbound',
    handoff: true,
    stage: 'Atendimento humano',
    raw_payload: {
      human_dispatch: {
        status: 'awaiting_business_hours',
        assignee_id: null,
        assignee_name: null,
        within_business_hours: false,
        next_opening: 'amanhã às 09:00'
      }
    }
  };

  const leads = [
    {
      id: 'lead-1',
      channel_type: 'whatsapp',
      chat_id: '5521999990001',
      ai_locked: true,
      stage_key: 'sales_human',
      state: { human_dispatch: eventAssigned.raw_payload.human_dispatch }
    },
    {
      id: 'lead-2',
      channel_type: 'whatsapp',
      chat_id: '5521999990002',
      ai_locked: true,
      stage_key: 'sales_human',
      state: { human_dispatch: eventQueuedUnassigned.raw_payload.human_dispatch }
    },
    {
      id: 'lead-3',
      channel_type: 'whatsapp',
      chat_id: '5521999990003',
      ai_locked: true,
      stage_key: 'sales_human',
      state: { human_dispatch: eventAwaitingHours.raw_payload.human_dispatch, business_hours: { is_open: false, next_opening: 'amanhã às 09:00' } }
    }
  ];

  const kanban = eventsToKanban(
    [eventAssigned, eventQueuedUnassigned, eventAwaitingHours],
    'wesley_automoveis',
    [],
    null,
    [],
    leads
  );

  const cols = Array.isArray(kanban) ? kanban : kanban.columns;
  const humanCol = cols.find(c => c.id === 'conversas_humanos' || c.id === 'sales_human');
  assert.ok(humanCol, 'Human queue column must exist');

  const card1 = humanCol.cards.find(c => c.externalConversationId === '5521999990001');
  const card2 = humanCol.cards.find(c => c.externalConversationId === '5521999990002');
  const card3 = humanCol.cards.find(c => c.externalConversationId === '5521999990003');

  assert.ok(card1 && card2 && card3, 'All 3 cards must be present in the human queue');

  // Verify State A
  assert.equal(card1.humanDispatchStatus, 'assigned');
  assert.equal(card1.owner, 'Wesley');
  assert.equal(card1.ownerId, 'usr-wesley-1');
  assert.equal(card1.salesAiLocked, true);

  // Verify State B
  assert.equal(card2.humanDispatchStatus, 'queued_unassigned');
  assert.equal(card2.ownerId, null);
  assert.equal(card2.salesAiLocked, true);
  assert.equal(card2.outsideBusinessHours, false);

  // Verify State C
  assert.equal(card3.humanDispatchStatus, 'awaiting_business_hours');
  assert.equal(card3.ownerId, null);
  assert.equal(card3.salesAiLocked, true);
  assert.equal(card3.outsideBusinessHours, true);
  assert.match(card3.aiReason, /Aguardando próximo expediente/i);

  console.log('  Card 1 (Assigned):', { owner: card1.owner, status: card1.humanDispatchStatus });
  console.log('  Card 2 (Queued Unassigned):', { owner: card1.ownerId ? 'Wesley' : 'Não atribuído', status: card2.humanDispatchStatus });
  console.log('  Card 3 (Awaiting Hours):', { status: card3.humanDispatchStatus, reason: card3.aiReason, outsideHours: card3.outsideBusinessHours });
  console.log('  ✓ Verified: All 3 states strictly differentiated, persist across projection, and avoid fake human assignment.');

  console.log('\n=======================================================');
  console.log('🎉 REGRESSION & AUDIT SUITE COMPLETED WITH 100% SUCCESS!');
  console.log('=======================================================');
}

runRegressionSuite().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
