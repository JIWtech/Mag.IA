const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const regressionsFile = path.join(root, 'scripts/build/n8n/whatsapp_commercial_regressions.cjs');
const regContent = fs.readFileSync(regressionsFile, 'utf8');

// Replace code = ... with checks
const lines = regContent.split('\n');
let instrumented = '';
for (let i = 0; i < lines.length; i++) {
  instrumented += lines[i] + '\n';
  if (lines[i].includes('code = ') || lines[i].includes('code=')) {
    instrumented += `if (!code.includes('function salesHighConfidenceNonCustomerNoise')) { console.log('LOST salesHighConfidenceNonCustomerNoise at line ${i+1}: ${lines[i].trim().slice(0, 50)}'); process.exit(1); }\n`;
  }
}

fs.writeFileSync(path.join(__dirname, 'instrumented_regressions.cjs'), instrumented);

const hotfixFile = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(hotfixFile, 'utf8'));
const coreNode = workflow.nodes.find(n => n.name === 'CORE | Motor conversacional único');
const origCode = coreNode.parameters.jsCode;

const { applyCommercialRegressions } = require('./instrumented_regressions.cjs');
applyCommercialRegressions(origCode);
