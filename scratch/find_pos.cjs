const { execSync } = require('child_process');

const raw = execSync('git show "88df541:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('function salesHighConfidenceNonCustomerNoise');
console.log('Index:', idx);
console.log('Preceding 200 chars:\n', code.slice(idx - 200, idx));
console.log('Following 200 chars:\n', code.slice(idx, idx + 200));
