const { execSync } = require('child_process');

const raw = execSync('git show "88df541:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const funcs = [...code.matchAll(/function\s+(salesGenesis[a-zA-Z0-9_]+)/g)].map(m => m[1]);
console.log('Unique salesGenesis functions:', [...new Set(funcs)]);
for (const f of [...new Set(funcs)]) {
  const idx = code.indexOf('function ' + f);
  console.log(`- ${f} at index ${idx}`);
}
