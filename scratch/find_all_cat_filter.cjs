const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
let idx = 0;
while ((idx = code.indexOf('salesGenesisCatalogFilter', idx)) !== -1) {
  console.log('salesGenesisCatalogFilter at', idx, ':\n', code.slice(idx - 60, idx + 100));
  idx += 25;
}
