export function createTeamAgentManagement({ getClient }) {
async function saveTeamAgent(tenantSlug, agent) {
  const storageKey = `magia:team-agents:${tenantSlug}`;
  const newRecord = {
    tenant_slug: tenantSlug,
    name: agent.name?.trim(),
    role: agent.role?.trim() || null,
    branch: agent.branch?.trim() ? agent.branch.trim() : null,
    shift: agent.shift?.trim() ? agent.shift.trim() : null,
    status: agent.status || 'online',
    is_active: true,
  };
  try {
    const supabase = getClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_agents')
        .insert([newRecord])
        .select()
        .single();
      if (!error && data) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Falha ao salvar team_agent no Supabase:', e);
  }
  const localAgent = { id: `local-${Date.now()}`, ...newRecord, created_at: new Date().toISOString() };
  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
    localStorage.setItem(storageKey, JSON.stringify([localAgent, ...current]));
  } catch (e) { }
  return localAgent;
}

async function updateTeamAgentStatus(agentId, newStatus, tenantSlug) {
  try {
    const supabase = getClient();
    if (supabase && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', agentId)
        .eq('tenant_slug', tenantSlug);
    }
  } catch (e) {
    console.warn('Falha ao atualizar status do team_agent no Supabase:', e);
  }
  if (tenantSlug) {
    const storageKey = `magia:team-agents:${tenantSlug}`;
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = current.map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag);
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch (e) { }
  }
}

async function removeTeamAgent(agentId, tenantSlug) {
  try {
    const supabase = getClient();
    if (supabase && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .delete()
        .eq('id', agentId)
        .eq('tenant_slug', tenantSlug);
    }
  } catch (e) {
    console.warn('Falha ao remover team_agent do Supabase:', e);
  }
  if (tenantSlug) {
    const storageKey = `magia:team-agents:${tenantSlug}`;
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = current.filter((ag) => ag.id !== agentId);
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch (e) { }
  }
}
return { saveTeamAgent, updateTeamAgentStatus, removeTeamAgent };
}
