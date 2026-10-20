const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('=== TEST SUITE: Financing, Silence Elimination & Kanban Classification ===\n');

// 1. Load canonical sources
const coreCode = fs.readFileSync(path.resolve(__dirname, '../n8n/sources/noria_core.js'), 'utf8');

// Helper to evaluate functions in an isolated context
function createIsolatedCore() {
  const context = {
    tenantSlug: 'wesley_automoveis',
    chatId: '5521999999999@s.whatsapp.net',
    turn: { boundary_id: 'session-123' },
    settings: {
      sales: {
        hot_lead_rule: 'deposit_30_and_financing_documents_v1',
        collect_documents: true,
        required_financing_documents: ['cpf', 'cnh', 'birth_date'],
        stage_keys: {
          initial: 'sales_new',
          qualifying: 'sales_qualifying',
          financing: 'sales_financing',
          hot: 'sales_hot',
          human: 'sales_human',
          appraisal: 'sales_appraisal',
          closed: 'sales_closed',
          after_sales: 'sales_after_sales',
          warm: 'sales_warm',
          cold: 'sales_cold'
        }
      },
      sdr_rules: {
        hot_lead_percent: 30
      }
    }
  };

  const sandbox = {
    normalizeText: (val) => String(val || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    tenantSlug: 'wesley_automoveis',
    settingsFor: (ctx) => ctx?.settings?.settings || ctx?.settings || context.settings,

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
    console
  };


  // Extract necessary functions from noria_core.js
  const fnNames = [
    'salesAmount',
    'salesFinancingPolicy',
    'salesFinancingCollection',
    'salesFinancingTemperature',
    'salesMissingFinancingDocuments',
    'salesRecoverSafeDialogue',
    'salesApplyDeterministicDepositState',
    'salesCurrentDepositOffer',
    'salesMoney'
  ];

  for (const name of fnNames) {
    const regex = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'g');
    const match = coreCode.match(regex);
    if (!match) {
      throw new Error(`Function not found in noria_core.js: ${name}`);
    }
    // Pick the right match
    const fnDef = match.find(m => m.startsWith(`function ${name}`));
    const evalFn = new Function(...Object.keys(sandbox), `return (${fnDef});`);
    sandbox[name] = evalFn(...Object.values(sandbox));
  }

  return sandbox;
}

const core = createIsolatedCore();

// ==========================================
// TEST 1: salesAmount Natural Language Parsing
// ==========================================
console.log('--- TEST 1: salesAmount Natural Language Parsing ---');

const amountCases = [
  { input: '15 mil e o resto parcela em quantas vezes ?', expected: 1500000, desc: 'Real prod Crosser question + thousands' },
  { input: 'dou 15 de entrada', expected: 1500000, desc: 'dou 15 without mil (shorthand thousands) - not broken by ou regex' },
  { input: '15k e o resto financia?', expected: 1500000, desc: '15k with question' },
  { input: '15 mil', expected: 1500000, desc: 'isolated 15 mil' },
  { input: '15k', expected: 1500000, desc: 'isolated 15k' },
  { input: 'tenho 20 de entrada', expected: 2000000, desc: 'tenho 20 de entrada' },
  { input: '15 mil de entrada', expected: 1500000, desc: '15 mil de entrada' },
  { input: 'R$ 15.000,00', expected: 1500000, desc: 'standard Brazilian BRL' },
  { input: 'consigo dar 15 mil', expected: 1500000, desc: 'consigo dar 15 mil' },
  { input: 'sem entrada', expected: 0, desc: 'explicit zero deposit' },
  { input: 'tem como fazer sem entrada?', expected: null, desc: 'question about zero deposit (not affirmative statement)' },
  { input: 'entre 10 e 15 mil', expected: null, desc: 'range or vague amount rejected' },
];

for (const { input, expected, desc } of amountCases) {
  const parsed = core.salesAmount(input);
  assert.equal(parsed, expected, `Failed on "${input}" (${desc}). Got: ${parsed}, expected: ${expected}`);
  console.log(`  ✔ [salesAmount] "${input}" -> ${parsed} (${desc})`);
}

// ==========================================
// TEST 2: salesFinancingPolicy Coexistence (v1 and v2)
// ==========================================
console.log('\n--- TEST 2: salesFinancingPolicy Coexistence (v1 and v2) ---');

const policyV1 = core.salesFinancingPolicy({
  settings: {
    sales: {
      hot_lead_rule: 'deposit_30_and_financing_documents_v1',
      collect_documents: true,
      required_financing_documents: ['cpf', 'cnh', 'birth_date']
    },
    sdr_rules: { hot_lead_percent: 30 }
  }
});
assert.equal(policyV1.enabled, true, 'v1 hot_lead_rule must be enabled!');
assert.equal(policyV1.percent, 30);
assert.deepEqual(policyV1.requiredDocuments, ['cpf', 'cnh', 'birth_date']);
console.log('  ✔ [salesFinancingPolicy] deposit_30_and_financing_documents_v1 is ENABLED with 30% and documents.');

const policyV2 = core.salesFinancingPolicy({
  settings: {
    sales: {
      hot_lead_rule: 'deposit_and_financing_documents_v2',
      collect_documents: true,
      required_financing_documents: ['cpf', 'cnh', 'birth_date']
    },
    sdr_rules: { hot_lead_percent: 30 }
  }
});
assert.equal(policyV2.enabled, true, 'v2 hot_lead_rule must be enabled!');
console.log('  ✔ [salesFinancingPolicy] deposit_and_financing_documents_v2 is ENABLED.');

const policyUnknown = core.salesFinancingPolicy({
  settings: {
    sales: { hot_lead_rule: 'legacy_rule' },
    sdr_rules: { hot_lead_percent: 30 }
  }
});
assert.equal(policyUnknown.enabled, false, 'unknown hot_lead_rule must be disabled');

console.log('  ✔ [salesFinancingPolicy] Unknown rule safely disabled without errors.');

// ==========================================
// TEST 3: Progressive Financing Collection
// ==========================================
console.log('\n--- TEST 3: Progressive Financing Collection ---');

const mockProduct = { id: 'yamaha|crosser|2023|', price_cents: 1800000, model: 'Crosser' };

// Step 3.1: Initially no name, no deposit, no docs
const col1 = core.salesFinancingCollection({}, { payment_mode: 'financing', intent: 'buy', customer_name: '', deposit_cents: null }, {}, mockProduct);
assert.equal(col1.active, true);
assert.equal(col1.next_field, 'customer_name', 'First field must be customer_name');
assert.equal(col1.ready, false);
console.log('  ✔ [Collection Turn 1] Next requirement is customer_name.');

// Step 3.2: Customer gives deposit out-of-order ("15 mil e o resto parcela em quantas vezes ?")
const stateWithDeposit = { payment_mode: 'financing', intent: 'buy', customer_name: '', deposit_cents: 1500000 };
const col2 = core.salesFinancingCollection({}, stateWithDeposit, {}, mockProduct);
assert.equal(col2.active, true);
assert.equal(col2.next_field, 'customer_name', 'Customer name is still requested next');
assert.ok(!col2.missing_fields.includes('deposit'), 'Deposit is recognized and NOT missing anymore');
console.log('  ✔ [Collection Turn 2] Deposit captured! Deposit is no longer in missing_fields.');

// Step 3.3: Customer gives full name
const stateWithName = { ...stateWithDeposit, customer_name: 'Carlos da Silva' };
const col3 = core.salesFinancingCollection({}, stateWithName, {}, mockProduct);
assert.equal(col3.next_field, 'cnh', 'Next requirement is CNH');
assert.ok(!col3.missing_fields.includes('customer_name'), 'Customer name completed');
console.log('  ✔ [Collection Turn 3] Name completed. Next requirement is CNH.');

// Step 3.4: Customer provides CNH document (with OCR extracted CPF, birth date)
const docStatusComplete = { cnh_received: true, cpf_received: true, birth_date_received: true, full_name_received: true };
const col4 = core.salesFinancingCollection({}, stateWithName, docStatusComplete, mockProduct);
assert.equal(col4.ready, true, 'Collection must now be ready for human financing desk!');
assert.equal(col4.missing_fields.length, 0);
console.log('  ✔ [Collection Turn 4] All requirements fulfilled -> ready: true.');

// ==========================================
// TEST 4: Temperature Progression
// ==========================================
console.log('\n--- TEST 4: Temperature Progression ---');

// 4.1 deposit null -> unknown
const tUnknown = core.salesFinancingTemperature({ deposit_cents: null }, mockProduct, {}, {});
assert.equal(tUnknown.temperature, 'unknown');
console.log('  ✔ [Temperature] deposit_cents: null -> unknown');

// 4.2 deposit 0 -> cold
const tCold = core.salesFinancingTemperature({ deposit_cents: 0 }, mockProduct, {}, {});
assert.equal(tCold.temperature, 'cold');
console.log('  ✔ [Temperature] deposit_cents: 0 -> cold');

// 4.3 deposit < 30% (e.g. R$ 3.000 in 18.000 = 16.6%) -> warm
const tWarmLow = core.salesFinancingTemperature({ deposit_cents: 300000 }, mockProduct, {}, {});
assert.equal(tWarmLow.temperature, 'warm');
console.log('  ✔ [Temperature] deposit_cents: R$ 3.000 (< 30%) -> warm');

// 4.4 deposit >= 30% (R$ 15.000 in 18.000 = 83%) BUT documents pending -> warm
const tWarmDocsPending = core.salesFinancingTemperature({ deposit_cents: 1500000 }, mockProduct, { cnh_received: false }, {});
assert.equal(tWarmDocsPending.temperature, 'warm');
console.log('  ✔ [Temperature] deposit_cents: R$ 15.000 (>= 30%) but docs pending -> warm (NOT hot yet)');

// 4.5 deposit >= 30% AND documents complete -> hot
const tHot = core.salesFinancingTemperature({ deposit_cents: 1500000 }, mockProduct, docStatusComplete, {});
assert.equal(tHot.temperature, 'hot');
console.log('  ✔ [Temperature] deposit_cents >= 30% AND docs complete -> hot!');

// 4.6 vehicle price unverified/null -> unknown
const tNoPrice = core.salesFinancingTemperature({ deposit_cents: 1500000 }, { price_cents: null }, docStatusComplete, {});
assert.equal(tNoPrice.temperature, 'unknown');
console.log('  ✔ [Temperature] Vehicle price unverified/null -> unknown (no false hot)');

// ==========================================
// TEST 5: Eliminating AI Silence (Guardrail Recovery)
// ==========================================
console.log('\n--- TEST 5: Eliminating AI Silence (Guardrail Recovery) ---');

// Turn 1 failure in prod: "15 mil e o resto parcela em quantas vezes ?"
// AI drafted an answer that was rejected by guardrail
const safeRecoveryTurn1 = core.salesRecoverSafeDialogue(
  {},
  { deposit_cents: 1500000, customer_name: '' },
  '15 mil e o resto parcela em quantas vezes ?',
  { active: true, next_field: 'customer_name', ready: false },
  'customer_name',
  null,
  mockProduct
);

assert.ok(safeRecoveryTurn1, 'Recovery reply MUST NOT be empty!');
assert.match(safeRecoveryTurn1, /dificuldade temporária/i, 'Recovery must be operationally transparent');
assert.doesNotMatch(safeRecoveryTurn1, /R\$|financi|entrada|nome completo/i, 'Recovery must not author commercial dialogue');
console.log(`  ✔ [Safe Recovery Turn 1]\n    Reply: "${safeRecoveryTurn1.replace('\n', ' ')}"`);

// Turn 2 failure in prod: "Oi?" after waiting in silence
const safeRecoveryTurn2 = core.salesRecoverSafeDialogue(
  {},
  { deposit_cents: 1500000, customer_name: '' },
  'Oi?',
  { active: true, next_field: 'customer_name', ready: false },
  'customer_name',
  null,
  mockProduct
);

assert.ok(safeRecoveryTurn2, 'Recovery reply MUST NOT be empty for "Oi?"!');
assert.match(safeRecoveryTurn2, /dificuldade temporária/i, 'Recovery must not infer greeting or pending intent');
console.log(`  ✔ [Safe Recovery Turn 2]\n    Reply: "${safeRecoveryTurn2.replace('\n', ' ')}"`);

// Deposit exceeds vehicle price (e.g. 25 mil in 18 mil bike)
const safeRecoveryExceeds = core.salesRecoverSafeDialogue(
  {},
  { deposit_cents: 2500000, customer_name: 'Carlos' },
  'dou 25 de entrada',
  { active: true, next_field: 'deposit', ready: false },
  'deposit',
  { reason: 'exceeds_vehicle_price', deposit_cents: 2500000 },
  mockProduct
);
assert.match(safeRecoveryExceeds, /dificuldade temporária/i, 'Rejected dialogue uses the same transparent fallback');
console.log(`  ✔ [Safe Recovery Deposit Exceeds Price]\n    Reply: "${safeRecoveryExceeds}"`);

// ==========================================
// TEST 6: Virtual Kanban Projection & Commercial Stages
// ==========================================
console.log('\n--- TEST 6: Virtual Kanban Projection & Commercial Stages ---');

const { GENESIS_SALES_STAGES, GENESIS_SALES_STAGE_KEYS, GENESIS_SALES_STAGE_DEFAULT_NAMES } = require('../app/src/services/kanban/commercialStages.js');
const { resolveTenantKanbanStage, salesFinancingSummary } = require('../app/src/services/kanban/eventsToKanban.js');

// 6.1 All 11 columns recognized
const expectedColumns = [
  'sales_new',
  'sales_qualifying',
  'sales_hot',
  'sales_human',
  'sales_appraisal',
  'sales_financing',
  'sales_closed',
  'sales_after_sales',
  'follow_ups',
  'sales_warm',
  'sales_cold'
];

for (const col of expectedColumns) {
  assert.ok(GENESIS_SALES_STAGE_KEYS.has(col), `GENESIS_SALES_STAGE_KEYS missing: ${col}`);
  assert.ok(GENESIS_SALES_STAGE_DEFAULT_NAMES[col], `GENESIS_SALES_STAGE_DEFAULT_NAMES missing: ${col}`);
  console.log(`  ✔ [Kanban Stages] ${col} -> ${GENESIS_SALES_STAGE_DEFAULT_NAMES[col]}`);
}

// 6.2 Projection: Persisted manual stage is preserved
const stageManualWarm = resolveTenantKanbanStage({
  tenantSlug: 'wesley_automoveis',
  salesLead: { stage_key: 'sales_warm', state: { temperature: 'warm' } },
  event: { stage: 'Leads Mornos' }
});
assert.deepEqual(stageManualWarm, ['sales_warm']);
console.log('  ✔ [Kanban Projection] sales_warm lead maps directly to sales_warm column.');

const stageManualCold = resolveTenantKanbanStage({
  tenantSlug: 'wesley_automoveis',
  salesLead: { stage_key: 'sales_cold', state: { temperature: 'cold' } },
  event: { stage: 'Leads Frios' }
});
assert.deepEqual(stageManualCold, ['sales_cold']);
console.log('  ✔ [Kanban Projection] sales_cold lead maps directly to sales_cold column.');

// 6.3 Projection: Financing ready for human maps to sales_financing
const stageFinancingReady = resolveTenantKanbanStage({
  tenantSlug: 'wesley_automoveis',
  salesLead: {
    stage_key: 'sales_qualifying',
    state: {
      payment_mode: 'financing',
      financing: { review_status: 'ready_for_human', temperature: 'hot' }
    }
  },
  event: { stage: 'IA - Qualificacao automotiva' }
});
assert.deepEqual(stageFinancingReady, ['sales_financing']);
console.log('  ✔ [Kanban Projection] Financing ready for human maps to sales_financing column.');

// 6.4 Projection: Human assigned or closed lead preserves ownership and stage
const stageHumanLocked = resolveTenantKanbanStage({
  tenantSlug: 'wesley_automoveis',
  salesLead: { stage_key: 'sales_human', ai_locked: true },
  event: { stage: 'Atendimento humano' }
});
assert.deepEqual(stageHumanLocked, ['sales_human']);
console.log('  ✔ [Kanban Projection] Human locked lead preserved in sales_human.');

const stageClosed = resolveTenantKanbanStage({
  tenantSlug: 'wesley_automoveis',
  salesLead: { stage_key: 'sales_closed', ai_locked: true },
  event: { stage: 'Negócio fechado' }
});
assert.deepEqual(stageClosed, ['sales_closed']);
console.log('  ✔ [Kanban Projection] Closed lead preserved in sales_closed.');

// 6.5 salesFinancingSummary fallback for leads before migration 028
const summaryLegacy = salesFinancingSummary({
  deposit_cents: 1500000,
  state: { payment_mode: 'financing', temperature: 'warm' }
}, 'wesley_automoveis');
assert.ok(summaryLegacy.includes('Financiamento'));
assert.ok(summaryLegacy.includes('Morno'));
assert.ok(summaryLegacy.includes('15.000,00'));
console.log(`  ✔ [Kanban Subtitle] Legacy lead subtitle rendered: "${summaryLegacy}"`);

console.log('\n======================================================');
console.log('ALL INTEGRATED TESTS PASSED SUCCESSFULLY! (100%)');
console.log('======================================================\n');
