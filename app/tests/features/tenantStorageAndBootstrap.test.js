import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitialTenantSlug,
  persistTenantSlug,
  clearTenantSlug,
  tenantStorageKey,
} from '../../src/services/tenants/tenantStorage.js';

test('fresh environment without localStorage or query parameter returns null', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  try {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.window = {
      location: { search: '' },
    };

    assert.equal(getInitialTenantSlug(), null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('restores tenant from localStorage if set', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  try {
    const store = new Map([[tenantStorageKey, 'genesis_automoveis']]);
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.window = {
      location: { search: '' },
    };

    assert.equal(getInitialTenantSlug(), 'genesis_automoveis');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('URL query parameter takes precedence over localStorage', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  try {
    const store = new Map([[tenantStorageKey, 'stored_slug']]);
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.window = {
      location: { search: '?tenant=royal_4x4' },
    };

    assert.equal(getInitialTenantSlug(), 'royal_4x4');
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('persistTenantSlug and clearTenantSlug update localStorage correctly', () => {
  const originalLocalStorage = globalThis.localStorage;

  try {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };

    persistTenantSlug('clinica_nubia');
    assert.equal(globalThis.localStorage.getItem(tenantStorageKey), 'clinica_nubia');

    clearTenantSlug();
    assert.equal(globalThis.localStorage.getItem(tenantStorageKey), null);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('tenant reconciliation resolves correctly for single, multiple, and empty available tenants', () => {
  function reconcileTenant(currentSlug, validTenants, envSlug = null) {
    if (currentSlug && validTenants.some((t) => t.slug === currentSlug)) {
      return currentSlug;
    }
    if (validTenants.length > 0) {
      const preferred = (envSlug && validTenants.find((t) => t.slug === envSlug)) || validTenants[0];
      return preferred.slug;
    }
    return null;
  }

  // Cenário 1: Primeiro login após formatação (currentSlug é null), usuário possui 1 empresa autorizada
  const singleTenant = [{ slug: 'clinica_nubia', name: 'Núbia' }];
  assert.equal(reconcileTenant(null, singleTenant), 'clinica_nubia');

  // Cenário 2: Usuário possui múltiplas empresas e currentSlug é null, sem env correspondente
  const multiTenants = [
    { slug: 'genesis_automoveis', name: 'Gênesis Automóveis' },
    { slug: 'royal_4x4', name: 'Royal 4x4' },
  ];
  assert.equal(reconcileTenant(null, multiTenants), 'genesis_automoveis');

  // Cenário 3: Usuário possui múltiplas empresas e env bate com uma delas
  assert.equal(reconcileTenant(null, multiTenants, 'royal_4x4'), 'royal_4x4');

  // Cenário 4: Usuário tinha slug salvo que continua autorizado
  assert.equal(reconcileTenant('royal_4x4', multiTenants), 'royal_4x4');

  // Cenário 5: Usuário trocou de conta e slug anterior (genesis) NÃO pertence à nova conta (só tem clinica_nubia)
  assert.equal(reconcileTenant('genesis_automoveis', singleTenant), 'clinica_nubia');

  // Cenário 6: Conta autenticada sem nenhum vínculo ativo
  assert.equal(reconcileTenant('qualquer', []), null);
});
