const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const authStart = code.indexOf('function salesGenesisSheetPriceAuthorized(');
const authEnd = code.indexOf('\nfunction salesPriceKnown(', authStart);
console.log(code.slice(authStart, authEnd));
