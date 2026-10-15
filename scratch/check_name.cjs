const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const nameStart = code.indexOf('function salesGenesisNameProgressReply(');
const nextFunc = code.indexOf('\nfunction ', nameStart + 10);
console.log('Functions from nameStart to nextFunc:');
console.log(code.slice(nextFunc + 1, nextFunc + 80));
