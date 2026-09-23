import { createClient } from '@supabase/supabase-js';
import { getAuthClient, isAuthRequired } from './authService';
import { loadUserTenants, enabledChannels } from './tenantAccess';
import { prepareConversationEvents } from './conversationEvents';
import { applyConversationLifecycle } from './conversationLifecycle';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const defaultTenantSlug = import.meta.env.VITE_TENANT_SLUG || 'jiw';
const tenantStorageKey = 'magia:selected-tenant-slug';
const mediaObjectUrlCache = new Map();

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

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
  if (!supabase) return isAuthRequired() ? [] : fallbackTenants;
  return loadUserTenants(supabase);
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
  if (!tenant) throw new Error('Empresa indisponivel para esta conta.');
  const { data: uiSettings, error: settingsError } = await supabase.from('tenant_settings')
    .select('settings').eq('tenant_id', tenant.id).maybeSingle();
  if (settingsError) throw new Error('Nao foi possivel carregar as configuracoes da empresa.');
  const tenantChannels = enabledChannels(uiSettings?.settings);
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
    throw new Error('Nao foi possivel carregar os atendimentos.');
  }

  if (!data?.length) {
    return {
      ...fallback,
      source: 'supabase_empty',
      enabledChannels: tenantChannels,
      conversations: [],
      kanbanColumns: eventsToKanban([], activeTenantSlug, appointments, kanbanConfig),
      funnelStages: emptyFunnel(),
      status: buildStatus({ source: 'supabase_empty', events: [], tenantSlug: activeTenantSlug }),
      appointments,
      broadcastContacts,
      broadcastCampaigns,
    };
  }

  const eventsWithMediaUrls = await enrichMediaUrls(
    data.map((event) => ({ ...event, raw_payload: asObject(event.raw_payload) })),
    supabase,
  );

  return {
    ...fallback,
    source: 'supabase',
    enabledChannels: tenantChannels,
    conversations: eventsToConversations(eventsWithMediaUrls),
    kanbanColumns: eventsToKanban(eventsWithMediaUrls, activeTenantSlug, appointments, kanbanConfig),
    funnelStages: eventsToFunnel(eventsWithMediaUrls),
    status: buildStatus({ source: 'supabase', events: eventsWithMediaUrls, tenantSlug: activeTenantSlug }),
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
  if (s === 'reset' || s === '/reset') return 'Qualificação';
  if (s.includes('aguardando') && (s.includes('final') || s.includes('pagamento'))) return 'Aguardando finalizacao';
  if (s.includes('finaliz') || s.includes('encerr')) return 'Finalizado';
  if (s.includes('verificar sinal')) return 'Verificar Sinal';
  if (s.includes('sinal informado')) return 'Sinal informado';
  if (s.includes('produto') && (s.includes('apresent') || s.includes('catalog') || s.includes('foto'))) return 'Produtos apresentados';
  if (s.includes('interesse') && s.includes('compra')) return 'Interesse em compra';
  if (s.includes('venda') && s.includes('conclu')) return 'Venda concluida';
  if (s.includes('agendamento confirmado')) return 'Agendamento confirmado';
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

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function enrichMediaUrls(events, supabase) {
  const targets = new Map();

  for (const event of events) {
    const payload = asObject(event.raw_payload);
    const media = asObject(payload.media);
    if (media.status !== 'stored' || !media.bucket || !media.storagePath || media.url) continue;
    targets.set(`${media.bucket}:${media.storagePath}`, media);
  }

  if (!targets.size) return events;

  const mediaUrls = new Map();
  await Promise.all([...targets.entries()].map(async ([key, media]) => {
    const cachedUrl = mediaObjectUrlCache.get(key);
    if (cachedUrl) {
      mediaUrls.set(key, cachedUrl);
      return;
    }
    const { data, error } = await supabase.storage
      .from(media.bucket)
      .download(media.storagePath);
    if (error) {
      console.warn('Media download fallback:', error.message);
      return;
    }
    if (data?.size) {
      let url = '';
      if (media.encoding === 'base64') {
        const base64 = (await data.text()).trim();
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          console.warn('Media download fallback: conteúdo Base64 inválido.');
          return;
        }
        url = `data:${media.mimeType || 'application/octet-stream'};base64,${base64}`;
      } else {
        if (media.kind === 'image' && !String(data.type || '').startsWith('image/')) {
          console.warn('Media download fallback: arquivo não é uma imagem válida.', data.type || 'tipo ausente');
          return;
        }
        url = media.kind === 'image'
          ? await blobToDataUrl(data)
          : URL.createObjectURL(data);
      }
      if (url) {
      mediaObjectUrlCache.set(key, url);
      mediaUrls.set(key, url);
      }
    }
  }));

  return events.map((event) => {
    const payload = asObject(event.raw_payload);
    const media = asObject(payload.media);
    const url = mediaUrls.get(`${media.bucket}:${media.storagePath}`);
    if (!url) return event;
    return { ...event, raw_payload: { ...payload, media: { ...media, url } } };
  });
}

function normalizeMedia(rawPayload) {
  const payload = asObject(rawPayload);
  const normalized = asObject(payload.media);
  const message = asObject(payload.telegram_update).message || payload.message || {};

  if (normalized.kind) {
    return {
      kind: normalized.kind,
      caption: normalized.caption || '',
      url: normalized.url || '',
      thumbnailUrl: normalized.thumbnailUrl || normalized.thumbnail_url || '',
      fileName: normalized.fileName || normalized.file_name || '',
      mimeType: normalized.mimeType || normalized.mime_type || '',
      encoding: normalized.encoding || '',
      size: Number(normalized.size || normalized.file_size || 0),
      duration: Number(normalized.duration || 0),
    };
  }

  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1] || {};
    return { kind: 'image', caption: message.caption || '', size: Number(photo.file_size || 0) };
  }
  if (message.voice) return { kind: 'audio', caption: message.caption || '', duration: Number(message.voice.duration || 0), mimeType: message.voice.mime_type || '', size: Number(message.voice.file_size || 0) };
  if (message.audio) return { kind: 'audio', caption: message.caption || '', duration: Number(message.audio.duration || 0), fileName: message.audio.file_name || '', mimeType: message.audio.mime_type || '', size: Number(message.audio.file_size || 0) };
  if (message.video || message.video_note || message.animation) {
    const video = message.video || message.video_note || message.animation;
    return { kind: 'video', caption: message.caption || '', duration: Number(video.duration || 0), fileName: video.file_name || '', mimeType: video.mime_type || '', size: Number(video.file_size || 0) };
  }
  if (message.document) return { kind: 'document', caption: message.caption || '', fileName: message.document.file_name || '', mimeType: message.document.mime_type || '', size: Number(message.document.file_size || 0) };
  return null;
}

function mediaPreview(media) {
  if (!media) return '';
  const labels = { image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento' };
  return media.caption || media.fileName || labels[media.kind] || 'Anexo';
}

function isGeneratedMediaLabel(text) {
  return /^\[(?:Imagem|Áudio|Video|Vídeo|Arquivo|Figurinha) recebida\]$/i.test(String(text || '').trim());
}

function eventsToConversations(events) {
  const byChat = new Map();

  for (const event of prepareConversationEvents(events).reverse()) {
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
        lastMessage: event.message_text || mediaPreview(normalizeMedia(event.raw_payload)),
        lastAt: formatDate(event.created_at),
        tags: [event.service, stageName].filter(Boolean),
        sentiment: sentimentFromEvent(event),
        value: estimatedValue(event),
        messages: [],
        events: [],
      });
    }

    const conversation = byChat.get(key);
    const media = normalizeMedia(event.raw_payload);
    const text = event.message_text || media?.caption || '';
    const visibleText = media && isGeneratedMediaLabel(text) ? '' : text;
    conversation.lastMessage = text || mediaPreview(media) || conversation.lastMessage;
    conversation.lastAt = formatDate(event.created_at);
    applyConversationLifecycle(conversation, event, stageName);
    if (isClosed) conversation.owner = 'Assistente IA';
    conversation.owner = isHumanTransfer ? 'Recepção / Núbia' : conversation.owner;
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, stageName].filter(Boolean)));
    if (event.direction === 'outbound') {
      conversation.messages.push({
        from: event.sender_type === 'agent' ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
        text: visibleText || event.response_text || '',
        at: formatDate(event.created_at),
        status: event.delivery_status,
        media,
      });
    } else {
      conversation.messages.push({ from: 'contact', text: visibleText, at: formatDate(event.created_at), media });
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
  { id: 'verificar_sinal', title: 'Verificar Sinal', automationKey: 'verificar_sinal' },
  { id: 'agendamentos', title: 'Agendamentos', automationKey: 'agendamentos' },
];

const KANBAN_KEY_ALIASES = {
  ia: 'conversas_ia',
  conversa_ia: 'conversas_ia',
  conversas_ia: 'conversas_ia',
  conversas_com_ia: 'conversas_ia',
  aguardando_humano: 'aguardando_humano',
  aguardando_atendimento: 'aguardando_humano',
  aguardando_atendimento_humano: 'aguardando_humano',
  aguardando: 'aguardando_humano',
  com_humano: 'com_humano',
  conversa_com_humano: 'com_humano',
  conversas_com_humano: 'com_humano',
  designado_humano: 'com_humano',
  verificar_sinal: 'verificar_sinal',
  sinal_pago: 'verificar_sinal',
  pagamento_sinal: 'verificar_sinal',
  pagamento_reportado: 'verificar_sinal',
  sinal_informado: 'verificar_sinal',
  produtos_apresentados: 'produtos_apresentados',
  catalogo_enviado: 'produtos_apresentados',
  fotos_enviadas: 'produtos_apresentados',
  interesse_compra: 'interesse_compra',
  interesse_em_compra: 'interesse_compra',
  aguardando_finalizacao: 'aguardando_finalizacao',
  aguardando_pagamento: 'aguardando_finalizacao',
  venda_concluida: 'finalizadas',
  pedido_finalizado: 'finalizadas',
  finalizadas: 'finalizadas',
  finalizada: 'finalizadas',
  finalizado: 'finalizadas',
  encerradas: 'finalizadas',
  encerrada: 'finalizadas',
  conversas_abandonadas: 'conversas_abandonadas',
  abandonadas: 'conversas_abandonadas',
  abandonada: 'conversas_abandonadas',
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
};

export function emptyKanban() {
  return OFFICIAL_KANBAN_COLUMNS.map((column) => ({ ...column, cards: [] }));
}

function eventsToKanban(events, tenantSlug = 'clinica_nubia', appointments = [], kanbanConfig = null) {
  const columns = buildKanbanColumns(kanbanConfig);
  const latestByChat = new Map();
  const eventCountsByChat = new Map();
  const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));

  for (const event of events) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    eventCountsByChat.set(key, (eventCountsByChat.get(key) || 0) + 1);
    if (!latestByChat.has(key)) latestByChat.set(key, event);
  }

  const defaultSchedulingUrl = getTenantSchedulingLink(tenantSlug);

  for (const event of latestByChat.values()) {
    const key = `${event.channel_type || 'unknown'}:${event.external_conversation_id || event.id}`;
    const channelType = normalizeChannel(event.channel_type);
    const targetCandidates = pickColumn(event.stage, event.handoff, event.message_text, {
      direction: event.direction,
      isFirstContact: (eventCountsByChat.get(key) || 0) <= 1,
      event,
    });
    const target = targetCandidates.find((candidate) => findKanbanColumn(columns, candidate)) || targetCandidates[0];
    const column = findKanbanColumn(columns, target) || columns[0];
    const relatedAppointmentId = event.raw_payload?.payment_signal?.appointment_update?.appointment?.id
      || event.raw_payload?.appointment_id
      || event.raw_payload?.appointment_creation?.appointment?.id
      || '';
    const relatedAppointment = appointmentsById.get(relatedAppointmentId);

    if (target === 'verificar_sinal' && relatedAppointment) {
      continue;
    }

    let aiReason = 'IA conduzindo a conversa';
    if (target === 'agendamentos') {
      aiReason = 'Registro operacional do sistema';
    } else if (target === 'verificar_sinal') {
      aiReason = 'Sinal informado pela cliente';
    } else if (target === 'produtos_apresentados') {
      aiReason = 'Catalogo ou fotos apresentados';
    } else if (target === 'interesse_compra') {
      aiReason = 'Cliente demonstrou interesse de compra';
    } else if (target === 'aguardando_finalizacao') {
      aiReason = 'Aguardando finalizacao do pedido';
    } else if (target === 'aguardando_humano') {
      aiReason = 'IA encaminhou para a equipe';
    } else if (target === 'com_humano' || target === 'conversas_humanos') {
      aiReason = 'Transferido para atendimento humano';
    } else if (target === 'finalizadas') {
      aiReason = 'Atendimento finalizado';
    } else if (target === 'conversas_abandonadas') {
      aiReason = 'Conversa sem encerramento recente';
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
      owner: ownerFromKanbanTarget(target, event),
      aiReason,
      appointmentId: relatedAppointmentId,
      appointmentStatus: relatedAppointment?.status || '',
      actionType: target === 'verificar_sinal' && relatedAppointmentId ? 'confirm_signal' : '',
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
      appointmentId: appointment.id,
      title: appointment.title,
      subtitle: appointment.contactName ? `${appointment.contactName} - ${appointment.when}` : appointment.when,
      channel: appointment.channelLabel,
      channelType: appointment.channelType,
      value: 'Agenda',
      owner: appointment.statusLabel,
      appointmentStatus: appointment.status,
      appointmentMetadata: appointment.raw?.metadata || {},
      externalConversationId: appointment.externalConversationId,
      targetColumnId: appointment.status === 'payment_reported' ? 'verificar_sinal' : 'agendamentos',
      actionType: appointment.status === 'payment_reported' ? 'confirm_signal' : '',
      aiReason: appointment.status === 'payment_reported'
        ? 'Sinal informado. Aguardando verificação humana.'
        : '',
    }));

  for (const appointmentCard of appointmentCards) {
    const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');
    if (targetColumn) {
      targetColumn.cards.push(appointmentCard);
    }
  }

  if (appointmentCards.some((card) => card.targetColumnId === 'agendamentos') && !kanbanConfig?.columns?.length && !findKanbanColumn(columns, 'agendamentos')) {
    columns.push({
      id: 'agendamentos',
      title: 'Agendamentos',
      automationKey: 'agendamentos',
      cards: appointmentCards.filter((card) => card.targetColumnId === 'agendamentos'),
    });
  }

  return columns;
}

function buildKanbanColumns(kanbanConfig) {
  const configuredColumns = kanbanConfig?.columns;
  if (!Array.isArray(configuredColumns) || !configuredColumns.length) {
    return emptyKanban();
  }

  const seen = new Set();
  return configuredColumns
    .slice()
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
    .map((column) => {
      const rawKey = column.automation_key || column.id || column.name;
      const canonicalKey = canonicalKanbanKey(rawKey);
      const officialColumn = OFFICIAL_KANBAN_COLUMNS.find((item) => item.automationKey === canonicalKey);
      return {
        ...(officialColumn || {}),
        id: canonicalKey || String(column.id || column.name),
        title: column.name || officialColumn?.title || rawKey || 'Etapa',
        automationKey: canonicalKey,
        boardId: column.board_id,
        position: column.position,
        cards: [],
      };
    })
    .filter((column) => {
      if (!column.automationKey || seen.has(column.automationKey)) return false;
      seen.add(column.automationKey);
      return true;
    });
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
  const event = context.event || {};

  if (isKanbanClosed(event, norm)) return ['finalizadas', 'conversas_andamento'];
  if (isKanbanPaymentSignal(event, norm)) return ['verificar_sinal', 'aguardando_humano', 'conversas_humanos'];
  if (norm === 'Produtos apresentados') return ['produtos_apresentados', 'conversas_andamento'];
  if (norm === 'Interesse em compra') return ['interesse_compra', 'conversas_andamento'];
  if (norm === 'Aguardando finalizacao') return ['aguardando_finalizacao', 'conversas_andamento'];
  if (norm === 'Venda concluida') return ['finalizadas', 'conversas_andamento'];
  if (norm === 'Agendamento confirmado' || text.includes('confirmado') || text.includes('agendado')) return ['agendamentos'];
  if (isKanbanAssignedToHuman(event)) return ['com_humano', 'conversas_humanos'];
  if (isKanbanWaitingHuman(event, handoff, norm)) return ['aguardando_humano', 'conversas_humanos'];
  if (isKanbanAbandoned(event, context)) return ['conversas_abandonadas', 'conversas_andamento'];
  if (context.isFirstContact && context.direction !== 'outbound') return ['conversas_ia', 'novas_conversas', 'conversas_andamento'];
  return ['conversas_ia', 'conversas_andamento'];
}

function isKanbanClosed(event, normalizedStage = normalizeStage(event?.stage)) {
  return normalizedStage === 'Finalizado'
    || event?.service === 'conversation_closed'
    || event?.ai_provider === 'conversation_closed'
    || event?.delivery_status === 'closed';
}

function isKanbanAssignedToHuman(event) {
  return event?.sender_type === 'agent'
    || event?.service === 'manual_reply'
    || event?.service === 'conversation_assigned'
    || Boolean(event?.raw_payload?.assignee);
}

function isKanbanPaymentSignal(event, normalizedStage = normalizeStage(event?.stage)) {
  return normalizedStage === 'Verificar Sinal'
    || normalizedStage === 'Sinal informado'
    || event?.service === 'pagamento_sinal'
    || event?.ai_provider === 'payment_signal'
    || Boolean(event?.raw_payload?.payment_signal);
}

function isKanbanWaitingHuman(event, handoff, normalizedStage = normalizeStage(event?.stage)) {
  return Boolean(handoff)
    || normalizedStage === 'Atendimento humano'
    || event?.ai_provider === 'human_lock'
    || event?.raw_payload?.internal_actions?.ready_to_schedule
    || event?.raw_payload?.internal_actions?.complaint_handoff;
}

function isKanbanAbandoned(event, context = {}) {
  if (context.direction === 'outbound') return false;
  if (context.isFirstContact) return false;
  if (!event?.created_at) return false;
  const createdAt = Date.parse(event.created_at);
  if (!Number.isFinite(createdAt)) return false;
  const abandonedAfterHours = Number(event.raw_payload?.kanban_abandoned_after_hours || 24);
  return Date.now() - createdAt > abandonedAfterHours * 60 * 60 * 1000;
}

function ownerFromKanbanTarget(target, event) {
  if (target === 'com_humano') return event.sent_by_user || event.raw_payload?.assignee?.name || 'Atendimento humano';
  if (target === 'aguardando_humano') return 'Aguardando humano';
  if (target === 'finalizadas') return 'Finalizado';
  return event.handoff ? 'Atendimento humano' : 'Assistente IA';
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
      if (isAuthRequired()) return [];
    }
  } catch (e) {
    console.warn('Falha ao carregar team_agents do Supabase:', e);
  }
  if (isAuthRequired()) return [];
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
    pending_payment: 'Aguardando sinal',
    done: 'Concluido',
    cancelled: 'Cancelado',
    payment_reported: 'Pagamento informado',
    aguardando_verificacao: 'Pagamento informado',
  };
  return labels[status] || status || 'Agendado';
}

export async function moveKanbanCard(activeTenantSlug, card, targetColumnKey, agentName = null) {
  const canonical = canonicalKanbanKey(targetColumnKey);
  const tenantSlug = activeTenantSlug || 'clinica_nubia';

  let stage = 'Qualificacao';
  let service = 'kanban_move';
  let handoff = false;
  let senderType = 'system';
  let sentByUser = agentName || null;
  let responseText = null;

  if (canonical === 'finalizadas') {
    stage = 'Finalizada';
    service = 'conversation_closed';
    handoff = false;
    responseText = 'Atendimento finalizado no painel.';
  } else if (canonical === 'com_humano' || canonical === 'conversas_humanos') {
    stage = 'Atendimento humano';
    service = 'conversation_assigned';
    handoff = true;
    senderType = 'agent';
    sentByUser = agentName || 'Atendente';
    responseText = `Conversa assumida por ${sentByUser}.`;
  } else if (canonical === 'aguardando_humano') {
    stage = 'Atendimento humano';
    service = 'handoff_requested';
    handoff = true;
    responseText = 'Aguardando atendimento humano.';
  } else if (canonical === 'agendamentos') {
    stage = 'Agendamento';
    service = 'agendamento';
    handoff = true;
    responseText = 'Movido para agendamentos.';
  } else if (canonical === 'conversas_abandonadas') {
    stage = 'Finalizada';
    service = 'conversation_abandoned';
    handoff = false;
    responseText = 'Conversa marcada como abandonada.';
  } else {
    stage = 'Qualificacao';
    service = 'ia_active';
    handoff = false;
    responseText = 'Retornado para atendimento da IA.';
  }

  const conversationId = String(card.externalConversationId || card.conversationId || card.id || '');
  const contactName = card.title || card.contactName || 'Contato';
  const channelType = card.channelType || card.channel || 'telegram';

  const newEvent = {
    tenant_slug: tenantSlug,
    channel_type: channelType,
    external_conversation_id: conversationId,
    external_message_id: `kanban_move_${Date.now()}`,
    direction: 'outbound',
    sender_type: senderType,
    sent_by_user: sentByUser,
    contact_name: contactName,
    message_text: `[Kanban] Etapa alterada para: ${stage}`,
    response_text: responseText,
    service,
    stage,
    handoff,
    delivery_status: 'delivered',
    ai_provider: 'kanban_action',
    raw_payload: {
      kanban_transition: {
        from_stage: card.stage,
        to_column: canonical,
        moved_at: new Date().toISOString(),
        moved_by: sentByUser || 'Operador',
      },
    },
  };

  const supabase = getClient();
  if (supabase) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao salvar a movimentação do Kanban.');
    newEvent.tenant_id = tenant.id;
    const { data, error } = await supabase.from('channel_events').insert([newEvent]).select();
    if (error) throw error;
    return data;
  }

  return [newEvent];
}
