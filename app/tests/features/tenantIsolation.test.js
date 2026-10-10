import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadClientData } from '../../src/dataService.js';
import { getInitialTenantSlug } from '../../src/services/tenants/tenantStorage.js';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('tenant selection has no implicit default when no trusted selection exists', () => {
  assert.equal(getInitialTenantSlug(), null);
});

test('Kanban requires an explicit tenant slug instead of the legacy Nubia fallback', () => {
  const source = read('src/features/kanban/components/Kanban.jsx');
  assert.doesNotMatch(source, /tenantSlug\s*=\s*['"]clinica_nubia['"]/);
  assert.match(source, /tenantSlug,/);
});

test('App never replaces an unauthorized requested tenant with another tenant', () => {
  const source = read('src/app/App.jsx');
  assert.doesNotMatch(source, /if\s*\(!exists\s*&&\s*tenantsFromDb\[0\]\)\s*\{[\s\S]{0,200}setTenantSlug\(tenantsFromDb\[0\]\.slug\)/);
});

test('tenant-scoped realtime and data reads require an explicit tenant slug', () => {
  const source = read('src/dataService.js');
  assert.doesNotMatch(source, /subscribeToClientEvents\(onChange,\s*activeTenantSlug\s*=\s*defaultTenantSlug\)/);
  assert.doesNotMatch(source, /loadClientData\(fallback,\s*activeTenantSlug\s*=\s*defaultTenantSlug/);
  return assert.rejects(loadClientData({}, null), /Selecione uma empresa autorizada/);
});
