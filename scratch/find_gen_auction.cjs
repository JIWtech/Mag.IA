const fs = require('fs');
const code = fs.readFileSync('n8n/code/whatsapp_conversation_core.generated.js', 'utf8');

let idx = 0;
while ((idx = code.indexOf('auctionIntent', idx)) !== -1) {
  console.log('--- auctionIntent at index', idx, '---');
  console.log(code.slice(idx - 60, idx + 150));
  idx += 13;
}
