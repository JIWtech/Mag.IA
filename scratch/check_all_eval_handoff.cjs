const fs = require('fs');
const code = fs.readFileSync('n8n/code/whatsapp_conversation_core.generated.js', 'utf8');
let idx = 0;
while ((idx = code.indexOf('auction.evaluate_handoff', idx)) !== -1) {
  console.log('--- At index', idx, '---');
  console.log(code.slice(idx - 100, idx + 400));
  idx += 24;
}
