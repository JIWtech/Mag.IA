const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const start = code.indexOf('genesis-sheet-price-and-auction-v6');
console.log(code.slice(start - 50, start + 800));
