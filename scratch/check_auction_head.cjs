const { execSync } = require('child_process');
const raw = execSync('git show "HEAD:n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json"', { maxBuffer: 100 * 1024 * 1024 }).toString();
const wf = JSON.parse(raw);
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
const idx = code.indexOf('auctionTopic=') >= 0 ? code.indexOf('auctionTopic=') : code.indexOf('auctionIntent');
console.log('Auction in HEAD at index:', idx);
console.log(code.slice(idx - 100, idx + 1500));
