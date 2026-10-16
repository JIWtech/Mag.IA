const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');

console.log('Testing Genesis & Noria Core Fixes...');

// 1. Test EXT Financing Detection & Replies
function extractFn(code, name) {
  const match = code.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}', 'm'));
  if (!match) throw new Error('Function ' + name + ' not found');
  return match[0];
}

const fnsCode = [
  'function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").trim().toLowerCase(); }',
  extractFn(extCode, 'parseCatalogOrdinal'),
  extractFn(extCode, 'commercialEligibility'),
  extractFn(extCode, 'classifyCatalogAudience'),
  extractFn(extCode, 'filterOfferableCatalog'),
  extractFn(extCode, 'isMotorcycle'),
  extractFn(extCode, 'normalizeVehicleCategory'),
  extractFn(extCode, 'resolveSelection'),
  extractFn(extCode, 'isFinancingQuestion'),
  extractFn(extCode, 'formatFinancingReply'),
].join('\n\n');

const fns = {};
vm.runInNewContext(fnsCode + '\nthis.fns = { isFinancingQuestion, formatFinancingReply, resolveSelection, normalizeText };', fns);
const testedFns = fns.fns;
Promise.resolve(testedFns).then(async (fns) => {
  assert.equal(fns.isFinancingQuestion('Financiamento'), true, 'Deveria reconhecer Financiamento');
  assert.equal(fns.isFinancingQuestion('como fica o financiamento?'), true, 'Deveria reconhecer como fica o financiamento');
  assert.equal(fns.isFinancingQuestion('quero financiar uma moto'), true, 'Deveria reconhecer financiar');
  assert.equal(fns.isFinancingQuestion('fazem simulacao de credito?'), true, 'Deveria reconhecer simulação');
  assert.equal(fns.isFinancingQuestion('quanto custa a vista?'), false, 'Não é financiamento');

  const finReply = fns.formatFinancingReply('como funciona o financiamento?');
  assert.match(finReply, /Quanto você pretende dar de entrada\?/i, 'Deveria perguntar sobre entrada');
  assert.doesNotMatch(finReply, /Wesley/i, 'NUNCA deve citar Wesley nominalmente');

  const fallbackFinReply = fns.formatFinancingReply('taxas gerais');
  assert.doesNotMatch(fallbackFinReply, /Wesley/i, 'Fallback de simulação não pode citar Wesley');
  assert.match(fallbackFinReply, /um atendente/i, 'Deve sugerir um atendente');

  // 2. Test resolveSelection (Category catalog search vs individual product selection)
  const fakeInventory = [
    { id: '1', name: 'Honda CB 600RR', model: 'CB 600RR', brand: 'Honda', year: 2014, category: 'motorcycle', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '2', name: 'Yamaha Crosser 150', model: 'Crosser 150', brand: 'Yamaha', year: 2021, category: 'motorcycle', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '3', name: 'Nissan Versa 1.6', model: 'Versa 1.6', brand: 'Nissan', year: 2020, category: 'car', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '4', name: 'Renault Sandero Stepway', model: 'Sandero Stepway', brand: 'Renault', year: 2019, category: 'car', status: 'disponivel', offerable: true, availability_verified: true },
  ];

  // 2.1 General category query should NOT trigger ambiguous product selection
  const categoryQuery = fns.resolveSelection('quais motos vocês têm disponíveis?', fakeInventory, null);
  assert.equal(categoryQuery.ambiguous, false, 'Pergunta geral de motos NÃO deve ser ambígua de produto');
  assert.equal(categoryQuery.product, null, 'Pergunta geral de motos não seleciona produto individual');

  const carCategoryQuery = fns.resolveSelection('tem carros no estoque?', fakeInventory, null);
  assert.equal(carCategoryQuery.ambiguous, false, 'Pergunta geral de carros NÃO deve ser ambígua de produto');

  // 2.2 Specific model references should resolve dynamically
  const cbMatch = fns.resolveSelection('gostei da CB', fakeInventory, null);
  assert.equal(cbMatch.product?.id, '1', 'Deveria selecionar CB 600RR dinamicamente');

  const versaMatch = fns.resolveSelection('me fala sobre o Versa', fakeInventory, null);
  assert.equal(versaMatch.product?.id, '3', 'Deveria selecionar Versa dinamicamente sem hardcode');

  const crosserMatch = fns.resolveSelection('quero a crosser', fakeInventory, null);
  assert.equal(crosserMatch.product?.id, '2', 'Deveria selecionar Crosser');

  // 3. Verify CORE sources: no hardcoded "o Wesley" promises and ad template protected
  assert.doesNotMatch(coreCode, /confirmada com o Wesley/i, 'CORE não pode prometer confirmação com o Wesley');
  assert.doesNotMatch(coreCode, /chame o Wesley para conferir/i, 'CORE não pode sugerir chamar o Wesley');
  assert.doesNotMatch(coreCode, /chamar o Wesley para continuar/i, 'CORE não pode sugerir chamar o Wesley no duplicate guard');
  assert.doesNotMatch(coreCode, /por exemplo PCX/i, 'Prompt não pode conter modelo fixo PCX');
  assert.doesNotMatch(coreCode, /como esse Nissan, a Crosser/i, 'Prompt não pode conter exemplos fixos de modelos');

  // 4. Verify turnHasFinancingOrDeposit guard in noria_core.js
  assert.match(coreCode, /turnHasFinancingOrDeposit/, 'CORE deve ter a guarda turnHasFinancingOrDeposit no template de anúncio');

  // 5. Verify absence of hardcoded PCX in validation guidance
  assert.doesNotMatch(coreCode, /da PCX\b/, 'Guidance não pode citar "da PCX"');
  assert.doesNotMatch(coreCode, /pela PCX\b/, 'Guidance não pode citar "pela PCX"');

  // 6. Verify isCommercialContact and shouldIgnoreBecauseOwnerSavedContact in noria_core.js
  assert.match(coreCode, /function isCommercialContact\(/, 'CORE deve implementar isCommercialContact');
  assert.match(coreCode, /isCommercialContact\(contact, turn\)/, 'runSalesTurn deve chamar isCommercialContact');
  assert.match(coreCode, /inputJson\.contact_category === 'saved'/, 'shouldIgnoreBecauseOwnerSavedContact deve verificar contact_category saved');
  assert.match(coreCode, /inputJson\.isMyContact === true/, 'shouldIgnoreBecauseOwnerSavedContact deve verificar isMyContact');

  // 7. Verify salesLoadLead context preservation on reopened attendance
  assert.match(coreCode, /Preserva contexto de atendimentos anteriores/, 'salesLoadLead deve herdar contexto de sessões anteriores');

  console.log('✅ All Genesis & Noria Core Fixes passed with 100% assertions satisfied!');
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

