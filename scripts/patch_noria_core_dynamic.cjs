const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));

// 1. Atualizar nó "CORE - Resolver extensão do tenant"
const resolverNode = workflow.nodes.find(n => n.name === 'CORE - Resolver extensão do tenant');
if (!resolverNode) throw new Error('Nó "CORE - Resolver extensão do tenant" não encontrado');

resolverNode.parameters.jsCode = `// Resolucao de extensao hibrida: Tenants legados usam subworkflows isolados; novos tenants SaaS usam policy dinamica de tenant_settings.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
const tenant_slug = required(v.tenant_slug, 'tenant_slug');
const tenant_id = required(v.tenant_id, 'tenant_id');
required(v.instance, 'instance');
required(v.remoteJid, 'remoteJid');

const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
const legacyExtension = byTenant[tenant_slug];
if (legacyExtension) {
  return { json: { ...v, noria_extension: legacyExtension, noria_contract_version: '1.0', noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap' } };
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
`;

// 2. Atualizar nó "CORE - Bloquear destino não configurado" para agir como gateway dinâmico SaaS
const blockerNode = workflow.nodes.find(n => n.name === 'CORE - Bloquear destino não configurado');
if (!blockerNode) throw new Error('Nó "CORE - Bloquear destino não configurado" não encontrado');

blockerNode.name = 'CORE - Roteador Dinâmico SaaS';
blockerNode.parameters.jsCode = `// Roteador dinâmico: Se o tenant possui noria_client_policy configurada, avança direto para o motor conversacional compartilhado.
const v = $json || {};
if (v.noria_client_policy && v.noria_extension === 'saas_dynamic') {
  return { json: v };
}
throw new Error('NORIA_CORE: extensao nao habilitada para ' + String(v.tenant_slug || 'desconhecido'));
`;

// 3. Preserve the existing tenant graph and only replace edges to the old fallback.
for (const connection of Object.values(workflow.connections)) {
  for (const outputs of Object.values(connection)) for (const edges of outputs) {
    for (const edge of edges) if (edge.node === 'CORE - Bloquear destino não configurado') edge.node = blockerNode.name;
  }
}
delete workflow.connections['CORE - Bloquear destino não configurado'];

// 4. Conectar "CORE - Roteador Dinâmico SaaS" diretamente para "CORE | Motor conversacional único"
workflow.connections['CORE - Roteador Dinâmico SaaS'] = {
  main: [
    [
      {
        node: 'CORE | Motor conversacional único',
        type: 'main',
        index: 0,
      },
    ],
  ],
};

// 5. Salvar arquivo
fs.writeFileSync(file, JSON.stringify(workflow, null, 2) + '\n');
console.log('Successfully patched NORIA CORE with dynamic SaaS multi-tenant router!');
