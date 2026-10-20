import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSavings,
  maxManualMonthly,
  SAVINGS_ASSUMPTIONS,
} from '../../src/features/landing/savingsModel.js';

const base = { ...SAVINGS_ASSUMPTIONS, noriaMonthlyCost: null };

test('custo manual considera pessoas, salário e multiplicador de encargos', () => {
  const result = computeSavings({ attendants: 2, salary: 2400 }, base);
  assert.equal(result.costPerAttendant, 4200);
  assert.equal(result.manualMonthly, 8400);
  assert.equal(result.manualYearly, 100800);
});

test('sem custo da NORIA configurado, economia é a parcela automatizável e é sinalizada', () => {
  const result = computeSavings({ attendants: 2, salary: 2400 }, base);
  assert.equal(result.includesNoriaCost, false);
  assert.equal(result.savingsMonthly, 5040);
  assert.equal(result.savingsYearly, 60480);
  assert.equal(result.withNoriaMonthly, 3360);
});

test('custo configurado da NORIA é descontado da economia e nunca fica negativo', () => {
  const withCost = computeSavings({ attendants: 2, salary: 2400 }, { ...base, noriaMonthlyCost: 1000 });
  assert.equal(withCost.includesNoriaCost, true);
  assert.equal(withCost.savingsMonthly, 4040);

  const tooExpensive = computeSavings({ attendants: 1, salary: 1500 }, { ...base, noriaMonthlyCost: 99999 });
  assert.equal(tooExpensive.savingsMonthly, 0);
});

test('entradas fora dos limites dos sliders são ajustadas aos limites', () => {
  const result = computeSavings({ attendants: 40, salary: 100 }, base);
  assert.equal(result.attendants, 12);
  assert.equal(result.salary, 1500);
  assert.ok(result.manualMonthly <= maxManualMonthly(base));
});
