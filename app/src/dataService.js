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
  if (!supabase) return () => {};

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
    kanbanColumns: eventsToKanban(data),
    funnelStages: eventsToFunnel(data),
    status: buildStatus({ source: 'supabase', events: data, tenantSlug: activeTenantSlug }),
  };
}

function eventsToConversations(events) {
  const byChat = new Map();

  for (const event of [...events].reverse()) {
    const channelType = normalizeChannel(event.channel_type);
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.contact_handle || event.id}`;
    if (!byChat.has(key)) {
      byChat.set(key, {
        id: `conv-${key}`,
        externalConversationId: event.external_conversation_id || key,
        contact: event.contact_name || event.contact_handle || `Contato ${channelType.label}`,
        company: event.contact_handle ? `@${event.contact_handle}` : channelType.label,
        channel: channelType.label,
        channelType: channelType.type,
        status: statusFromEvent(event),
        stage: event.stage || 'Qualificação',
        owner: event.handoff ? 'Equipe JIW' : 'Assistente JIW',
        unread: 0,
        lastMessage: event.message_text || '',
        lastAt: formatDate(event.created_at),
        tags: [event.service, event.stage].filter(Boolean),
        sentiment: sentimentFromEvent(event),
        value: estimatedValue(event),
        messages: [],
        events: [],
      });
    }

    const conversation = byChat.get(key);
    conversation.lastMessage = event.message_text || conversation.lastMessage;
    conversation.lastAt = formatDate(event.created_at);
    conversation.stage = event.stage || conversation.stage;
    conversation.status = statusFromEvent(event);
    conversation.owner = event.handoff ? 'Equipe JIW' : 'Assistente JIW';
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, event.stage].filter(Boolean)));
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
    conversation.events.push(`Serviço: ${event.service || 'geral'} - Etapa: ${event.stage || 'Qualificação'}`);
  }

  return Array.from(byChat.values()).sort((a, b) => compareDateLabel(b.lastAt, a.lastAt));
}

export function emptyKanban() {
  return [
    { id: 'novo', title: 'Novo contato', cards: [] },
    { id: 'qualificacao', title: 'Qualificação', cards: [] },
    { id: 'briefing', title: 'Briefing necessário', cards: [] },
    { id: 'suporte', title: 'Suporte técnico', cards: [] },
    { id: 'orcamento', title: 'Orçamento solicitado', cards: [] },
    { id: 'humano', title: 'Atendimento humano', cards: [] },
  ];
}

function eventsToKanban(events) {
  const columns = emptyKanban();
  const latestByChat = new Map();

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  for (const event of latestByChat.values()) {
    const channelType = normalizeChannel(event.channel_type);
    const target = pickColumn(event.stage, event.handoff);
    const column = columns.find((item) => item.id === target) || columns[1];
    column.cards.push({
      id: `card-${event.id}`,
      title: event.contact_name || `Contato ${channelType.label}`,
      subtitle: event.message_text || event.service || 'Contato',
      channel: channelType.label,
      value: formatCurrency(estimatedValue(event)),
      owner: event.handoff ? 'Equipe JIW' : 'Assistente JIW',
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
    const index = event.stage === 'Orçamento solicitado' || event.stage === 'Orcamento solicitado' ? 2 : event.stage === 'Briefing necessário' || event.stage === 'Briefing necessario' || event.stage === 'Suporte técnico' || event.stage === 'Suporte tecnico' ? 1 : 0;
    const value = estimatedValue(event);
    stages[index].count += 1;
    stages[index].value += value;
  }

  const total = Math.max(latestByChat.size, 1);
  return stages.map((stage) => ({ ...stage, conversion: Math.round((stage.count / total) * 100) }));
}

function pickColumn(stage, handoff) {
  if (handoff || stage === 'Atendimento humano') return 'humano';
  if (stage === 'Briefing necessário' || stage === 'Briefing necessario') return 'briefing';
  if (stage === 'Suporte técnico' || stage === 'Suporte tecnico') return 'suporte';
  if (stage === 'Orçamento solicitado' || stage === 'Orcamento solicitado') return 'orcamento';
  if (stage === 'Fora de contexto') return 'novo';
  return 'qualificacao';
}

function statusFromEvent(event) {
  if (event.handoff) return 'atendimento_humano';
  if (event.stage === 'Fora de contexto') return 'erro';
  return 'ia_ativa';
}

function sentimentFromEvent(event) {
  if (event.stage === 'Fora de contexto') return 'neutro';
  if (event.handoff || event.stage === 'Suporte técnico' || event.stage === 'Suporte tecnico') return 'urgente';
  return 'positivo';
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

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}
