const fs = require('fs');
const code = fs.readFileSync('n8n/code/whatsapp_conversation_core.generated.js', 'utf8');
const idx = code.indexOf('auction.evaluate_handoff');
console.log('Context of auction.evaluate_handoff:');
console.log(code.slice(idx - 150, idx + 400));
