const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('salesGenesisCatalogFilter(inventory,turnText)');
console.log('salesGenesisCatalogFilter(inventory,turnText) at', idx);
console.log(code.slice(idx - 150, idx + 200));
