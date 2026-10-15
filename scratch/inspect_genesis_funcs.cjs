const fs = require('fs');

const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;

const funcs = [
  'salesGenesisFinancingQuestion',
  'salesGenesisGeneralFinancingQuestion',
  'salesGenesisFinancingQuestionReply',
  'salesGenesisSheetPriceAuthorized',
  'salesGenesisBareProductSelection',
  'salesGenesisFalseAvailabilityClaim',
  'salesGenesisTradeInOffer',
  'salesGenesisCatalogAudience',
  'salesGenesisIsKnownMotorcycle',
  'salesGenesisCatalogFilter',
  'salesGenesisCatalogOrdinal',
  'salesGenesisExplicitCatalogBuy',
  'salesGenesisNameProgressReply',
  'salesGenesisRepeatedDeferredSale',
  'salesGenesisExplicitListingRequested'
];

for (const name of funcs) {
  const start = code.indexOf('function ' + name);
  if (start < 0) {
    console.log(`NOT FOUND: ${name}`);
    continue;
  }
  // Find next function
  const nextFunc = code.indexOf('\nfunction ', start + 10);
  console.log(`=== ${name} (from ${start} to ${nextFunc}) ===`);
  console.log(code.slice(start, Math.min(start + 300, nextFunc)));
}
