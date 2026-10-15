const { execSync } = require('child_process');
const raw = execSync('git show "HEAD:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('const auctionText=normalizeText(latestTurnText);');
console.log(code.slice(idx, idx + 4000));
