const path = require('node:path');
const gEngine = require(path.resolve(__dirname, '../clients/wesley_automoveis/genesisCommercialEngine.cjs'));
const genesisInventory = [{
  model: 'Versa SL', brand: 'Nissan', price_cents: 4999000, color: 'Prata', km: 82000, year: 2013,
  fuel: 'Flex', status: 'ANUNCIADO', observations: 'Passagem por leilao documentada na ficha'
}];

const res = gEngine.evaluateAuctionHandoff('Voces compram carro de leilao?', {}, genesisInventory, null);
console.log('evaluateAuctionHandoff:', JSON.stringify(res, null, 2));
