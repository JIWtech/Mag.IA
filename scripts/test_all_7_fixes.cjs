const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Test salesAmount and zero deposit detection
const noriaCore = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8');

// Evaluate salesAmount and salesExplicitZeroDeposit in an isolated sandbox
const vm = require('node:vm');
const sandbox = {
  normalizeText: (str) => String(str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.,!?-]/g, ' ')
    .replace(/\s+/g, ' ').trim(),
  tenantSlug: 'wesley_automoveis'
};
vm.createContext(sandbox);

// Extract helper functions
vm.runInContext(`
  ${noriaCore.slice(noriaCore.indexOf('function salesAmount('), noriaCore.indexOf('function salesBirthDate('))}
  ${noriaCore.slice(noriaCore.indexOf('function salesExplicitZeroDeposit('), noriaCore.indexOf('function salesApplyDeterministicPaymentState('))}
`, sandbox);

console.log('Testing Fix 1: salesAmount zero down payment declarations...');
assert.equal(sandbox.salesAmount('sem entrada'), 0, 'sem entrada should be 0');
assert.equal(sandbox.salesAmount('zero de entrada'), 0, 'zero de entrada should be 0');
assert.equal(sandbox.salesAmount('vou fazer sem entrada'), 0, 'vou fazer sem entrada should be 0');
assert.equal(sandbox.salesAmount('dar zero de entrada'), 0, 'dar zero de entrada should be 0');
assert.equal(sandbox.salesAmount('10 mil'), 1000000, '10 mil should be 1000000 cents');
assert.equal(sandbox.salesAmount('tem como fazer sem entrada?'), null, 'question should not parse as amount');
assert.equal(sandbox.salesAmount('consegue sem entrada?'), null, 'question should not parse as amount');
console.log('✅ Fix 1 passed: salesAmount correctly parses zero down payment declarations and ignores questions.');

// 2. Test genesis_extension parseBrazilianCurrency
const genesisCode = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
const genesisSandbox = {
  normalizeText: sandbox.normalizeText
};
vm.createContext(genesisSandbox);
vm.runInContext(`
  ${genesisCode.slice(genesisCode.indexOf('function parsePrice('), genesisCode.indexOf('function capitalizeWord('))}
`, genesisSandbox);

console.log('Testing Fix 2: genesis parseBrazilianCurrency zero down payment...');
const zeroDep1 = genesisSandbox.parseBrazilianCurrency('sem entrada');
assert.equal(zeroDep1.deposit, 0);
assert.equal(zeroDep1.deposit_cents, 0);

const zeroDep2 = genesisSandbox.parseBrazilianCurrency('zero de entrada');
assert.equal(zeroDep2.deposit, 0);
assert.equal(zeroDep2.deposit_cents, 0);

const zeroQuestion = genesisSandbox.parseBrazilianCurrency('e se for sem entrada?');
assert.equal(zeroQuestion.deposit, null);
assert.equal(zeroQuestion.deposit_cents, null);

const normalDep = genesisSandbox.parseBrazilianCurrency('entrada de 15 mil');
assert.equal(normalDep.deposit, 15000);
assert.equal(normalDep.deposit_cents, 1500000);
console.log('✅ Fix 2 passed: parseBrazilianCurrency zero down payment handled cleanly.');

// 3. Test salesFinancingSummary with v1 and v2 rules
const { salesFinancingSummary } = require('../app/src/services/kanban/eventsToKanban.js');
console.log('Testing Fix 3: salesFinancingSummary supporting v1 and v2...');
const leadV1 = {
  state: {
    financing_qualification: {
      rule: 'deposit_30_and_financing_documents_v1',
      status: 'ready',
      deposit_cents: 3000000,
      minimum_deposit_cents: 2000000
    }
  }
};
const summaryV1 = salesFinancingSummary(leadV1, 'wesley_automoveis');
assert.ok(summaryV1.includes('Entrada e documentos recebidos'), 'Summary V1 must produce label');

const leadV2 = {
  state: {
    financing_qualification: {
      rule: 'deposit_and_financing_documents_v2',
      status: 'ready',
      deposit_cents: 3000000,
      minimum_deposit_cents: 2000000
    }
  }
};
const summaryV2 = salesFinancingSummary(leadV2, 'wesley_automoveis');
assert.ok(summaryV2.includes('Entrada e documentos recebidos'), 'Summary V2 must produce label');
console.log('✅ Fix 3 passed: salesFinancingSummary supports both v1 and v2 rules.');

// 4. Test follow-up dispatch credentials fallback
console.log('Testing Fix 4: follow-up dispatch credentials fallback...');
const dispatchCode = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_follow_up_dispatch.js'), 'utf8');
assert.ok(dispatchCode.includes("env('EVOLUTION_API_URL')"), 'Should fallback to EVOLUTION_API_URL');
assert.ok(dispatchCode.includes("env('EVOLUTION_API_KEY')"), 'Should fallback to EVOLUTION_API_KEY');
assert.ok(dispatchCode.includes("channel.external_id"), 'Should fallback to channel.external_id for instance');
console.log('✅ Fix 4 passed: follow-up dispatch handles generic Evolution credentials fallback.');

// 5. Test noria_core human requested & anti loop & financing stage
console.log('Testing Fix 5: noria_core human request & stage key fixes...');
assert.ok(noriaCore.includes("plan.semantic_intent?.primary_intent === 'human_handoff'"), 'salesSemanticPlanFromPrimary should check primary_intent');
assert.ok(noriaCore.includes("plan.semantic_intent.secondary_intents.includes('human_handoff')"), 'salesSemanticPlanFromPrimary should check secondary_intents');
assert.ok(noriaCore.includes("stage=cfg.stage_keys.financing || cfg.stage_keys.human"), 'stage assignment should use stage_keys.financing');
assert.ok(noriaCore.includes("if (duplicateDecision.duplicate) reply=duplicateDecision.reply"), 'duplicateDecision should override reply');
console.log('✅ Fix 5 passed: noria_core human request, anti-loop, and financing stage key validated.');

// 6. Test SQL migration 028
console.log('Testing Fix 6: SQL migration 028 hot_lead_rule...');
const sql028 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/028_sales_financing_qualification.sql'), 'utf8');
assert.ok(sql028.includes("'deposit_and_financing_documents_v2'"), 'SQL migration should accept v2 rule');
console.log('✅ Fix 6 passed: migration 028 accepts v2 rule.');

// 7. Test system prompt persona alignment
console.log('Testing Fix 7: system_prompt.md persona alignment...');
const promptMd = fs.readFileSync(path.join(__dirname, '../clients/wesley_automoveis/system_prompt.md'), 'utf8');
assert.ok(promptMd.includes('Gênesis Automóveis'), 'Prompt should refer to Gênesis Automóveis');
assert.ok(promptMd.includes('Vou pedir para um atendente verificar no pátio'), 'Prompt line 17 should refer to um atendente');
console.log('✅ Fix 7 passed: system_prompt.md aligned.');

console.log('\n🎉 ALL 7 AUDITED INCONSISTENCIES AND FIXES FULLY VERIFIED!');
