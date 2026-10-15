const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const listStart = code.indexOf('function salesGenesisExplicitListingRequested(');
const nextFunc = code.indexOf('\nfunction ', listStart + 10);
console.log('Next function after salesGenesisExplicitListingRequested:');
console.log(code.slice(nextFunc + 1, nextFunc + 80));
