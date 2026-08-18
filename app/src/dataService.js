import { createClient } from '@supabase/supabase-js';
import { getAuthClient } from './authService';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const defaultTenantSlug = import.meta.env.VITE_TENANT_SLUG || 'jiw';
const tenantStorageKey = 'magia:selected-tenant-slug';

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function getClient() {
  if (!hasSupabaseConfig()) return null;
  return getAuthClient() || createClient(supabaseUrl, supabaseAnonKey);
}

export function getInitialTenantSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant') || localStorage.getItem(tenantStorageKey) || defaultTenantSlug;
}

export function persistTenantSlug(slug) {
  if (!slug) return;
  localStorage.setItem(tenantStorageKey, slug);
}

export async function loadAvailableTenants(fallbackTenants = []) {
  const supabase = getClient();
  if (!supabase) return fallbackTenants;

  const { data: membershipData, error: membershipError } = await supabase
    .from('tenant_members')
    .select('role, status, tenants(id, slug, name, industry, plan, status)')
    .eq('status', 'active');

  if (!membershipError && membershipData?.length) {
    return membershipData
      .map((row) => row.tenants)
      .filter(Boolean)
      .map((tenant) => ({
        id: tenant.slug,
        slug: tenant.slug,
        name: tenant.name,
        industry: tenant.industry || 'Generalista',
        plan: tenant.plan || 'MVP',
      }));
  }

  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name, industry, plan, status')
    .in('status', ['active', 'trial', 'pilot', 'Piloto'])
    .order('name', { ascending: true });

  if (error || !data?.length) {
    if (error) console.warn('Tenants fallback:', error.message);
    return fallbackTenants;
  }

  return data.map((tenant) => ({
    id: tenant.slug,
    slug: tenant.slug,
    name: tenant.name,
    industry: tenant.industry || 'Generalista',
    plan: tenant.plan || 'MVP',
  }));
}

export function subscribeToClientEvents(onChange, activeTenantSlug = defaultTenantSlug) {
  const supabase = getClient();
  if (!supabase) return () => { };

  const channel = supabase
    .channel(`tenant-events:${activeTenantSlug}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'channel_events',
        filter: `tenant_slug=eq.${activeTenantSlug}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function loadClientData(fallback, activeTenantSlug = defaultTenantSlug) {
  const supabase = getClient();
  if (!supabase) {
    return {
      ...fallback,
      source: 'mock',
      status: buildStatus({ source: 'mock', events: [], tenantSlug: activeTenantSlug }),
    };
  }

  const { data, error } = await supabase
    .from('channel_events')
    .select('*')
    .eq('tenant_slug', activeTenantSlug)
    .order('created_at', { ascending: false })
    .limit(150);

  if (error) {
    console.warn('Supabase fallback:', error.message);
    return {
      ...fallback,
      source: 'mock_error',
      error: error.message,
      status: buildStatus({ source: 'mock_error', events: [], error: error.message, tenantSlug: activeTenantSlug }),
    };
  }

  if (!data?.length) {
    return {
      ...fallback,
      source: 'supabase_empty',
      conversations: [],
      kanbanColumns: emptyKanban(),
      funnelStages: emptyFunnel(),
      status: buildStatus({ source: 'supabase_empty', events: [], tenantSlug: activeTenantSlug }),
    };
  }

  return {
    ...fallback,
    source: 'supabase',
    conversations: eventsToConversations(data),
    kanbanColumns: eventsToKanban(data, activeTenantSlug),
    funnelStages: eventsToFunnel(data),
    status: buildStatus({ source: 'supabase', events: data, tenantSlug: activeTenantSlug }),
  };
}

function normalizeStage(stage) {
  const s = String(stage || '').toLowerCase().trim();
  if (s.includes('qualific') || s === 'qualificacao') return 'Qualificação';
  if (s.includes('agend') || s === 'agendamento') return 'Agendamento';
  if (s.includes('brief') || s.includes('briefing')) return 'Briefing necessário';
  if (s.includes('suport') || s.includes('suporte')) return 'Suporte técnico';
  if (s.includes('orc') || s.includes('orç') || s.includes('orcamento')) return 'Orçamento solicitado';
  if (s.includes('human') || s.includes('atendimento_humano') || s.includes('atendimento humano')) return 'Atendimento humano';
  if (s.includes('diagnos') || s.includes('diagnostico')) return 'Diagnóstico';
  if (s.includes('negoc') || s.includes('negociacao')) return 'Negociação';
  if (s.includes('fechad') || s.includes('fechado')) return 'Cliente fechado';
  if (s.includes('propost') || s.includes('proposta')) return 'Proposta';
  if (s.includes('fora de contexto')) return 'Fora de contexto';
  return stage || 'Qualificação';
}

function eventsToConversations(events) {
  const byChat = new Map();

  for (const event of [...events].reverse()) {
    const channelType = normalizeChannel(event.channel_type);
    const stageName = normalizeStage(event.stage);
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.contact_handle || event.id}`;
    const isHumanTransfer = Boolean(event.handoff && (normalizeStage(event.stage) === 'Atendimento humano' || event.service === 'manual_reply'));
    const defaultOwner = isHumanTransfer ? 'Recepção / Núbia' : 'Assistente IA';

    if (!byChat.has(key)) {
      byChat.set(key, {
        id: `conv-${key}`,
        externalConversationId: event.external_conversation_id || key,
        contact: event.contact_name || event.contact_handle || `Contato ${channelType.label}`,
        company: event.contact_handle ? `@${event.contact_handle}` : channelType.label,
        channel: channelType.label,
        channelType: channelType.type,
        status: isHumanTransfer ? 'atendimento_humano' : 'ia_ativa',
        stage: stageName,
        owner: defaultOwner,
        unread: 0,
        lastMessage: event.message_text || '',
        lastAt: formatDate(event.created_at),
        tags: [event.service, stageName].filter(Boolean),
        sentiment: sentimentFromEvent(event),
        value: estimatedValue(event),
        messages: [],
        events: [],
      });
    }

    const conversation = byChat.get(key);
    conversation.lastMessage = event.message_text || conversation.lastMessage;
    conversation.lastAt = formatDate(event.created_at);
    conversation.stage = stageName;
    conversation.status = isHumanTransfer ? 'atendimento_humano' : (conversation.status === 'atendimento_humano' ? 'atendimento_humano' : 'ia_ativa');
    conversation.owner = isHumanTransfer ? 'Recepção / Núbia' : conversation.owner;
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, stageName].filter(Boolean)));
    if (event.direction === 'outbound') {
      conversation.messages.push({
        from: event.sender_type === 'agent' ? 'agent' : 'ai',
        text: event.message_text || event.response_text || '',
        at: formatDate(event.created_at),
        status: event.delivery_status,
      });
    } else {
      conversation.messages.push({ from: 'contact', text: event.message_text || '', at: formatDate(event.created_at) });
    }
    if (event.direction !== 'outbound' && event.response_text) {
      conversation.messages.push({ from: 'ai', text: event.response_text, at: formatDate(event.created_at) });
    }
    conversation.events.push(`Serviço: ${event.service || 'geral'} - Etapa: ${stageName}`);
  }

  return Array.from(byChat.values()).sort((a, b) => compareDateLabel(b.lastAt, a.lastAt));
}

export const TENANT_SCHEDULING_LINKS = {
  clinica_nubia: 'https://nbbronze.tuaagenda.app/',
  jiw: 'https://nbbronze.tuaagenda.app/',
};

export function getTenantSchedulingLink(tenantSlug) {
  return TENANT_SCHEDULING_LINKS[tenantSlug] || 'https://nbbronze.tuaagenda.app/';
}

export function emptyKanban() {
  return [
    { id: 'novo', title: 'Novos contatos', cards: [] },
    { id: 'qualificacao', title: 'Qualificação & Dúvidas', cards: [] },
    { id: 'link_enviado', title: 'Link de agendamento enviado', cards: [] },
    { id: 'agendamento_confirmado', title: 'Agendamento confirmado', cards: [] },
    { id: 'humano', title: 'Atendimento humano', cards: [] },
    { id: 'concluido', title: 'Concluídos', cards: [] },
  ];
}

function eventsToKanban(events, tenantSlug = 'clinica_nubia') {
  const columns = emptyKanban();
  const latestByChat = new Map();

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  const defaultSchedulingUrl = getTenantSchedulingLink(tenantSlug);

  for (const event of latestByChat.values()) {
    const channelType = normalizeChannel(event.channel_type);
    const target = pickColumn(event.stage, event.handoff, event.message_text);
    const column = columns.find((item) => item.id === target) || columns[0];

    let aiReason = 'IA respondendo dúvidas';
    if (target === 'link_enviado') {
      aiReason = 'IA identificou intenção de agendamento e enviou link';
    } else if (target === 'agendamento_confirmado') {
      aiReason = 'Agendamento registrado pelo sistema';
    } else if (target === 'humano') {
      aiReason = 'Transferido para atendimento humano';
    } else if (target === 'novo') {
      aiReason = 'Primeiro contato recebido';
    }

    column.cards.push({
      id: `card-${event.id}`,
      externalConversationId: event.external_conversation_id,
      title: event.contact_name || `Contato ${channelType.label}`,
      subtitle: event.message_text || event.service || 'Mensagem recente',
      channel: channelType.label,
      channelType: channelType.type,
      stage: normalizeStage(event.stage),
      targetColumnId: target,
      value: formatCurrency(estimatedValue(event)),
      owner: event.handoff ? 'Recepção / Núbia' : 'Assistente IA',
      aiReason,
      schedulingLink: defaultSchedulingUrl,
      hasSchedulingLink: target === 'link_enviado' || target === 'agendamento_confirmado' || String(event.message_text || '').toLowerCase().includes('agendar'),
      lastAt: formatDate(event.created_at),
    });
  }

  return columns;
}

export function emptyFunnel() {
  return [
    { id: 'lead', name: 'Lead recebido', count: 0, value: 0, conversion: 0 },
    { id: 'diagnostico', name: 'Diagnóstico', count: 0, value: 0, conversion: 0 },
    { id: 'proposta', name: 'Proposta', count: 0, value: 0, conversion: 0 },
    { id: 'negociacao', name: 'Negociação', count: 0, value: 0, conversion: 0 },
    { id: 'fechado', name: 'Cliente fechado', count: 0, value: 0, conversion: 0 },
  ];
}

function eventsToFunnel(events) {
  const stages = emptyFunnel();
  const latestByChat = new Map();

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  for (const event of latestByChat.values()) {
    const norm = normalizeStage(event.stage);
    const index = norm === 'Orçamento solicitado' ? 2 : norm === 'Briefing necessário' || norm === 'Suporte técnico' ? 1 : 0;
    const value = estimatedValue(event);
    stages[index].count += 1;
    stages[index].value += value;
  }

  const total = Math.max(latestByChat.size, 1);
  return stages.map((stage) => ({ ...stage, conversion: Math.round((stage.count / total) * 100) }));
}

function pickColumn(stage, handoff, messageText = '') {
  const norm = normalizeStage(stage);
  const text = String(messageText || '').toLowerCase();

  if (handoff || norm === 'Atendimento humano') return 'humano';
  if (norm === 'Cliente fechado' || norm === 'Concluídos' || norm === 'Finalizada') return 'concluido';
  if (norm === 'Agendamento confirmado' || text.includes('confirmado') || text.includes('agendado')) return 'agendamento_confirmado';
  if (norm === 'Agendamento' || text.includes('agendar') || text.includes('horario') || text.includes('tuaagenda') || text.includes('link')) return 'link_enviado';
  if (norm === 'Qualificação' || text.includes('bronze') || text.includes('resultado') || text.includes('duvida')) return 'qualificacao';
  return 'novo';
}

function statusFromEvent(event) {
  if (event.handoff) return 'atendimento_humano';
  if (normalizeStage(event.stage) === 'Fora de contexto') return 'erro';
  return 'ia_ativa';
}

function sentimentFromEvent(event) {
  const norm = normalizeStage(event.stage);
  if (norm === 'Fora de contexto') return 'neutro';
  if (event.handoff || norm === 'Suporte técnico') return 'urgente';
  if (norm === 'Orçamento solicitado' || norm === 'Agendamento') return 'positivo';
  return 'neutro';
}

function estimatedValue(event) {
  if (event.stage === 'Orçamento solicitado' || event.stage === 'Orcamento solicitado') return 2500;
  if (event.service === 'software_house') return 18000;
  if (event.service === 'trafego_pago' || event.service === 'social_media') return 3200;
  if (event.service === 'suporte_ti') return 450;
  return 0;
}

function buildStatus({ source, events, error, tenantSlug }) {
  const latest = events?.[0];
  const human = events?.filter((event) => event.handoff).length || 0;
  const latestProvider = latest?.ai_provider || (source === 'supabase' ? 'regras/n8n' : 'mock');
  const channels = Array.from(new Set((events || []).map((event) => normalizeChannel(event.channel_type).label)));

  const rawBot = events?.find((e) => e.raw_payload?.sent?.raw?.result?.from?.username)?.raw_payload?.sent?.raw?.result?.from?.username
    || (tenantSlug === 'clinica_nubia' ? 'clinica_nubia_bot' : `${tenantSlug}_bot`);
  const botUsername = `@${rawBot.replace(/^@/, '')}`;

  return {
    source,
    error,
    botUsername,
    channel: channels.length ? channels.join(', ') : 'Telegram',
    telegram: channels.includes('Telegram') ? 'conectado' : 'sem eventos',
    instagram: channels.includes('Instagram') ? 'conectado' : 'preparado',
    webhook: channels.includes('Instagram') ? `telegram/${tenantSlug} / instagram` : `telegram/${tenantSlug}`,
    supabase: source === 'supabase' || source === 'supabase_empty',
    ai: latestProvider.includes('gemini') ? 'Gemini' : 'Regras e automações',
    latestAt: latest ? formatDate(latest.created_at) : 'Sem eventos',
    totalEvents: events?.length || 0,
    humanQueue: human,
  };
}

function normalizeChannel(value) {
  const type = String(value || 'telegram').toLowerCase();
  const labels = {
    telegram: 'Telegram',
    instagram: 'Instagram',
    instagram_direct: 'Instagram',
    whatsapp: 'WhatsApp',
    webchat: 'WebChat',
  };
  return { type, label: labels[type] || type.charAt(0).toUpperCase() + type.slice(1) };
}

function formatDate(value) {
  if (!value) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function compareDateLabel() {
  return 0;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export async function loadTeamAgents(tenantSlug) {
  if (!tenantSlug) return [];
  const storageKey = `magia:team-agents:${tenantSlug}`;
  try {
    const supabase = getClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_agents')
        .select('*')
        .eq('tenant_slug', tenantSlug)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (e) { }
        return data;
      }
    }
  } catch (e) {
    console.warn('Falha ao carregar team_agents do Supabase:', e);
  }
  try {
    const cached = localStorage.getItem(storageKey);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    return [];
  }
}

export async function saveTeamAgent(tenantSlug, agent) {
  const storageKey = `magia:team-agents:${tenantSlug}`;
  const newRecord = {
    tenant_slug: tenantSlug,
    name: agent.name,
    role: agent.role || 'Atendente',
    branch: agent.branch || 'Matriz',
    shift: agent.shift || 'Integral',
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

export async function updateTeamAgentStatus(agentId, newStatus, tenantSlug) {
  try {
    const supabase = getClient();
    if (supabase && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', agentId);
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

export async function removeTeamAgent(agentId, tenantSlug) {
  try {
    const supabase = getClient();
    if (supabase && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .delete()
        .eq('id', agentId);
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
