const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  n8nBaseUrl: import.meta.env.VITE_N8N_BASE_URL || 'http://localhost:5678',
  tenantSlug: import.meta.env.VITE_TENANT_SLUG || 'jiw',
};

export function getIntegrationStatus(activeTenantSlug = env.tenantSlug) {
  return {
    supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
    n8n: Boolean(env.n8nBaseUrl),
    tenantSlug: activeTenantSlug,
    mode: env.supabaseUrl ? 'integravel' : 'mock',
  };
}

export async function sendN8nCommand(command, payload, activeTenantSlug = env.tenantSlug) {
  const url = `${env.n8nBaseUrl.replace(/\/$/, '')}/webhook/magia-command`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_slug: activeTenantSlug,
      command,
      payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`n8n command failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (data?.ok === false) {
    throw new Error(data.error || 'n8n command failed');
  }

  return data;
}

export const integrationTargets = [
  {
    area: 'Conversas',
    table: 'conversations, messages, conversation_events',
    webhook: 'webhook/telegram?tenant_slug={tenant_slug}',
    status: 'ativo_telegram',
  },
  {
    area: 'Kanban',
    table: 'kanban_boards, kanban_columns, kanban_cards',
    webhook: 'n8n rules mock',
    status: 'mockado',
  },
  {
    area: 'Funil',
    table: 'funnels, funnel_stages, opportunities',
    webhook: 'n8n rules mock',
    status: 'mockado',
  },
  {
    area: 'Automacoes',
    table: 'automation_rules, automation_executions',
    webhook: 'Telegram Multi-tenant + Command Router',
    status: 'ativo_parcial',
  },
  {
    area: 'IA',
    table: 'ai_agents, ai_prompt_versions, knowledge_bases',
    webhook: 'Gemini por tenant via n8n',
    status: 'ativo_com_quota',
  },
];
