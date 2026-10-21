// NORIA CORE — resolução de extensão do tenant (fonte canônica do nó "CORE - Resolver extensão do tenant").
// Tenants legados usam subworkflows isolados, sem leitura de banco; novos tenants SaaS usam a policy dinâmica de tenant_settings.
// O roteador com seleção de pipeline da Núbia v2 fica em noria_router.js e só volta ao CORE junto com a cadeia de serviços.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
const tenant_slug = required(v.tenant_slug, 'tenant_slug');
const tenant_id = required(v.tenant_id, 'tenant_id');
required(v.instance, 'instance');
required(v.remoteJid, 'remoteJid');

const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
const contractVersionByTenant = { wesley_automoveis: '2.0' };
const legacyExtension = byTenant[tenant_slug];
if (legacyExtension) {
  return { json: { ...v, noria_extension: legacyExtension, noria_contract_version: contractVersionByTenant[tenant_slug] || '1.0', noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap' } };
}

// Para novos tenants SaaS autônomos, busca noria_client_policy diretamente em tenant_settings
const base = String($env.SUPABASE_URL || '').replace(new RegExp('/$'), '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');

const rows = await this.helpers.httpRequest({
  method: 'GET',
  url: base + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(tenant_id) + '&limit=1',
  headers: { apikey: key, Authorization: 'Bearer ' + key },
  json: true,
  timeout: 7000,
});

const s = rows?.[0]?.settings || {};
if (!s.noria_client_policy) {
  throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
}

return {
  json: {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  },
};
