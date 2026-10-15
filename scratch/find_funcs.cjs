const { execSync } = require('child_process');

const raw = execSync('git show "88df541:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('function salesHighConfidenceNonCustomerNoise');
console.log('--- Functions between salesHighConfidenceNonCustomerNoise and next 20000 chars ---');
const slice = code.slice(idx, idx + 20000);
const funcMatches = [...slice.matchAll(/function\s+([a-zA-Z0-9_]+)/g)].map(m => m[1]);
console.log(funcMatches);
