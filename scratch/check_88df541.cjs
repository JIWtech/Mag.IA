const { execSync } = require('child_process');
const fs = require('fs');

const raw = execSync('git show "88df541:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
console.log('Code length:', code.length);
console.log('Has function salesHighConfidenceNonCustomerNoise:', code.includes('function salesHighConfidenceNonCustomerNoise'));
console.log('Has call salesHighConfidenceNonCustomerNoise:', code.includes('salesHighConfidenceNonCustomerNoise('));
