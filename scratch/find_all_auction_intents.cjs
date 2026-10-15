const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const code = wf.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.jsCode;
let idx = 0;
while ((idx = code.indexOf('auctionIntent', idx)) !== -1) {
  console.log('AuctionIntent at', idx, ':\n', code.slice(idx - 40, idx + 160));
  idx += 13;
}
