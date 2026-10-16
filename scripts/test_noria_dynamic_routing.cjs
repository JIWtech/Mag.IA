const test = require('node:test');
const assert = require('node:assert/strict');

function routeTenant(input, mockDbSettings) {
  const v = { ...input };
  function required(x, label) {
    if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: ' + label + ' ausente');
    return x.trim();
  }
  const tenant_slug = required(v.tenant_slug, 'tenant_slug');
  const tenant_id = required(v.tenant_id, 'tenant_id');
  required(v.instance, 'instance');
  required(v.remoteJid, 'remoteJid');

  const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
  const legacyExtension = byTenant[tenant_slug];
  if (legacyExtension) {
    return { ...v, noria_extension: legacyExtension, noria_contract_version: '1.0', noria_router: 'core_3wf_v1' };
  }

  const s = mockDbSettings[tenant_id] || {};
  if (!s.noria_client_policy) {
    throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
  }

  return {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  };
}

function evaluateBranches(routed) {
  if (routed.noria_extension === 'nubia') {
    return { branch: 'subworkflow_nubia', policy: 'from_subworkflow' };
  }
  if (routed.noria_extension === 'genesis') {
    return { branch: 'subworkflow_genesis', policy: 'from_subworkflow' };
  }
  if (routed.noria_extension === 'saas_dynamic' && routed.noria_client_policy) {
    return { branch: 'dynamic_direct_to_core', policy: routed.noria_client_policy };
  }
  throw new Error('NORIA_CORE: extensao nao habilitada para ' + String(routed.tenant_slug || 'desconhecido'));
}

test('Legacy tenant wesley_automoveis routes to genesis subworkflow', () => {
  const input = {
    tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
    tenant_slug: 'wesley_automoveis',
    instance: 'wesley_bot',
    remoteJid: '5511999999999@s.whatsapp.net',
  };
  const routed = routeTenant(input, {});
  assert.equal(routed.noria_extension, 'genesis');
  const result = evaluateBranches(routed);
  assert.equal(result.branch, 'subworkflow_genesis');
});

test('Legacy tenant clinica_nubia_oficial routes to nubia subworkflow', () => {
  const input = {
    tenant_id: '563a93cd-a5c1-4412-a65f-be2e2d41bb88',
    tenant_slug: 'clinica_nubia_oficial',
    instance: 'nubia_bot',
    remoteJid: '5511988888888@s.whatsapp.net',
  };
  const routed = routeTenant(input, {});
  assert.equal(routed.noria_extension, 'nubia');
  const result = evaluateBranches(routed);
  assert.equal(result.branch, 'subworkflow_nubia');
});

test('New SaaS tenant routes dynamically direct to core engine using DB policy', () => {
  const newTenantId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const input = {
    tenant_id: newTenantId,
    tenant_slug: 'autoshow_motors',
    instance: 'autoshow_instance',
    remoteJid: '5511977777777@s.whatsapp.net',
  };
  const mockSettings = {
    [newTenantId]: {
      noria_client_policy: {
        contract: 'noria_policy_v2',
        tenant_id: newTenantId,
        tenant_slug: 'autoshow_motors',
        profile: 'vehicle_sales_v1',
        capability: 'sales_v1',
      },
    },
  };
  const routed = routeTenant(input, mockSettings);
  assert.equal(routed.noria_extension, 'saas_dynamic');
  assert.equal(routed.noria_router, 'saas_dynamic_v1');
  const result = evaluateBranches(routed);
  assert.equal(result.branch, 'dynamic_direct_to_core');
  assert.equal(result.policy.profile, 'vehicle_sales_v1');
});

test('Unknown tenant without policy fails closed', () => {
  const input = {
    tenant_id: 'unknown-id',
    tenant_slug: 'empresa_fantasma',
    instance: 'bot',
    remoteJid: '5511966666666@s.whatsapp.net',
  };
  assert.throws(() => routeTenant(input, {}), /NORIA_SEM_EXTENSAO_CONFIGURADA/);
});
