import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Facade import (must always work)
import {
  TENANT_SCHEDULING_LINKS as TENANT_SCHEDULING_LINKS_FACADE,
  getTenantSchedulingLink as getTenantSchedulingLinkFacade,
} from '../../src/dataService.js';

// 2. Direct module import (target of extraction)
import {
  TENANT_SCHEDULING_LINKS,
  getTenantSchedulingLink,
} from '../../src/services/appointments/schedulingLinks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('TENANT_SCHEDULING_LINKS: maps clinica_nubia to official agenda URL and contains no unmapped tenants', () => {
  assert.equal(typeof TENANT_SCHEDULING_LINKS, 'object');
  assert.notEqual(TENANT_SCHEDULING_LINKS, null);

  assert.deepEqual(TENANT_SCHEDULING_LINKS, {
    clinica_nubia: 'https://nbbronze.tuaagenda.app/',
  });

  // Explicit check for other tenants
  assert.equal(TENANT_SCHEDULING_LINKS.wesley_automoveis, undefined);
  assert.equal(TENANT_SCHEDULING_LINKS.clinica_nubia_oficial, undefined);
});

test('getTenantSchedulingLink: resolves valid link only for clinica_nubia (multi-tenant isolation)', () => {
  assert.equal(getTenantSchedulingLink('clinica_nubia'), 'https://nbbronze.tuaagenda.app/');

  // wesley_automoveis is a car dealership without healthcare agenda link
  assert.equal(getTenantSchedulingLink('wesley_automoveis'), '');

  // clinica_nubia_oficial has no direct entry
  assert.equal(getTenantSchedulingLink('clinica_nubia_oficial'), '');

  // Unknown tenants return empty string
  assert.equal(getTenantSchedulingLink('empresa_desconhecida'), '');
});

test('getTenantSchedulingLink: handles falsy, null, undefined and invalid inputs safely', () => {
  assert.equal(getTenantSchedulingLink(''), '');
  assert.equal(getTenantSchedulingLink(null), '');
  assert.equal(getTenantSchedulingLink(undefined), '');
  assert.equal(getTenantSchedulingLink(123), '');
  assert.equal(getTenantSchedulingLink(false), '');
});

test('dataService facade: preserves identical exports and behavior for scheduling links', () => {
  assert.deepEqual(TENANT_SCHEDULING_LINKS_FACADE, TENANT_SCHEDULING_LINKS);
  assert.equal(getTenantSchedulingLinkFacade('clinica_nubia'), getTenantSchedulingLink('clinica_nubia'));
  assert.equal(getTenantSchedulingLinkFacade('wesley_automoveis'), getTenantSchedulingLink('wesley_automoveis'));
  assert.equal(getTenantSchedulingLinkFacade('clinica_nubia_oficial'), getTenantSchedulingLink('clinica_nubia_oficial'));
  assert.equal(getTenantSchedulingLinkFacade(''), getTenantSchedulingLink(''));
  assert.equal(getTenantSchedulingLinkFacade(null), getTenantSchedulingLink(null));
});

test('schedulingLinks.js: is a clean pure module with zero external imports and no circular dependencies', () => {
  const modulePath = path.resolve(__dirname, '../../src/services/appointments/schedulingLinks.js');
  assert.equal(fs.existsSync(modulePath), true, 'O módulo schedulingLinks.js deve existir');

  const content = fs.readFileSync(modulePath, 'utf8');
  assert.equal(content.includes('dataService'), false, 'schedulingLinks.js jamais deve importar dataService');
  assert.equal(content.includes('import '), false, 'schedulingLinks.js é puramente autocontido e não requer imports externos');
});
