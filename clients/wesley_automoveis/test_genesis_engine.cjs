'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const engine = require('./genesisCommercialEngine.cjs');

const sampleSheetValues = [
  ['MODELO', 'MARCA', 'PRECO', 'COR', 'KM', 'ANO', 'COMBUSTIVEL', 'STATUS', 'OBSERVAÇÕES'],
  ['TORNADO 300L', 'HONDA', '28.980', 'VERMELHO', '4500', 2015, 'FLEX', 'ANUNCIADO', ''],
  ['PCX', 'HONDA', '18.980', 'BRANCA', '12.500', 2023, 'FLEX', 'ANUNCIADO', ''],
  ['CROSSER', 'YAMAHA', '14.980', 'PRETO', '70000', 2021, 'FLEX', 'VENDIDO', ''],
  ['PCX', 'HONDA', '13.980', 'PRATA', '40000', 2018, 'FLEX', 'RESERVADO', ''],
  ['SANDERO GT LINE', 'RENAULT', '42.980', 'BRANCO', '138600', 2016, 'FLEX GNV', 'ANUNCIADO', 'Passagem por leilao financeiro'],
  ['CB 600RR', 'HONDA', '34.980,00', 'VERMELHO', '28000', 2007, 'GASOLINA', 'ANUNCIADO', ''],
  ['CROSSER', 'YAMAHA', '17.980,00', 'AZUL', '15000', 2023, 'FLEX', 'DISPONIVEL', ''],
  ['VERSA SL', 'NISSAN', '32.980', 'PRATA', '131300', 2013, 'FLEX GNV', 'INDISPONIVEL', ''],
];

test('6.3 Brazilian currency parser handles all mandated formats', () => {
  assert.equal(engine.parsePrice('R$ 34.980,00'), 34980);
  assert.equal(engine.parsePrice('R$ 45 mil'), 45000);
  assert.equal(engine.parsePrice('45k'), 45000);
  assert.equal(engine.parsePrice('17.980'), 17980);
  assert.equal(engine.parsePrice('R$ 17.980,00'), 17980);
  assert.equal(engine.parsePrice('34980'), 34980);

  const parsed1 = engine.parseBrazilianCurrency('Quero dar R$ 3 mil de entrada e R$ 1.200 de parcela');
  assert.equal(parsed1.deposit, 3000);
  assert.equal(parsed1.deposit_cents, 300000);
  assert.equal(parsed1.installment, 1200);
  assert.equal(parsed1.installment_cents, 120000);

  const parsed2 = engine.parseBrazilianCurrency('O carro está anunciado por R$ 34.980,00');
  assert.equal(parsed2.total_price, 34980);
  assert.equal(parsed2.total_price_cents, 3498000);
});

test('6.4 Commercial display names are clean and never expose technical keys', () => {
  const name = engine.formatCommercialName('Honda', 'CB 600RR', 2007);
  assert.equal(name, 'Honda CB 600RR 2007');
  assert.ok(!name.includes('|'), 'Must not contain pipe character');
});

test('6.1 Sheet parsing separates offerable from historical inventory', () => {
  const inventory = engine.parseSheetValues(sampleSheetValues);
  assert.equal(inventory.length, 8);

  const cb = inventory.find(i => i.model === 'CB 600RR');
  assert.ok(cb, 'CB 600RR should exist in inventory');
  assert.equal(cb.commercial_name, 'Honda CB 600RR 2007');
  assert.equal(cb.price_cents, 3498000);
  assert.equal(cb.status, 'announced');
  assert.equal(cb.offerable, true);
  assert.equal(cb.availability_verified, false);

  const crosser2021 = inventory.find(i => i.model === 'CROSSER' && i.year === 2021);
  assert.ok(crosser2021);
  assert.equal(crosser2021.status, 'sold');
  assert.equal(crosser2021.offerable, false);

  const offerable = engine.filterOfferableCatalog(inventory, 'all');
  assert.equal(offerable.length, 5, 'Only 5 vehicles should be offerable (ANUNCIADO or DISPONIVEL)');
  assert.ok(!offerable.some(v => v.year === 2021 && v.model === 'CROSSER'), 'Sold 2021 Crosser must not be offerable');
  assert.ok(offerable.some(v => v.year === 2023 && v.model === 'CROSSER'), 'Available 2023 Crosser must be offerable');
});

test('6.2 Bug fix: Motorcycle and car filter only uses offerable items', () => {
  const inventory = engine.parseSheetValues(sampleSheetValues);
  const motos = engine.filterOfferableCatalog(inventory, 'motorcycles');
  const carros = engine.filterOfferableCatalog(inventory, 'cars');

  assert.ok(motos.every(m => m.offerable), 'Every moto must be offerable');
  assert.ok(carros.every(c => c.offerable), 'Every car must be offerable');
  assert.ok(!motos.some(m => m.status === 'sold' || m.status === 'reserved'));
  assert.ok(motos.some(m => m.model === 'CB 600RR'));
  assert.ok(carros.some(c => c.model === 'SANDERO GT LINE'));
});

test('Supabase snapshot maps the real status/category contract without offering history', () => {
  const rows = [
    ['tornado-2025','Honda','Tornado 300L',2025,'motorcycle','announced',2898000],['pcx-2023','Honda','PCX',2023,'motorcycle','announced',1749900],['crosser-2023','Yamaha','Crosser',2023,'motorcycle','announced',1798000],['cb-600rr','Honda','CB 600RR',2007,'motorcycle','announced',3498000],
    ['versa-2013','Nissan','Versa SL',2013,'car','announced',2798000],['c180-2015','Mercedes','C180',2015,'car','announced',9498000],['prado-2005','Toyota','Land Prado',2005,'car','announced',8998000],['crosser-2021','Yamaha','Crosser',2021,'motorcycle','sold',1498000],['sandero-2016','Renault','Sandero GT Line',2016,'car','sold',4298000],['pcx-2018','Honda','PCX',2018,'motorcycle','unverified',1398000],
  ].map(([vehicle_id,brand,model,model_year,category,status,price_cents], sheet_row) => ({vehicle_id,brand,model,model_year,category,status,price_cents,sheet_row,availability_confirmed:false}));
  const inventory = engine.parseSupabaseInventoryRows(rows);
  assert.equal(inventory.length, 10);
  assert.equal(engine.filterOfferableCatalog(inventory, 'all').length, 7);
  assert.equal(engine.filterOfferableCatalog(inventory, 'motorcycles').length, 4);
  assert.equal(engine.filterOfferableCatalog(inventory, 'cars').length, 3);
  assert.equal(inventory.find(item => item.id === 'cb-600rr').price_cents, 3498000);
  assert.ok(!engine.filterOfferableCatalog(inventory, 'all').some(item => ['crosser-2021','pcx-2018'].includes(item.id)));
});

test('7. Caso Jeferson: item 6 in catalog resolves to Honda CB 600RR with authorized price', () => {
  const inventory = engine.parseSheetValues(sampleSheetValues);
  const offerable = engine.filterOfferableCatalog(inventory, 'all');
  // Suppose catalog list presented to customer:
  // 1. Tornado, 2. PCX, 3. Sandero, 4. CB 600RR, 5. Crosser 2023
  // Or with 6 items:
  const catalogContext = {
    products: [
      inventory[0], // Tornado
      inventory[1], // PCX 2023
      inventory[3], // PCX 2018 (or Sandero)
      inventory[4], // Sandero
      inventory[6], // Crosser 2023
      inventory[5], // CB 600RR (position 6)
    ]
  };

  // Customer replies "6"
  const res = engine.resolveSelection('6', inventory, catalogContext);
  assert.equal(res.invalid, false);
  assert.equal(res.ambiguous, false);
  assert.ok(res.product);
  assert.equal(res.product.model, 'CB 600RR');
  assert.equal(res.product.year, 2007);
  assert.equal(res.product.price_cents, 3498000);
  assert.equal(res.product.status, 'announced');
  assert.equal(res.product.availability_verified, false);

  // Textual variants:
  const resText1 = engine.resolveSelection('essa sexta', inventory, catalogContext);
  assert.equal(resText1.product?.model, 'CB 600RR');

  const resText2 = engine.resolveSelection('a CB', inventory, catalogContext);
  assert.equal(resText2.product?.model, 'CB 600RR');

  const resText3 = engine.resolveSelection('essa moto', inventory, { products: [inventory[5]] });
  assert.equal(resText3.product?.model, 'CB 600RR');
});

test('8. Auction domain rules distinguish customer sale vs history vs rejection vs sinistro', () => {
  const inventory = engine.parseSheetValues(sampleSheetValues);
  const sandero = inventory.find(i => i.model === 'SANDERO GT LINE');

  // Customer selling auction car -> HANDOFF REQUIRED
  const h1 = engine.evaluateAuctionHandoff('Vocês compram carro de leilão? Tenho um para vender.', {}, inventory);
  assert.equal(h1.required, true);
  assert.equal(h1.reason, 'auction_vehicle_purchase');
  assert.ok(h1.message.includes('Gênesis compra'));

  // Customer asking about dealer's vehicle documented history -> HANDOFF to confirm details
  const h2 = engine.evaluateAuctionHandoff('O Sandero tem passagem por leilão?', {}, inventory, sandero);
  assert.equal(h2.required, true);
  assert.equal(h2.classification.intent, 'inventory_history');
  assert.equal(h2.classification.inventory_history.documented, true);
  assert.match(h2.message, /consta histórico de leilão/i);

  // Customer rejects auction vehicle -> NO HANDOFF
  const h3 = engine.evaluateAuctionHandoff('Não quero carro de leilão', {}, inventory, sandero);
  assert.equal(h3.required, false);
  assert.equal(h3.classification.intent, 'rejection');

  // Customer mentions sinistro without auction -> NO HANDOFF
  const h4 = engine.evaluateAuctionHandoff('Esse carro teve algum sinistro?', {}, inventory, sandero);
  assert.equal(h4.required, false);
  assert.equal(h4.classification.intent, 'sinistro_inquiry');
});

test('3. noria_business_operation_v1 contract dispatch', async () => {
  const inventory = engine.parseSheetValues(sampleSheetValues);

  // Cross tenant rejected
  const cross = await engine.executeBusinessOperation('inventory.list', {
    tenant_slug: 'clinica_nubia_oficial',
    contract: 'noria_business_operation_v1'
  });
  assert.equal(cross.status, 'error');
  assert.equal(cross.error, 'CROSS_TENANT_OPERATION_DISALLOWED');

  // inventory.lookup
  const lookup = await engine.executeBusinessOperation('inventory.lookup', {
    tenant_slug: 'wesley_automoveis',
    query: 'CB 600RR',
    inventory,
  });
  assert.equal(lookup.status, 'ok');
  assert.equal(lookup.data.model, 'CB 600RR');
  assert.equal(lookup.data.year, 2007);
  assert.equal(lookup.data.price, 34980);
  assert.equal(lookup.data.currency, 'BRL');

  // auction.evaluate_handoff
  const auction = await engine.executeBusinessOperation('auction.evaluate_handoff', {
    tenant_slug: 'wesley_automoveis',
    text: 'Quero vender meu carro que é de leilão',
    inventory,
  });
  assert.equal(auction.handoff.required, true);
  assert.equal(auction.handoff.reason, 'auction_vehicle_purchase');
});

test('semantic catalog executor enforces authorised price bounds and never guesses subjective preferences', async () => {
  const rows = [
    { id:'car-low', category:'car', model:'Uno', brand:'Fiat', status:'listed', offerable:true, price_cents:4400000 },
    { id:'car-high', category:'car', model:'Civic', brand:'Honda', status:'listed', offerable:true, price_cents:4900000 },
  ];
  const bounded = engine.filterCatalogBySemantic(rows, { category:'cars', price_min_cents:null, price_max_cents:4500000, preferences:[], exclusions:[] });
  assert.deepEqual(bounded.items.map(item=>item.id), ['car-low']);
  const subjective = engine.filterCatalogBySemantic(rows, { category:'cars', price_min_cents:null, price_max_cents:4500000, preferences:['confortável para família'], exclusions:[] });
  assert.equal(subjective.requires_clarification, true);
  assert.deepEqual(subjective.unsupported, ['confortável para família']);
  assert.deepEqual(subjective.items.map(item=>item.id), ['car-low']);
});

test('P1 selection separates historical identification from commercial eligibility', () => {
  const sold={id:'sold-1',category:'motorcycle',model:'Crosser',brand:'Yamaha',year:2021,status:'sold',offerable:false,availability_verified:false,price_cents:1498000};
  const announced={id:'announced-1',category:'car',model:'C180',brand:'Mercedes',year:2015,status:'announced',offerable:true,availability_verified:false,price_cents:9498000};
  const listed={id:'listed-1',category:'car',model:'Uno',brand:'Fiat',year:2019,status:'listed',offerable:true,availability_verified:true,price_cents:3500000};
  const inventory=[sold,announced,listed];

  const historical=engine.resolveSelection('1',inventory,{products:[{id:'sold-1'}]});
  assert.equal(historical.product.id,'sold-1');
  assert.equal(historical.commercial_eligible,false);
  assert.equal(historical.ineligible_reason,'sold');

  const advertised=engine.resolveSelection('1',inventory,{products:[{id:'announced-1'}]});
  assert.equal(advertised.commercial_eligible,true);
  assert.equal(advertised.availability_confirmed,false);

  const available=engine.resolveSelection('1',inventory,{products:[{id:'listed-1'}]});
  assert.equal(available.commercial_eligible,true);
  assert.equal(available.availability_confirmed,true);
});

test('P1 selection refreshes a displayed product against current inventory status', () => {
  const stale={id:'vehicle-1',category:'car',model:'Ka',brand:'Ford',year:2020,status:'listed',offerable:true,availability_verified:true,price_cents:4200000};
  const soldNow={...stale,status:'sold',offerable:false,availability_verified:false};
  const result=engine.resolveSelection('1',[soldNow],{products:[stale]});
  assert.equal(result.product.status,'sold');
  assert.equal(result.commercial_eligible,false);
  assert.equal(result.ineligible_reason,'sold');
});
