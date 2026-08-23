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
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'broadcast_campaigns',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'kanban_boards',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'kanban_columns',
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
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
    };
  }

  const tenant = await loadTenant(activeTenantSlug);
  const [eventsResult, appointments, broadcastContacts, broadcastCampaigns, kanbanConfig] = await Promise.all([
    supabase
      .from('channel_events')
      .select('*')
      .eq('tenant_slug', activeTenantSlug)
      .order('created_at', { ascending: false })
      .limit(150),
    tenant ? loadAppointments(tenant.id) : [],
    tenant ? loadBroadcastContacts(tenant.id) : [],
    tenant ? loadBroadcastCampaigns(tenant.id) : [],
    tenant ? loadKanbanConfig(tenant.id) : null,
  ]);
  const { data, error } = eventsResult;

  if (error) {
    console.warn('Supabase fallback:', error.message);
    return {
      ...fallback,
      source: 'mock_error',
      error: error.message,
      status: buildStatus({ source: 'mock_error', events: [], error: error.message, tenantSlug: activeTenantSlug }),
      appointments,
      broadcastContacts,
      broadcastCampaigns,
    };
  }

  if (!data?.length) {
    return {
      ...fallback,
      source: 'supabase_empty',
      conversations: [],
      kanbanColumns: eventsToKanban([], activeTenantSlug, appointments, kanbanConfig),
      funnelStages: emptyFunnel(),
      status: buildStatus({ source: 'supabase_empty', events: [], tenantSlug: activeTenantSlug }),
      appointments,
      broadcastContacts,
      broadcastCampaigns,
    };
  }

  return {
    ...fallback,
    source: 'supabase',
    conversations: eventsToConversations(data),
    kanbanColumns: eventsToKanban(data, activeTenantSlug, appointments, kanbanConfig),
    funnelStages: eventsToFunnel(data),
    status: buildStatus({ source: 'supabase', events: data, tenantSlug: activeTenantSlug }),
    appointments,
    broadcastContacts,
    broadcastCampaigns,
  };
}

async function loadTenant(activeTenantSlug) {
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', activeTenantSlug)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('Tenant lookup:', error.message);
    return null;
  }
  return data;
}

async function currentUserId() {
  const supabase = getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

async function loadAppointments(tenantId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('starts_at', { ascending: true })
    .limit(200);
  if (error) {
    console.warn('Appointments fallback:', error.message);
    return [];
  }
  return (data || []).map(mapAppointment);
}

async function loadBroadcastContacts(tenantId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('broadcast_contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.warn('Broadcast contacts fallback:', error.message);
    return [];
  }
  return data || [];
}

async function loadBroadcastCampaigns(tenantId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('broadcast_campaigns')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('Broadcast campaigns fallback:', error.message);
    return [];
  }
  return data || [];
}

async function loadKanbanConfig(tenantId) {
  const supabase = getClient();
  const { data: board, error: boardError } = await supabase
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (boardError) {
    console.warn('Kanban board fallback:', boardError.message);
    return null;
  }

  if (!board) return null;

  const { data: columns, error: columnsError } = await supabase
    .from('kanban_columns')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', board.id)
    .order('position', { ascending: true });

  if (columnsError) {
    console.warn('Kanban columns fallback:', columnsError.message);
    return null;
  }

  return {
    board,
    columns: columns || [],
  };
}

export async function saveAppointment(activeTenantSlug, appointment) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: tenant.id,
      title: appointment.title,
      starts_at: appointment.startsAt,
      ends_at: appointment.endsAt || null,
      status: appointment.status || 'scheduled',
      contact_name: appointment.contactName || null,
      channel_type: appointment.channelType || 'manual',
      external_conversation_id: appointment.externalConversationId || null,
      notes: appointment.notes || null,
      created_by: userId,
      metadata: appointment.metadata || {},
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapAppointment(data);
}

export async function upsertBroadcastContacts(activeTenantSlug, contacts) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const clean = contacts
    .map((contact) => ({
      tenant_id: tenant.id,
      name: contact.name || 'Contato',
      channel_type: contact.channelType || contact.channel_type || 'telegram',
      external_conversation_id: String(contact.externalConversationId || contact.external_conversation_id || '').trim(),
      phone: contact.phone || null,
      email: contact.email || null,
      source: contact.source || 'manual',
      tags: contact.tags || [],
      metadata: contact.metadata || {},
    }))
    .filter((contact) => contact.external_conversation_id);
  if (!clean.length) return [];
  const { data, error } = await supabase
    .from('broadcast_contacts')
    .upsert(clean, { onConflict: 'tenant_id,channel_type,external_conversation_id' })
    .select('*');
  if (error) throw error;
  return data || [];
}

export async function createBroadcastCampaign(activeTenantSlug, campaign, recipients) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const userId = await currentUserId();
  const { data: campaignRow, error: campaignError } = await supabase
    .from('broadcast_campaigns')
    .insert({
      tenant_id: tenant.id,
      name: campaign.name,
      channel_type: campaign.channelType || 'telegram',
      message_text: campaign.messageText,
      status: 'sending',
      total_recipients: recipients.length,
      created_by: userId,
    })
    .select('*')
    .single();
  if (campaignError) throw campaignError;

  const recipientRows = recipients.map((recipient) => ({
    tenant_id: tenant.id,
    campaign_id: campaignRow.id,
    contact_id: recipient.id || null,
    channel_type: recipient.channel_type || recipient.channelType || campaign.channelType || 'telegram',
    external_conversation_id: String(recipient.external_conversation_id || recipient.externalConversationId || '').trim(),
    contact_name: recipient.name || recipient.contact_name || 'Contato',
    status: 'queued',
  })).filter((recipient) => recipient.external_conversation_id);

  if (recipientRows.length) {
    const { error: recipientsError } = await supabase
      .from('broadcast_campaign_recipients')
      .insert(recipientRows);
    if (recipientsError) throw recipientsError;
  }

  return campaignRow;
}

export async function updateBroadcastCampaign(campaignId, patch) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const { data, error } = await supabase
    .from('broadcast_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateBroadcastRecipient(campaignId, externalConversationId, patch) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const { error } = await supabase
    .from('broadcast_campaign_recipients')
    .update(patch)
    .eq('campaign_id', campaignId)
    .eq('external_conversation_id', externalConversationId);
  if (error) throw error;
}

function normalizeStage(stage) {
  const s = String(stage || '').toLowerCase().trim();
  if (s.includes('finaliz') || s.includes('encerr')) return 'Finalizado';
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
    const isClosed = stageName === 'Finalizado' || event.service === 'conversation_closed' || event.ai_provider === 'conversation_closed';
    const defaultOwner = isHumanTransfer ? 'Recepção / Núbia' : 'Assistente IA';

    if (!byChat.has(key)) {
      byChat.set(key, {
        id: `conv-${key}`,
        externalConversationId: event.external_conversation_id || key,
        contact: event.contact_name || event.contact_handle || `Contato ${channelType.label}`,
        company: event.contact_handle ? `@${event.contact_handle}` : channelType.label,
        channel: channelType.label,
        channelType: channelType.type,
        status: isClosed ? 'finalizado' : isHumanTransfer ? 'atendimento_humano' : 'ia_ativa',
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
    conversation.status = isClosed ? 'finalizado' : isHumanTransfer ? 'atendimento_humano' : (conversation.status === 'atendimento_humano' ? 'atendimento_humano' : 'ia_ativa');
    if (isClosed) conversation.owner = 'Assistente IA';
    conversation.owner = isHumanTransfer ? 'Recepção / Núbia' : conversation.owner;
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, stageName].filter(Boolean)));
    if (event.direction === 'outbound') {
      conversation.messages.push({
        from: event.sender_type === 'agent' ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
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
};

export function getTenantSchedulingLink(tenantSlug) {
  return TENANT_SCHEDULING_LINKS[tenantSlug] || '';
}

const OFFICIAL_KANBAN_COLUMNS = [
  { id: 'novas_conversas', title: 'Novas conversas', automationKey: 'novas_conversas' },
  { id: 'conversas_andamento', title: 'Conversas em andamento', automationKey: 'conversas_andamento' },
  { id: 'conversas_humanos', title: 'Conversas com humanos', automationKey: 'conversas_humanos' },
  { id: 'agendamentos', title: 'Agendamentos', automationKey: 'agendamentos' },
];

const KANBAN_KEY_ALIASES = {
  novo: 'novas_conversas',
  novos: 'novas_conversas',
  novas: 'novas_conversas',
  novas_conversas: 'novas_conversas',
  primeiro_contato: 'novas_conversas',
  qualificacao: 'conversas_andamento',
  qualificação: 'conversas_andamento',
  link_enviado: 'conversas_andamento',
  agendamento_link: 'conversas_andamento',
  conversas_andamento: 'conversas_andamento',
  andamento: 'conversas_andamento',
  ativo: 'conversas_andamento',
  humano: 'conversas_humanos',
  atendimento_humano: 'conversas_humanos',
  conversas_humanos: 'conversas_humanos',
  humanos: 'conversas_humanos',
  handoff: 'conversas_humanos',
  agendamento: 'agendamentos',
  agendamentos: 'agendamentos',
  agendamento_confirmado: 'agendamentos',
  agenda: 'agendamentos',
  concluido: 'conversas_andamento',
  concluidos: 'conversas_andamento',
  finalizado: 'conversas_andamento',
  finalizada: 'conversas_andamento',
};

export function emptyKanban() {
  return OFFICIAL_KANBAN_COLUMNS.map((column) => ({ ...column, cards: [] }));
}

function eventsToKanban(events, tenantSlug = 'clinica_nubia', appointments = [], kanbanConfig = null) {
  const columns = buildKanbanColumns(kanbanConfig);
  const latestByChat = new Map();
  const eventCountsByChat = new Map();

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    eventCountsByChat.set(key, (eventCountsByChat.get(key) || 0) + 1);
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  const defaultSchedulingUrl = getTenantSchedulingLink(tenantSlug);

  for (const event of latestByChat.values()) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    const channelType = normalizeChannel(event.channel_type);
    const target = pickColumn(event.stage, event.handoff, event.message_text, {
      direction: event.direction,
      isFirstContact: (eventCountsByChat.get(key) || 0) <= 1,
    });
    const column = findKanbanColumn(columns, target) || columns[0];

    let aiReason = 'IA conduzindo a conversa';
    if (target === 'agendamentos') {
      aiReason = 'Agendamento registrado pelo sistema';
    } else if (target === 'conversas_humanos') {
      aiReason = 'Transferido para atendimento humano';
    } else if (target === 'novas_conversas') {
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
      owner: event.handoff ? 'Atendimento humano' : 'Assistente IA',
      aiReason,
      schedulingLink: defaultSchedulingUrl,
      hasSchedulingLink: Boolean(defaultSchedulingUrl) && (target === 'agendamentos' || hasSchedulingSignal(event.message_text)),
      lastAt: formatDate(event.created_at),
    });
  }

  const appointmentCards = appointments
    .filter((appointment) => appointment.status !== 'cancelled')
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .map((appointment) => ({
      id: `appointment-${appointment.id}`,
      title: appointment.title,
      subtitle: appointment.contactName ? `${appointment.contactName} - ${appointment.when}` : appointment.when,
      channel: appointment.channelLabel,
      value: 'Agenda',
      owner: appointment.statusLabel,
    }));

  const appointmentsColumn = findKanbanColumn(columns, 'agendamentos');
  if (appointmentsColumn) {
    appointmentsColumn.cards.push(...appointmentCards);
  } else {
    columns.push({
      id: 'agendamentos',
      title: 'Agendamentos',
      automationKey: 'agendamentos',
      cards: appointmentCards,
    });
  }

  return columns;
}

function buildKanbanColumns(kanbanConfig) {
  const configuredColumns = kanbanConfig?.columns;
  if (!Array.isArray(configuredColumns) || !configuredColumns.length) {
    return emptyKanban();
  }

  const columnsByKey = new Map(emptyKanban().map((column) => [column.automationKey, column]));

  for (const column of configuredColumns) {
    const rawKey = column.automation_key || column.id || column.name;
    const canonicalKey = canonicalKanbanKey(rawKey);
    const officialColumn = OFFICIAL_KANBAN_COLUMNS.find((item) => item.automationKey === canonicalKey);
    if (!officialColumn) continue;

    const usesOfficialKey = canonicalKey === normalizeKey(rawKey);
    columnsByKey.set(canonicalKey, {
      ...officialColumn,
      title: usesOfficialKey && column.name ? column.name : officialColumn.title,
      boardId: column.board_id,
      position: column.position,
      cards: [],
    });
  }

  return OFFICIAL_KANBAN_COLUMNS.map((column) => (
    columnsByKey.get(column.automationKey) || { ...column, cards: [] }
  ));
}

function findKanbanColumn(columns, targetKey) {
  const target = canonicalKanbanKey(targetKey);
  return columns.find((column) => (
    canonicalKanbanKey(column.automationKey) === target ||
    canonicalKanbanKey(column.automation_key) === target ||
    canonicalKanbanKey(column.id) === target
  ));
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

function pickColumn(stage, handoff, messageText = '', context = {}) {
  const norm = normalizeStage(stage);
  const text = String(messageText || '').toLowerCase();

  if (handoff || norm === 'Atendimento humano') return 'conversas_humanos';
  if (norm === 'Agendamento confirmado' || text.includes('confirmado') || text.includes('agendado')) return 'agendamentos';
  if (context.isFirstContact && context.direction !== 'outbound') return 'novas_conversas';
  return 'conversas_andamento';
}

function canonicalKanbanKey(key) {
  const normalized = normalizeKey(key);
  return KANBAN_KEY_ALIASES[normalized] || normalized;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hasSchedulingSignal(messageText = '') {
  const text = String(messageText || '').toLowerCase();
  return text.includes('agendar') || text.includes('horario') || text.includes('horário') || text.includes('tuaagenda') || text.includes('link');
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
    manual: 'Manual',
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

function mapAppointment(row) {
  const starts = row.starts_at ? new Date(row.starts_at) : null;
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  return {
    id: row.id,
    title: row.title,
    contactName: row.contact_name || row.metadata?.contact_name || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    when: starts ? formatDate(row.starts_at) : 'Sem data',
    dateKey: starts ? starts.toISOString().slice(0, 10) : '',
    timeLabel: starts ? starts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    endTimeLabel: ends ? ends.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    status: row.status || 'scheduled',
    statusLabel: statusAppointmentLabel(row.status),
    notes: row.notes || '',
    channelType: row.channel_type || 'manual',
    channelLabel: normalizeChannel(row.channel_type || 'manual').label,
    externalConversationId: row.external_conversation_id || '',
    raw: row,
  };
}

function statusAppointmentLabel(status) {
  const labels = {
    scheduled: 'Agendado',
    confirmed: 'Confirmado',
    done: 'Concluido',
    cancelled: 'Cancelado',
  };
  return labels[status] || status || 'Agendado';
}
