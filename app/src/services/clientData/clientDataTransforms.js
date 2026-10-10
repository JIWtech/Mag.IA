import { formatDate } from '../../utils/dateFormatting.js';
import { normalizeChannel } from '../identity/conversationIdentity.js';
import { estimatedValue } from '../conversations/conversationDerived.js';
import { normalizeStage } from '../conversations/conversationPresentation.js';
import { eventsToConversations } from '../conversations/eventsToConversations.js';
import { eventsToKanban } from '../kanban/eventsToKanban.js';
import { emptyFunnel } from '../funnel/funnelHelpers.js';
import { applyConversationReadState } from '../reads/readsService.js';

function eventsToFunnel(events) {
  const stages = emptyFunnel();
  const latestByChat = new Map();

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  for (const event of latestByChat.values()) {
    const norm = normalizeStage(event.stage);
    let index = 0;
    if (norm === 'Finalizado' || norm === 'Cliente fechado' || event.service === 'conversation_closed') {
      index = 4;
    } else if (norm === 'Negociação' || norm === 'Financiamento' || norm === 'Atendimento humano') {
      index = 3;
    } else if (norm === 'Orçamento solicitado' || norm === 'Proposta' || norm === 'Avaliação') {
      index = 2;
    } else if (norm === 'Briefing necessário' || norm === 'Suporte técnico' || norm === 'Diagnóstico' || norm === 'Qualificação') {
      index = 1;
    } else {
      index = 0;
    }
    const value = estimatedValue(event);
    stages[index].count += 1;
    stages[index].value += value;
  }

  const total = Math.max(latestByChat.size, 1);
  return stages.map((stage) => ({ ...stage, conversion: Math.round((stage.count / total) * 100) }));
}

function statusFromEvent(event) {
  if (event.handoff) return 'atendimento_humano';
  if (normalizeStage(event.stage) === 'Fora de contexto') return 'erro';
  return 'ia_ativa';
}

export function buildStatus({ source, events, error, tenantSlug }) {
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

export function buildEmptyClientData({ fallback, tenantId, enabledChannels, activeTenantSlug, appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents, kanbanConfig, followUpJobs, salesLeads }) {
  return { ...fallback, tenantId, source: 'supabase_empty', enabledChannels, conversations: [], kanbanColumns: eventsToKanban([], activeTenantSlug, appointments, kanbanConfig, followUpJobs, salesLeads, teamAgents), funnelStages: emptyFunnel(), status: buildStatus({ source: 'supabase_empty', events: [], tenantSlug: activeTenantSlug }), appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents };
}

export function buildLoadedClientData({ fallback, tenantId, enabledChannels, activeTenantSlug, userId, events, appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents, kanbanConfig, followUpJobs, salesLeads, tenantSettings }) {
  const kanbanColumns = eventsToKanban(events, activeTenantSlug, appointments, kanbanConfig, followUpJobs, salesLeads, teamAgents);
  const conversations = applyConversationReadState(eventsToConversations(events, activeTenantSlug, teamAgents, kanbanColumns), conversationReads, tenantId, userId);
  return { ...fallback, tenantId, source: 'supabase', enabledChannels, conversations, kanbanColumns, funnelStages: eventsToFunnel(events), status: buildStatus({ source: 'supabase', events, tenantSlug: activeTenantSlug }), appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents, tenantSettings, kanbanConfig };
}
