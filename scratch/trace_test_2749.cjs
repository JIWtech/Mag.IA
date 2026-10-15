const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');

// Let's run a turn with the exact test 2749 inputs
const genesisInventory = [{
  model: 'Versa SL', brand: 'Nissan', price_cents: 4999000, color: 'Prata', km: 82000, year: 2013,
  fuel: 'Flex', status: 'ANUNCIADO', observations: 'Passagem por leilao documentada na ficha'
}];

// Import the run function from test_whatsapp_sales
// Or let's see why executeCommercialOperationSync returned what it returned
const gEngine = require('../clients/wesley_automoveis/genesisCommercialEngine.cjs');
const text = 'Voces compram carro de leilao?';
console.log('Auction evaluate handoff:');
const handoff = gEngine.evaluateAuctionHandoff(text, {}, genesisInventory, null);
console.log(handoff);
