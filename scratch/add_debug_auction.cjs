const fs = require('fs');
let code = fs.readFileSync('n8n/code/whatsapp_conversation_core.generated.js', 'utf8');

const target = `const auctionOp = executeCommercialOperationSync(context, 'auction.evaluate_handoff', {`;
const debugCode = `console.log('[DEBUG] latestTurnText:', typeof latestTurnText !== 'undefined' ? latestTurnText : 'UNDEFINED');
  const auctionOp = executeCommercialOperationSync(context, 'auction.evaluate_handoff', {`;

code = code.replace(target, debugCode);

// Also after auctionOp:
const target2 = `const auctionIntent = auctionOp.handoff?.required ? auctionOp.data : null;`;
const debugCode2 = `const auctionIntent = auctionOp.handoff?.required ? auctionOp.data : null;
  console.log('[DEBUG] auctionOp:', JSON.stringify(auctionOp));
  console.log('[DEBUG] auctionIntent:', JSON.stringify(auctionIntent));`;

code = code.replace(target2, debugCode2);
fs.writeFileSync('n8n/code/whatsapp_conversation_core.generated.js', code);
