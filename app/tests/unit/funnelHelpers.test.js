import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Facade import (must always work)
import {
  emptyFunnel as emptyFunnelFromDataService,
  formatCurrency as formatCurrencyFromDataService,
} from '../../src/dataService.js';

// 2. Direct module import (target of extraction)
import {
  emptyFunnel,
  formatCurrency,
} from '../../src/services/funnel/funnelHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('emptyFunnel: returns exact 5 canonical stages with zeroed counts, values, and conversions', () => {
  const stages = emptyFunnel();
  assert.equal(Array.isArray(stages), true);
  assert.equal(stages.length, 5);

  assert.deepEqual(stages, [
    { id: 'lead', name: 'Lead recebido', count: 0, value: 0, conversion: 0 },
    { id: 'diagnostico', name: 'Diagnóstico', count: 0, value: 0, conversion: 0 },
    { id: 'proposta', name: 'Proposta', count: 0, value: 0, conversion: 0 },
    { id: 'negociacao', name: 'Negociação', count: 0, value: 0, conversion: 0 },
    { id: 'fechado', name: 'Cliente fechado', count: 0, value: 0, conversion: 0 },
  ]);
});

test('emptyFunnel: returns fresh independent instances on each call without shared state', () => {
  const first = emptyFunnel();
  const second = emptyFunnel();

  assert.notEqual(first, second, 'emptyFunnel deve retornar novo array a cada invocação');
  assert.notEqual(first[0], second[0], 'Objetos internos do funil devem ser instâncias novas');

  // Mutating first must not affect second
  first[0].count = 99;
  first[0].value = 50000;
  assert.equal(second[0].count, 0);
  assert.equal(second[0].value, 0);
});

test('formatCurrency: formats zero, integers, thousands, and negative amounts in BRL without cents', () => {
  // Uses non-breaking space (\u00a0) per pt-BR Intl standard
  assert.equal(formatCurrency(0), 'R$\u00a00');
  assert.equal(formatCurrency(100), 'R$\u00a0100');
  assert.equal(formatCurrency(1000), 'R$\u00a01.000');
  assert.equal(formatCurrency(250000), 'R$\u00a0250.000');
  assert.equal(formatCurrency(-500), '-R$\u00a0500');
});

test('formatCurrency: rounds fractional amounts according to maximumFractionDigits = 0', () => {
  assert.equal(formatCurrency(1234.56), 'R$\u00a01.235');
  assert.equal(formatCurrency(1234.4), 'R$\u00a01.234');
  assert.equal(formatCurrency(99.9), 'R$\u00a0100');
});

test('formatCurrency: handles falsy and invalid values safely by defaulting to R$ 0', () => {
  assert.equal(formatCurrency(null), 'R$\u00a00');
  assert.equal(formatCurrency(undefined), 'R$\u00a00');
  assert.equal(formatCurrency(''), 'R$\u00a00');
  assert.equal(formatCurrency(NaN), 'R$\u00a00');
  assert.equal(formatCurrency(false), 'R$\u00a00');
});

test('dataService facade: preserves identical contracts and behavior for emptyFunnel and formatCurrency', () => {
  assert.deepEqual(emptyFunnelFromDataService(), emptyFunnel());
  assert.equal(formatCurrencyFromDataService(1234.56), formatCurrency(1234.56));
  assert.equal(formatCurrencyFromDataService(0), formatCurrency(0));
  assert.equal(formatCurrencyFromDataService(null), formatCurrency(null));
});

test('funnelHelpers.js: is a clean pure module with zero external imports and no circular dependencies', () => {
  const modulePath = path.resolve(__dirname, '../../src/services/funnel/funnelHelpers.js');
  assert.equal(fs.existsSync(modulePath), true, 'O módulo funnelHelpers.js deve existir');

  const content = fs.readFileSync(modulePath, 'utf8');
  assert.equal(content.includes('dataService'), false, 'funnelHelpers.js jamais deve importar dataService');
  assert.equal(content.includes('import '), false, 'funnelHelpers.js é puramente autocontido e não requer imports externos');
});
