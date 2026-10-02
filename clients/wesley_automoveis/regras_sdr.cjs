'use strict';

// Modulo de dominio para o futuro adaptador Wesley. Nao conectado ao Core compartilhado.
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function scoreDeposit(priceCents, depositCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0
    || !Number.isSafeInteger(depositCents) || depositCents < 0) {
    return { status: 'needs_clarification', hot: false };
  }
  if (depositCents > priceCents) return { status: 'needs_clarification', hot: false };
  const hot = BigInt(depositCents) * 100n >= BigInt(priceCents) * 30n;
  return { status: hot ? 'hot_candidate' : 'standard_qualification', hot };
}

function purchaseEligibility({ brand, model, year, kind = 'car' }) {
  const normalizedBrand = normalize(brand);
  if (['peugeot', 'citroen'].includes(normalizedBrand)) return { status: 'rejected', reason: 'brand' };
  if (Number.isInteger(year) && year < 1995) return { status: 'rejected', reason: 'year' };
  if (!normalizedBrand || !normalize(model) || !Number.isInteger(year)) return { status: 'needs_clarification' };
  if (kind !== 'car') return { status: 'human_review', reason: 'purchase_policy_missing' };
  const preferred = /^(uno|palio|gol|corsa|celta)(?:\s|$)/.test(normalize(model));
  return { status: 'eligible_for_human_appraisal', preferred };
}

module.exports = { scoreDeposit, purchaseEligibility };
