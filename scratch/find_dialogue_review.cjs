const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('DIALOGUE_REVIEW_REQUIRED');
console.log('DIALOGUE_REVIEW_REQUIRED at', idx);
console.log(code.slice(idx - 300, idx + 400));
