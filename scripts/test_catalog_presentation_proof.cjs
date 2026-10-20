const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(__dirname, '../app/node_modules/typescript'));

const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8');
const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const wanted = new Set(['normalizeText', 'salesSemanticProductEligibility', 'salesCatalogPresentedItems', 'salesCatalogPresentationProof']);
const functions = ast.statements
  .filter(node => ts.isFunctionDeclaration(node) && wanted.has(node.name?.text))
  .map(node => node.getText(ast))
  .join('\n');
const context = {};
vm.createContext(context);
vm.runInContext(functions, context);

const inventory = [
  { id: 'tornado', brand: 'Honda', model: 'Tornado 300L', year: 2025, status: 'announced', offerable: true },
  { id: 'pcx', brand: 'Honda', model: 'PCX', year: 2023, status: 'announced', offerable: true },
  { id: 'crosser', brand: 'Yamaha', model: 'Crosser', year: 2023, status: 'announced', offerable: true },
  { id: 'cb', brand: 'Honda', model: 'CB 600RR', year: 2007, status: 'announced', offerable: true },
  { id: 'sold', brand: 'Honda', model: 'Tornado 300L', year: 2022, status: 'sold', offerable: false },
  { id: 'unverified', brand: 'Honda', model: 'PCX', year: 2018, status: 'unverified', offerable: false },
];
const ids = reply => Array.from(context.salesCatalogPresentedItems(reply, inventory), item => item.id);

test('modelo apresentado com ou sem marca e com ano resolve o ID autorizado', () => {
  assert.deepEqual(ids('Honda Tornado 300L 2025'), ['tornado']);
  assert.deepEqual(ids('Tornado 300L 2025'), ['tornado']);
});

test('listas completas, parciais e reordenadas registram somente o que foi enviado', () => {
  assert.deepEqual(ids('CB 600RR 2007, Tornado 300L 2025, PCX 2023 e Crosser 2023'), ['cb', 'tornado', 'pcx', 'crosser']);
  assert.deepEqual(ids('PCX 2023 e Tornado 300L 2025'), ['pcx', 'tornado']);
  assert.equal(context.salesCatalogPresentationProof('PCX 2023 e Tornado 300L 2025', inventory.slice(0, 4)), false);
});

test('vendidos e não verificados nunca entram na prova de apresentação', () => {
  assert.deepEqual(ids('Tornado 300L 2022 e PCX 2018'), []);
});

test('variantes e anos semelhantes não associam o SKU errado', () => {
  const variants = [
    { id: 'pcx-base', model: 'PCX', year: 2023, status: 'announced', offerable: true },
    { id: 'pcx-sport', model: 'PCX Sport', year: 2024, status: 'announced', offerable: true },
    { id: 'crosser-2023', model: 'Crosser', year: 2023, status: 'announced', offerable: true },
    { id: 'crosser-2024', model: 'Crosser', year: 2024, status: 'announced', offerable: true },
  ];
  assert.deepEqual(Array.from(context.salesCatalogPresentedItems('PCX Sport 2024', variants), item => item.id), ['pcx-sport']);
  assert.deepEqual(Array.from(context.salesCatalogPresentedItems('Crosser 2024', variants), item => item.id), ['crosser-2024']);
});

test('catálogos com uma, quatro e muitas opções preservam ordem e unicidade', () => {
  assert.deepEqual(Array.from(context.salesCatalogPresentedItems('Tornado 300L', inventory.slice(0, 1)), item => item.id), ['tornado']);
  assert.equal(context.salesCatalogPresentedItems('Tornado 300L, PCX, Crosser e CB 600RR', inventory.slice(0, 4)).length, 4);
  const many = Array.from({ length: 12 }, (_, index) => ({ id: 'id-' + index, model: 'Modelo ' + index, year: 2020 + index, status: 'announced', offerable: true }));
  const reply = [...many].reverse().map(item => item.model + ' ' + item.year).join(', ');
  assert.deepEqual(Array.from(context.salesCatalogPresentedItems(reply, many), item => item.id), many.map(item => item.id).reverse());
});
