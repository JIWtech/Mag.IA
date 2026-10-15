const fs = require('fs');
const path = require('path');
const ts = require('../app/node_modules/typescript');

const root = path.resolve(__dirname, '..');
const hotfixFile = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(hotfixFile, 'utf8'));
const coreNode = workflow.nodes.find(n => n.name === 'CORE | Motor conversacional único');
const origCode = coreNode.parameters.jsCode;

console.log('Original has salesHighConfidenceNonCustomerNoise:', origCode.includes('function salesHighConfidenceNonCustomerNoise'));

// Test whatsapp_commercial_regressions
const { applyCommercialRegressions } = require('../scripts/build/n8n/whatsapp_commercial_regressions.cjs');

try {
  const transformed = applyCommercialRegressions(origCode, ts);
  console.log('Transformed has salesHighConfidenceNonCustomerNoise:', transformed.includes('function salesHighConfidenceNonCustomerNoise'));
  console.log('Transformed has salesGenesis:', transformed.includes('salesGenesis'));
  console.log('Transformed length:', transformed.length);
} catch (err) {
  console.error('Error during applyCommercialRegressions:', err);
}
