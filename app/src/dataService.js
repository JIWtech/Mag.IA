import { createClient } from '@supabase/supabase-js';
import { getAuthClient, isAuthRequired } from './authService.js';
import { loadUserTenants, enabledChannels } from './tenantAccess.js';
import { prepareConversationEvents } from './conversationEvents.js';
import { applyConversationLifecycle } from './conversationLifecycle.js';
import { isEligibleForExternalOutbound, isInternalOperationalEvent } from './eventClassification.js';
import { TECHNICAL_MEDIA_LABELS, REAL_MEDIA_KINDS } from './audioUtils.js';

const runtimeEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || '';
const defaultTenantSlug = runtimeEnv.VITE_TENANT_SLUG || 'jiw';
const tenantStorageKey = 'magia:selected-tenant-slug';
export const SIGNED_URL_EXPIRES_IN = 86400;
const mediaObjectUrlCache = new Map();

export function clearMediaUrlCache() {
  mediaObjectUrlCache.clear();
}

export function getMediaUrlFromCache(key) {
  const cached = mediaObjectUrlCache.get(key);
  if (!cached) return null;
  return typeof cached === 'string' ? cached : cached.url;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      if (typeof blob?.arrayBuffer === 'function') {
        blob.arrayBuffer().then((buf) => {
          const base64 = Buffer.from(buf).toString('base64');
          resolve(`data:${blob.type || 'image/jpeg'};base64,${base64}`);
        }).catch(reject);
        return;
      }
      resolve(`data:${blob?.type || 'image/jpeg'};base64,mockdata`);
      return;
    }
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
      (payload) => onChange?.({ table: 'channel_events', ...payload }),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
      },
      (payload) => onChange?.({ table: 'appointments', ...payload }),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'broadcast_campaigns',
      },
      (payload) => onChange?.({ table: 'broadcast_campaigns', ...payload }),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn(`[Realtime] Erro no canal tenant-events:${activeTenantSlug}`, err);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export function shouldRefreshConversationState(event = {}) {
  return Boolean(event.handoff)
    || isInternalOperationalEvent(event)
    || ['resume_ai', 'handoff_requested', 'conversation_assigned', 'conversation_closed', 'sales_stage_changed'].includes(event.service);
}

export function createDebouncedRealtimeRefresh(refresh, delay = 800) {
  let timer = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  };
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return schedule;
}

export function subscribeToConversationReads(onChange, userId) {
  const supabase = getClient();
  if (!supabase || !userId) return () => {};

  const channel = supabase
    .channel(`conversation-reads:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_reads',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn(`[Realtime] Erro no canal conversation-reads:${userId}`, err);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function loadClientData(fallback, activeTenantSlug = defaultTenantSlug, userId = null) {
  const supabase = getClient();
  if (!supabase) {
    return {
      ...fallback,
      tenantId: fallback?.tenantId || null,
      conversationReads: fallback?.conversationReads || [],
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
  const [eventsResult, appointments, broadcastContacts, broadcastCampaigns, kanbanConfig, followUpJobs, contactAvatars, salesLeads, conversationReads, teamAgents] = await Promise.all([
    supabase
      .from('channel_events')
      .select('*')
      .eq('tenant_slug', activeTenantSlug)
      .order('created_at', { ascending: false })
      .limit(1000),
    tenant ? loadAppointments(tenant.id) : [],
    tenant ? loadBroadcastContacts(tenant.id) : [],
    tenant ? loadBroadcastCampaigns(tenant.id) : [],
    tenant ? loadKanbanConfig(tenant.id) : null,
    tenant ? loadFollowUpJobs(tenant.id, activeTenantSlug) : [],
    tenant ? loadContactAvatars(tenant.id) : [],
    tenant && isGenesisSalesTenant(activeTenantSlug) ? loadSalesLeads(tenant.id) : [],
    tenant && userId ? loadConversationReads(tenant.id, userId) : [],
    tenant ? loadTeamAgents(activeTenantSlug) : [],
  ]);
  const { data, error } = eventsResult;

  if (error) {
    throw new Error('Nao foi possivel carregar os atendimentos.');
  }

  if (!data?.length) {
    return {
      ...fallback,
      tenantId: tenant.id,
      source: 'supabase_empty',
      enabledChannels: tenantChannels,
      conversations: [],
      kanbanColumns: eventsToKanban([], activeTenantSlug, appointments, kanbanConfig, followUpJobs, salesLeads, teamAgents),
      funnelStages: emptyFunnel(),
      status: buildStatus({ source: 'supabase_empty', events: [], tenantSlug: activeTenantSlug }),
      appointments,
      broadcastContacts,
      broadcastCampaigns,
      conversationReads,
      teamAgents,
    };
  }

  const eventsWithMediaUrls = await enrichMediaUrls(
    data.map((event) => ({ ...event, raw_payload: asObject(event.raw_payload) })),
    supabase,
  );
  const avatarIndex = buildContactAvatarIndex(contactAvatars, tenant.id);
  const eventsWithAvatars = applyContactAvatars(eventsWithMediaUrls, avatarIndex, tenant.id);
  const broadcastContactsWithAvatars = applyContactAvatarsToBroadcastContacts(broadcastContacts, avatarIndex, tenant.id);

  const kanbanColumns = eventsToKanban(eventsWithAvatars, activeTenantSlug, appointments, kanbanConfig, followUpJobs, salesLeads, teamAgents);

  const conversationsWithReads = applyConversationReadState(
    eventsToConversations(eventsWithAvatars, activeTenantSlug, teamAgents, kanbanColumns),
    conversationReads,
    tenant.id,
    userId,
  );

  return {
    ...fallback,
    tenantId: tenant.id,
    source: 'supabase',
    enabledChannels: tenantChannels,
    conversations: conversationsWithReads,
    kanbanColumns,
    funnelStages: eventsToFunnel(eventsWithAvatars),
    status: buildStatus({ source: 'supabase', events: eventsWithAvatars, tenantSlug: activeTenantSlug }),
    appointments,
    broadcastContacts: broadcastContactsWithAvatars,
    broadcastCampaigns,
    conversationReads,
    teamAgents,
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

export async function loadConversationReads(tenantId, userId) {
  const supabase = getClient();
  if (!supabase || !tenantId || !userId) return [];
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('tenant_id, user_id, channel_type, external_conversation_id, last_read_event_id, last_read_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .limit(500);
  if (error) {
    console.warn('Conversation reads fallback:', error.message);
    return [];
  }
  return data || [];
}

export async function markConversationRead({ tenantId, channelType, externalConversationId, lastReadEventId }) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_tenant_id: tenantId,
    p_channel_type: normalizeChannel(channelType).type,
    p_external_conversation_id: normalizeExternalConversationId(channelType, externalConversationId),
    p_last_read_event_id: lastReadEventId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
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

async function loadFollowUpJobs(tenantId, tenantSlug) {
  // Only the tenants with a configured follow-up dashboard load this view.
  if (tenantSlug !== 'clinica_nubia_oficial' && !isGenesisSalesTenant(tenantSlug)) return [];

  const supabase = getClient();
  const { data, error } = await supabase
    .from('follow_up_jobs')
    .select('id, channel_type, external_conversation_id, contact_name, step_key, objective, due_at, status, created_at')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'processing'])
    .order('due_at', { ascending: true })
    .limit(200);

  if (error) {
    // The dashboard remains available until migration 019/020 is published.
    console.warn('Follow-up jobs unavailable:', error.message);
    return [];
  }
  return data || [];
}

export async function loadAppointmentScheduling(activeTenantSlug) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const { data, error } = await supabase.from('tenant_settings').select('settings').eq('tenant_id', tenant.id).maybeSingle();
  if (error) throw error;
  const config = data?.settings?.appointment_scheduling;
  if (!config?.enabled) return { enabled: false, tenantId: tenant.id };
  const { data: services, error: catalogError } = await supabase.from('tenant_service_catalog')
    .select('external_id,name,category').eq('tenant_id', tenant.id).eq('active', true);
  if (catalogError) throw catalogError;
  return { ...config, tenantId: tenant.id, services: services || [] };
}

export async function loadAppointmentAvailability(tenantId, unitId, serviceId, date) {
  const { data, error } = await getClient().rpc('magia_appointment_availability', {
    p_tenant: tenantId, p_unit: unitId, p_service: serviceId, p_date: date,
  });
  if (error) {
    if (error.message?.includes('SCHEDULE_NOT_CONFIGURED')) {
      return ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
    }
    throw error;
  }
  return data.available_starts;
}

export async function saveAppointment(activeTenantSlug, appointment) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const userId = await currentUserId();
  if (appointment.unitId) {
    const { data, error } = await supabase.rpc('magia_reserve_appointment', {
      p_tenant: tenant.id, p_unit: appointment.unitId, p_service: appointment.serviceId,
      p_date: appointment.localDate, p_time: appointment.localTime, p_name: appointment.contactName,
      p_chat: appointment.externalConversationId || '', p_request: appointment.requestId,
      p_channel: appointment.channelType || 'manual', p_notes: appointment.notes || null,
    });
    if (error) {
      if (error.message?.includes('SCHEDULE_NOT_CONFIGURED')) {
        const startsAt = new Date(`${appointment.localDate}T${appointment.localTime}:00`).toISOString();
        const { data: fallbackData, error: insertError } = await supabase
          .from('appointments')
          .insert({
            tenant_id: tenant.id,
            title: appointment.title || 'Agendamento',
            starts_at: startsAt,
            status: 'scheduled',
            contact_name: appointment.contactName || null,
            channel_type: appointment.channelType || 'manual',
            external_conversation_id: appointment.externalConversationId || null,
            notes: appointment.notes || null,
            created_by: userId,
            metadata: { unit_id: appointment.unitId, service_id: appointment.serviceId },
          })
          .select('*')
          .single();
        if (insertError) throw insertError;
        return mapAppointment(fallbackData);
      }
      throw error;
    }
    return mapAppointment(data);
  }
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
  if (s.includes('qualific') || s === 'qualificacao' || s === 'sales_qualifying') return 'Qualificação';
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

export async function enrichMediaUrls(events, supabase) {
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
    const cached = mediaObjectUrlCache.get(key);
    const cachedUrl = typeof cached === 'string'
      ? cached
      : (cached && cached.expiresAt > Date.now() ? cached.url : null);
    if (cachedUrl) {
      mediaUrls.set(key, cachedUrl);
      return;
    }

    if (!supabase?.storage?.from) return;
    const storageBucket = supabase.storage.from(media.bucket);

    let resolvedUrl = '';

    // 1. Preferir createSignedUrl diretamente do Storage (sem baixar Blob nem usar FileReader)
    // Seguro para bucket privado e diretamente utilizável por <img>, <audio>, <video>
    if (media.encoding !== 'base64' && typeof storageBucket?.createSignedUrl === 'function') {
      try {
        const { data: signedData, error: signedError } = await storageBucket.createSignedUrl(
          media.storagePath,
          SIGNED_URL_EXPIRES_IN
        );
        if (!signedError && signedData?.signedUrl) {
          resolvedUrl = signedData.signedUrl;
        }
      } catch (err) {
        console.warn('createSignedUrl error:', err?.message || err);
      }
    }

    // 2. Fallback de download se createSignedUrl não estiver disponível ou falhar
    if (!resolvedUrl && typeof storageBucket?.download === 'function') {
      try {
        const { data, error } = await storageBucket.download(media.storagePath);
        if (error) {
          console.warn('Media download fallback:', error.message);
          return;
        }
        if (data?.size) {
          if (media.encoding === 'base64') {
            const base64 = (await data.text()).trim();
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
              console.warn('Media download fallback: conteúdo Base64 inválido.');
              return;
            }
            resolvedUrl = `data:${media.mimeType || 'application/octet-stream'};base64,${base64}`;
          } else {
            if (media.kind === 'image' && data.type && !String(data.type).startsWith('image/')) {
              console.warn('Media download fallback: arquivo não é uma imagem válida.', data.type || 'tipo ausente');
              return;
            }
            resolvedUrl = media.kind === 'image'
              ? await blobToDataUrl(data)
              : (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(data) : '');
          }
        }
      } catch (err) {
        console.warn('Media download fallback error:', err?.message || err);
      }
    }

    if (resolvedUrl) {
      const expiresAt = Date.now() + (SIGNED_URL_EXPIRES_IN - 300) * 1000;
      mediaObjectUrlCache.set(key, { url: resolvedUrl, expiresAt });
      mediaUrls.set(key, resolvedUrl);
    }
  }));

  return events.map((event) => {
    const payload = asObject(event.raw_payload);
    const media = asObject(payload.media);
    const url = mediaUrls.get(`${media.bucket}:${media.storagePath}`);
    if (!url) return event;
    const updatedPayload = {
      ...payload,
      media: { ...media, url },
      ...(payload.magia_operator ? {
        magia_operator: {
          ...payload.magia_operator,
          media: {
            ...asObject(payload.magia_operator.media),
            url,
          },
        },
      } : {}),
    };
    return { ...event, raw_payload: updatedPayload };
  });
}

export function hasStoredMediaNeedingUrl(event) {
  if (!event) return false;
  const payload = asObject(event.raw_payload);
  const media = asObject(payload.media);
  const kind = String(media.kind || media.category || '').toLowerCase();
  if (kind === 'text' || kind === 'conversation') return false;
  if (!REAL_MEDIA_KINDS.has(kind)) return false;
  return media.status === 'stored' && Boolean(media.bucket) && Boolean(media.storagePath) && !media.url;
}

export async function enrichSingleMediaEvent(event, client) {
  if (!event || !hasStoredMediaNeedingUrl(event)) return event;
  const supabase = client || getClient();
  if (!supabase) return event;
  const [enriched] = await enrichMediaUrls([event], supabase);
  return enriched || event;
}

const locationDetailsCache = new Map();

export function normalizeLocation(rawPayload, event = null) {
  const payload = asObject(rawPayload);
  const ev = asObject(event);

  const loc = payload.locationMessage
    || payload.data?.message?.locationMessage
    || payload.message?.locationMessage
    || payload.data?.locationMessage
    || payload.location
    || payload.magia_normalized?.location
    || ev.location
    || (payload.degreesLatitude !== undefined && payload.degreesLongitude !== undefined ? payload : null)
    || (payload.latitude !== undefined && payload.longitude !== undefined ? payload : null)
    || (ev.latitude !== undefined && ev.longitude !== undefined ? ev : null);

  let lat = loc?.degreesLatitude ?? loc?.latitude ?? ev.latitude ?? null;
  let lng = loc?.degreesLongitude ?? loc?.longitude ?? ev.longitude ?? null;
  let name = String(loc?.name || ev.location_name || ev.name || '').trim();
  let address = String(loc?.address || ev.location_address || ev.address || '').trim();

  const validLat = lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : null;
  const validLng = lng != null && !Number.isNaN(Number(lng)) ? Number(lng) : null;

  if (validLat != null && validLng != null) {
    const cacheKey = `${validLat.toFixed(5)},${validLng.toFixed(5)}`;
    if (name || address) {
      locationDetailsCache.set(cacheKey, { name, address });
    } else if (locationDetailsCache.has(cacheKey)) {
      const cached = locationDetailsCache.get(cacheKey);
      if (cached.name) name = cached.name;
      if (cached.address) address = cached.address;
    }
  }

  const trimmedText = String(ev.message_text || payload.message_text || '').trim().toLowerCase();
  const isLocationText = trimmedText === '[location]'
    || trimmedText === 'location'
    || trimmedText === '[localização]'
    || trimmedText === '[localizacao]';

  const isLocationMsg = String(payload.messageType || payload.data?.messageType || ev.message_type || ev.service || '').toLowerCase().includes('location')
    || isLocationText
    || Boolean(loc);

  if (!isLocationMsg && validLat == null && validLng == null && !name && !address) {
    return null;
  }

  const mapsUrl = loc?.url || (validLat != null && validLng != null
    ? `https://www.google.com/maps?q=${validLat},${validLng}`
    : '');

  return {
    latitude: validLat,
    longitude: validLng,
    name,
    address,
    url: mapsUrl,
    isResolving: Boolean(!name && !address && validLat == null && validLng == null),
  };
}

export function normalizeMedia(rawPayload) {
  const payload = asObject(rawPayload);

  // 1. Rejeição explícita de mensagens de texto puro (evita falso-positivo de "Anexo recebido")
  const messageType = String(payload.messageType || payload.data?.messageType || '').toLowerCase();
  const operatorCategory = String(payload.magia_operator?.media?.category || '').toLowerCase();
  const magiaNormalizedCategory = String(payload.magia_normalized?.media?.category || '').toLowerCase();
  const directCategory = String(payload.media?.category || '').toLowerCase();
  const directKind = String(payload.media?.kind || '').toLowerCase();

  if (
    operatorCategory === 'text'
    || magiaNormalizedCategory === 'text'
    || directCategory === 'text'
    || directKind === 'text'
    || messageType === 'conversation'
    || messageType === 'extendedtextmessage'
  ) {
    const storedMedia = asObject(payload.media);
    const storedKind = String(storedMedia.kind || storedMedia.category || '').toLowerCase();
    if (storedMedia.status !== 'stored' || !storedMedia.storagePath || !REAL_MEDIA_KINDS.has(storedKind)) {
      return null;
    }
  }

  const operatorMedia = asObject(payload.magia_operator?.media);
  const normalized = asObject(payload.media);
  const evolutionMessage = asObject(payload.data?.message || payload.message);
  const telegramMessage = asObject(payload.telegram_update).message || {};

  // 2. Mídia de operador Mag.IA / NORIA
  if (operatorMedia.category && operatorMedia.category !== 'text') {
    const kindMap = {
      image: 'image',
      photo: 'image',
      audio: 'audio',
      ptt: 'audio',
      video: 'video',
      document: 'document',
      product: 'product',
      sticker: 'sticker',
    };
    const kind = kindMap[operatorMedia.category] || operatorMedia.category;
    if (REAL_MEDIA_KINDS.has(kind)) {
      return {
        kind,
        category: operatorMedia.category,
        caption: operatorMedia.caption || '',
        url: operatorMedia.url || '',
        fileName: operatorMedia.fileName || '',
        mimeType: operatorMedia.mimetype || '',
        size: Number(operatorMedia.fileSize || operatorMedia.size || 0),
        duration: Number(operatorMedia.seconds || 0),
      };
    }
  }

  // 3. Mídia normalizada padrão (armazenada em Supabase Storage ou canais externos)
  if (normalized.kind || normalized.category) {
    const rawKind = normalized.kind || normalized.category;
    const kind = String(rawKind).toLowerCase();
    if (REAL_MEDIA_KINDS.has(kind)) {
      return {
        kind,
        category: normalized.category || kind,
        status: normalized.status || '',
        bucket: normalized.bucket || '',
        storagePath: normalized.storagePath || '',
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
  }

  // 4. Mídia Evolution API (WhatsApp)
  if (evolutionMessage.imageMessage) {
    const img = evolutionMessage.imageMessage;
    return { kind: 'image', caption: img.caption || '', mimeType: img.mimetype || 'image/jpeg', url: img.url || '' };
  }
  if (evolutionMessage.audioMessage) {
    const aud = evolutionMessage.audioMessage;
    return { kind: 'audio', duration: Number(aud.seconds || 0), mimeType: aud.mimetype || 'audio/ogg', url: aud.url || '' };
  }
  if (evolutionMessage.videoMessage) {
    const vid = evolutionMessage.videoMessage;
    return { kind: 'video', caption: vid.caption || '', duration: Number(vid.seconds || 0), mimeType: vid.mimetype || 'video/mp4', url: vid.url || '' };
  }
  if (evolutionMessage.documentMessage) {
    const doc = evolutionMessage.documentMessage;
    return { kind: 'document', fileName: doc.fileName || 'Documento', mimeType: doc.mimetype || 'application/octet-stream', size: Number(doc.fileLength || 0), url: doc.url || '' };
  }
  if (evolutionMessage.stickerMessage) {
    const stk = evolutionMessage.stickerMessage;
    return { kind: 'sticker', mimeType: stk.mimetype || 'image/webp', url: stk.url || '' };
  }

  // 5. Mídia Telegram
  if (Array.isArray(telegramMessage.photo) && telegramMessage.photo.length) {
    const photo = telegramMessage.photo[telegramMessage.photo.length - 1] || {};
    return { kind: 'image', caption: telegramMessage.caption || '', size: Number(photo.file_size || 0) };
  }
  if (telegramMessage.voice) return { kind: 'audio', caption: telegramMessage.caption || '', duration: Number(telegramMessage.voice.duration || 0), mimeType: telegramMessage.voice.mime_type || '', size: Number(telegramMessage.voice.file_size || 0) };
  if (telegramMessage.audio) return { kind: 'audio', caption: telegramMessage.caption || '', duration: Number(telegramMessage.audio.duration || 0), fileName: telegramMessage.audio.file_name || '', mimeType: telegramMessage.audio.mime_type || '', size: Number(telegramMessage.audio.file_size || 0) };
  if (telegramMessage.video || telegramMessage.video_note || telegramMessage.animation) {
    const video = telegramMessage.video || telegramMessage.video_note || telegramMessage.animation;
    return { kind: 'video', caption: telegramMessage.caption || '', duration: Number(video.duration || 0), fileName: video.file_name || '', mimeType: video.mime_type || '', size: Number(video.file_size || 0) };
  }
  if (telegramMessage.document) return { kind: 'document', caption: telegramMessage.caption || '', fileName: telegramMessage.document.file_name || '', mimeType: telegramMessage.document.mime_type || '', size: Number(telegramMessage.document.file_size || 0) };

  return null;
}

function mediaPreview(media) {
  if (!media) return '';
  const labels = {
    image: '[imagem]',
    photo: '[imagem]',
    audio: '[audio]',
    voice: '[audio]',
    video: '[vídeo]',
    document: '[documento]',
    product: '[product]',
  };
  return media.caption || media.fileName || labels[media.kind] || labels[media.category] || `[${media.kind || 'anexo'}]`;
}

function isGeneratedMediaLabel(text) {
  return /^\[(?:Imagem|Áudio|Video|Vídeo|Arquivo|Figurinha) recebida\]$/i.test(String(text || '').trim());
}

export function getConversationActivityEpoch(conversation) {
  if (!conversation) return 0;
  const raw = conversation.lastActivityAt ?? conversation.updatedAt ?? conversation.createdAt;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string' && raw) {
    const epoch = Date.parse(raw);
    if (!Number.isNaN(epoch)) return epoch;
  }
  return 0;
}

export function sortConversationsByRecentActivity(conversations = []) {
  if (!Array.isArray(conversations)) return [];
  return [...conversations].sort((a, b) => {
    const epochA = getConversationActivityEpoch(a);
    const epochB = getConversationActivityEpoch(b);
    return epochB - epochA;
  });
}

export function normalizeExternalConversationId(channelType, externalId, fallbackHandle = '') {
  const normalizedChannel = normalizeChannel(channelType).type || 'unknown';
  const raw = String(externalId || fallbackHandle || '').trim();
  if (!raw) return '';

  if (normalizedChannel === 'whatsapp') {
    const lower = raw.toLowerCase();
    if (lower.endsWith('@s.whatsapp.net')) {
      const digits = lower.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      return digits ? `${digits}@s.whatsapp.net` : lower;
    }
    if (lower.endsWith('@g.us') || lower.endsWith('@broadcast')) {
      return lower;
    }
    const cleanDigits = raw.replace(/\D/g, '');
    if (cleanDigits.length >= 10 && cleanDigits.length <= 15) {
      return `${cleanDigits}@s.whatsapp.net`;
    }
    return lower;
  }

  return raw.toLowerCase();
}

export function canonicalConversationKey(channelType, externalConversationId, fallbackId = '', tenantSlug = '') {
  const normalizedChannel = normalizeChannel(channelType).type || 'unknown';
  const canonicalId = normalizeExternalConversationId(channelType, externalConversationId, fallbackId) || String(fallbackId || 'unknown').trim();
  const slug = String(tenantSlug || '').trim().toLowerCase();
  const tenantPrefix = slug ? `${slug}:` : '';
  return `${tenantPrefix}${normalizedChannel}::${canonicalId || 'unknown'}`;
}

// A identidade do contato pertence ao remetente inbound. Eventos outbound podem
// carregar o nome salvo no momento do envio, mas esse valor descreve o contexto
// da mensagem e nunca deve substituir a identidade do cliente.
export function getTrustedContactName(event = {}) {
  if (String(event.direction || '').toLowerCase() !== 'inbound') return '';
  if (String(event.sender_type || '').toLowerCase() !== 'contact') return '';
  return String(event.contact_name || '').trim();
}

export function isUsefulContactName(value, phone = '') {
  const name = String(value || '').trim();
  if (!name || !/\p{L}/u.test(name)) return false;

  const digits = name.replace(/\D/g, '');
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  return !normalizedPhone || digits !== normalizedPhone;
}

export function getUsefulTrustedContactName(event = {}) {
  const name = getTrustedContactName(event);
  const phone = event.contact_handle || event.external_conversation_id || '';
  return isUsefulContactName(name, phone) ? name : '';
}

export function conversationPhoneFallback(event = {}) {
  if (normalizeChannel(event.channel_type).type !== 'whatsapp') return '';
  const raw = String(event.external_conversation_id || '').trim();
  if (!raw) return '';
  const normalized = normalizeExternalConversationId('whatsapp', raw, event.contact_handle);
  const digits = String(normalized || raw)
    .replace(/@(s\.whatsapp\.net|c\.us)$/i, '')
    .split(':')[0]
    .replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}

export function resolveConversationDisplayName(event = {}, fallbackName = '') {
  return getUsefulTrustedContactName(event)
    || String(event.contact_handle || '').trim()
    || conversationPhoneFallback(event)
    || fallbackName;
}

export function conversationReadKey(tenantId, userId, channelType, externalConversationId) {
  const tenant = String(tenantId || '').trim().toLowerCase();
  const user = String(userId || '').trim().toLowerCase();
  const channel = normalizeChannel(channelType).type || 'unknown';
  const conversationId = normalizeExternalConversationId(channel, externalConversationId);
  return `${tenant}:${user}:${channel}:${conversationId || 'unknown'}`;
}

export function isUnreadInboundEvent(event = {}, { eventAlreadyPresent = false, markIncomingAsRead = false } = {}) {
  return !eventAlreadyPresent
    && !markIncomingAsRead
    && !isInternalOperationalEvent(event)
    && String(event.direction || '').toLowerCase() === 'inbound'
    && String(event.sender_type || '').toLowerCase() !== 'system';
}

export function getLatestReadableEvent(conversation = {}) {
  const readable = (conversation.messages || []).filter((message) => (
    message?.eventId
    && !String(message.eventId).endsWith('-response')
    && message?.createdAt
  ));
  return readable.reduce((latest, message) => {
    const messageAt = Date.parse(message.createdAt);
    const latestAt = Date.parse(latest?.createdAt || '');
    if (!latest || (Number.isFinite(messageAt) && (!Number.isFinite(latestAt) || messageAt >= latestAt))) {
      return message;
    }
    return latest;
  }, null);
}

export function shouldAdvanceConversationRead(marker, latestEvent) {
  if (!latestEvent?.eventId || !latestEvent?.createdAt) return false;
  if (!marker) return true;
  const markerAt = Date.parse(marker.last_read_at || '');
  const latestAt = Date.parse(latestEvent.createdAt);
  if (!Number.isFinite(markerAt) || !Number.isFinite(latestAt)) return marker.last_read_event_id !== latestEvent.eventId;
  return latestAt > markerAt
    || (latestAt === markerAt && marker.last_read_event_id !== latestEvent.eventId);
}

function isUnreadInboundMessage(message = {}, marker) {
  if (message.from !== 'contact' || !message.eventId || !message.createdAt) return false;
  if (!marker) return true;
  const messageAt = Date.parse(message.createdAt);
  const markerAt = Date.parse(marker.last_read_at || '');
  if (!Number.isFinite(messageAt) || !Number.isFinite(markerAt)) return false;
  if (messageAt > markerAt) return true;
  if (messageAt < markerAt) return false;
  // UUID não é ordenável: em empate de timestamp, somente o evento usado no
  // watermark é considerado lido. A escolha conservadora evita perder unread.
  return message.eventId !== marker.last_read_event_id;
}

export function upsertConversationReadMarker(markers = [], marker) {
  if (!marker?.tenant_id || !marker?.user_id) return Array.isArray(markers) ? markers : [];
  const key = conversationReadKey(
    marker.tenant_id,
    marker.user_id,
    marker.channel_type,
    marker.external_conversation_id,
  );
  const current = (markers || []).find((item) => conversationReadKey(
    item.tenant_id,
    item.user_id,
    item.channel_type,
    item.external_conversation_id,
  ) === key);
  const next = (markers || []).filter((item) => conversationReadKey(
    item.tenant_id,
    item.user_id,
    item.channel_type,
    item.external_conversation_id,
  ) !== key);
  if (current && !shouldAdvanceConversationRead(current, {
    eventId: marker.last_read_event_id,
    createdAt: marker.last_read_at,
  })) {
    return [...next, current];
  }
  return [...next, marker];
}

export function applyConversationReadState(conversations = [], markers = [], tenantId = '', userId = '') {
  const markerIndex = new Map();
  for (const marker of markers || []) {
    markerIndex.set(conversationReadKey(
      marker.tenant_id,
      marker.user_id,
      marker.channel_type,
      marker.external_conversation_id,
    ), marker);
  }

  return (conversations || []).map((conversation) => {
    const marker = markerIndex.get(conversationReadKey(
      tenantId,
      userId,
      conversation.channelType || conversation.channel,
      conversation.externalConversationId || conversation.normalizedExternalId,
    ));
    return {
      ...conversation,
      unread: (conversation.messages || []).filter((message) => isUnreadInboundMessage(message, marker)).length,
    };
  });
}

export function extractPayloadAvatar(event) {
  if (!event) return null;
  const payload = asObject(event.raw_payload);
  const contactAvatar = asObject(payload.contact_avatar);
  const candidate = (
    contactAvatar.avatarUrl
    || contactAvatar.avatar_url
    || payload.avatarUrl
    || payload.avatar_url
    || payload.profilePictureUrl
    || null
  );
  return normalizeAvatarUrl(candidate);
}

export function extractAvatarUrlFromEvent(event) {
  if (!event) return null;
  return extractPayloadAvatar(event) || normalizeAvatarUrl(event.avatar_url) || null;
}

export function cleanAgentName(name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();

  const technicalOrGeneric = [
    'operador noria',
    'operador mag.ia',
    'operador',
    'operador (whatsapp)',
    'operador whatsapp',
    'atendente',
    'atendente humano',
    'atendimento humano',
    'atendimento',
    'human_operator',
    'sales_operator',
    'agent',
    'system',
    'sistema',
    'bot',
    'assistente ia',
    'ia',
    'gemini',
    'disparo noria',
    'noria',
    'mag.ia',
    'sem responsavel',
    'sem responsável',
  ];
  if (technicalOrGeneric.includes(lower)) return '';

  // Identificadores técnicos com telefone, jid ou UUID
  if (/^\+?\d{8,15}(@.*)?$/.test(lower)) return '';
  if (/^[0-9a-f-]{36}$/i.test(lower)) return '';

  // Razão social / nome da empresa do WhatsApp da loja (ex: "Gênesis automóveis", "Clínica Núbia")
  if (
    lower.includes('automóveis') || lower.includes('automoveis')
    || lower.includes('veículos') || lower.includes('veiculos')
    || lower.includes('clínica') || lower.includes('clinica')
    || lower.includes('genesis') || lower.includes('gênesis')
  ) {
    return '';
  }

  return trimmed;
}

export function resolveConversationOwnerDetails(paramsOrOwner = {}, activeAgentsList = [], isHumanControlledParam = null) {
  let explicitOwner = null;
  let explicitOwnerId = null;
  let activeAgents = [];
  let isHumanControlled = null;
  let isAiControlled = null;
  let stage = null;
  let targetColumnId = null;
  let aiLocked = null;
  let handoff = null;
  let currentControlMode = null;

  if (paramsOrOwner && typeof paramsOrOwner === 'object' && !Array.isArray(paramsOrOwner) && (
    'explicitOwner' in paramsOrOwner
    || 'activeAgents' in paramsOrOwner
    || 'isHumanControlled' in paramsOrOwner
    || 'isAiControlled' in paramsOrOwner
    || 'salesLead' in paramsOrOwner
    || 'stage' in paramsOrOwner
    || 'handoff' in paramsOrOwner
    || 'aiLocked' in paramsOrOwner
    || 'salesAiLocked' in paramsOrOwner
    || 'currentControlMode' in paramsOrOwner
  )) {
    explicitOwner = paramsOrOwner.explicitOwner;
    explicitOwnerId = paramsOrOwner.explicitOwnerId || null;
    activeAgents = paramsOrOwner.activeAgents || [];
    isHumanControlled = paramsOrOwner.isHumanControlled ?? null;
    isAiControlled = paramsOrOwner.isAiControlled ?? null;
    stage = paramsOrOwner.stage || paramsOrOwner.salesStageKey || null;
    targetColumnId = paramsOrOwner.targetColumnId || null;
    aiLocked = paramsOrOwner.aiLocked ?? paramsOrOwner.salesAiLocked ?? paramsOrOwner.salesLead?.ai_locked ?? null;
    handoff = paramsOrOwner.handoff ?? null;
    currentControlMode = paramsOrOwner.currentControlMode ?? resolveSalesControlMode(
      paramsOrOwner.salesLead || (paramsOrOwner.salesStageKey ? {
        stage_key: paramsOrOwner.salesStageKey,
        ai_locked: paramsOrOwner.salesAiLocked,
      } : null),
    );
  } else {
    explicitOwner = paramsOrOwner;
    activeAgents = activeAgentsList;
    isHumanControlled = isHumanControlledParam;
  }

  // O controle comercial atual vence responsáveis e handoffs de períodos anteriores.
  if (currentControlMode === 'ai') return { name: 'Assistente IA', id: null, kind: 'ai' };
  if (currentControlMode === 'none') return { name: 'Sem responsável', id: null, kind: 'none' };
  if (currentControlMode === 'human') {
    isHumanControlled = true;
    isAiControlled = false;
  }

  // 1. RESPONSÁVEL HUMANO EXPLÍCITO
  const cleanExplicit = cleanAgentName(explicitOwner);
  if (cleanExplicit) {
    return {
      name: cleanExplicit,
      id: explicitOwnerId ? String(explicitOwnerId) : null,
      kind: 'agent',
    };
  }

  // Determinar se a conversa está sob responsabilidade humana ou se a IA está conduzindo
  const rawStage = String(stage || targetColumnId || '').trim();
  const canonicalStage = canonicalKanbanKey(rawStage);

  const humanStages = new Set([
    'sales_human',
    'com_humano',
    'conversas_humanos',
    'aguardando_humano',
  ]);

  const aiStages = new Set([
    'sales_new',
    'sales_qualifying',
    'sales_warm',
    'sales_cold',
    'sales_hot',
    'novas_conversas',
    'conversas_ia',
    'conversas_andamento',
  ]);

  const isExplicitHuman = isHumanControlled === true
    || handoff === true
    || aiLocked === true
    || humanStages.has(canonicalStage)
    || rawStage.toLowerCase().includes('humano');

  const isExplicitAi = isAiControlled === true
    || isHumanControlled === false
    || (!isExplicitHuman && aiLocked === false)
    || (!isExplicitHuman && aiStages.has(canonicalStage));

  // 2. IA CONDUZINDO A CONVERSA
  if (isExplicitAi && !isExplicitHuman) {
    return {
      name: 'Assistente IA',
      id: null,
      kind: 'ai',
    };
  }

  // 3. ATENDIMENTO HUMANO
  if (isExplicitHuman) {
    const validActiveAgents = (Array.isArray(activeAgents) ? activeAgents : [])
      .filter((agent) => {
        if (!agent) return false;
        if (typeof agent === 'object') {
          if (agent.is_active === false) return false;
          if (agent.status === 'inactive') return false;
        }
        return true;
      });

    const cleanedAgents = validActiveAgents
      .map((agent) => {
        const rawName = typeof agent === 'string' ? agent : agent?.name;
        const cleanName = cleanAgentName(rawName);
        if (!cleanName) return null;
        return {
          name: cleanName,
          id: typeof agent === 'object' && agent?.id ? String(agent.id) : null,
        };
      })
      .filter(Boolean);

    if (cleanedAgents.length === 1) {
      return {
        name: cleanedAgents[0].name,
        id: cleanedAgents[0].id,
        kind: 'agent',
      };
    }

    return {
      name: 'Sem responsável',
      id: null,
      kind: 'none',
    };
  }

  // 4. SEM RESPONSÁVEL (quando não for possível determinar IA nem humano)
  return {
    name: 'Sem responsável',
    id: null,
    kind: 'none',
  };
}

export function resolveConversationOwner(paramsOrOwner = {}, activeAgentsList = [], isHumanControlledParam = null) {
  const details = resolveConversationOwnerDetails(paramsOrOwner, activeAgentsList, isHumanControlledParam);
  return details.name;
}

export function resolveConversationHeaderOwner(conversation, matchingCard = null, activeAgents = []) {
  if (!conversation) return { name: 'Sem responsável', id: null, kind: 'none' };
  const current = matchingCard || conversation;
  const currentControlMode = resolveSalesControlMode(current.salesStageKey ? {
    stage_key: current.salesStageKey,
    ai_locked: current.salesAiLocked,
  } : null);
  const isCurrentAi = currentControlMode === 'ai' || (currentControlMode === null && (
    current.ownerKind === 'ai' || current.owner === 'Assistente IA'
  ));
  if (isCurrentAi || currentControlMode === 'none') {
    return resolveConversationOwnerDetails({ currentControlMode: isCurrentAi ? 'ai' : 'none' });
  }
  const owner = current.owner || conversation.owner;
  const ownerId = matchingCard ? matchingCard.ownerId || null : conversation.ownerId;
  const agents = Array.isArray(activeAgents) ? activeAgents : [];
  const matchedAgent = (ownerId && agents.find((agent) => String(agent.id) === String(ownerId)))
    || (cleanAgentName(owner) && agents.find((agent) => agent.name?.trim().toLowerCase() === owner.trim().toLowerCase()));
  const isHumanControlled = currentControlMode === 'human' || current.ownerKind === 'agent'
    || conversation.status === 'atendimento_humano'
    || normalizeStage(conversation.stage) === 'Atendimento humano';

  return resolveConversationOwnerDetails({
    currentControlMode,
    explicitOwner: matchedAgent?.name || (currentControlMode === 'human' ? owner : null),
    explicitOwnerId: matchedAgent?.id || ownerId,
    activeAgents: agents,
    isHumanControlled,
    isAiControlled: !isHumanControlled && (conversation.status === 'ia_ativa' || owner === 'Assistente IA'),
    stage: conversation.stage,
  });
}

export function resolveMessageSender(event = {}, fallbackOwner = '') {
  const direction = String(event.direction || '').toLowerCase();
  const senderType = String(event.sender_type || '').toLowerCase();
  const aiProvider = String(event.ai_provider || '').toLowerCase();
  const service = String(event.service || '').toLowerCase();
  const rawPayload = asObject(event.raw_payload);

  // 1. Inbound do cliente
  if (direction === 'inbound') {
    if (senderType === 'system') {
      return { type: 'system', label: 'Sistema' };
    }
    return { type: 'contact', label: 'Cliente' };
  }

  // 2. Outbound explícito de IA (nunca associar a atendente humano)
  const isExplicitAi = senderType === 'assistant'
    || ['gemini', 'openai', 'anthropic', 'ia', 'ai', 'bot'].includes(aiProvider)
    || service === 'ia_active'
    || service === 'bot_reply';

  if (isExplicitAi) {
    return { type: 'ai', label: 'IA' };
  }

  // 3. Outbound de atendente humano
  const isFromMe = Boolean(
    rawPayload?.data?.key?.fromMe
    || rawPayload?.fromMe
    || rawPayload?.magia_operator?.source === 'whatsapp_fromMe'
  );

  const isHumanAgent = [
    'agent',
    'human',
    'operator',
    'atendente',
  ].includes(senderType)
    || service === 'manual_reply'
    || aiProvider === 'human_operator'
    || isFromMe
    || Boolean(cleanAgentName(event.sent_by_user));

  if (isHumanAgent) {
    const rawSentBy = event.sent_by_user
      || rawPayload?.magia_operator?.operator_name
      || rawPayload?.assignee?.name
      || '';
    const cleanSentBy = cleanAgentName(rawSentBy);
    const cleanFallback = cleanAgentName(fallbackOwner);
    const label = cleanSentBy || cleanFallback || 'Atendente';
    return { type: 'agent', label };
  }

  if (senderType === 'system') {
    return { type: 'system', label: 'Sistema' };
  }

  // 4. Default outbound (se não for explicitamente humano, assume IA para automações de canal)
  return { type: 'ai', label: 'IA' };
}

export function resolveEventMessagePreview(event, fallbackOwner = '') {
  if (!event || isInternalOperationalEvent(event)) return null;
  const payload = asObject(event.raw_payload);
  if (event.direction === 'internal' || event.is_internal === true || payload.is_internal === true) {
    return null;
  }

  const trimmedText = String(event.message_text || '').trim().toLowerCase();
  if (trimmedText === '[secretencrypted]') {
    return null;
  }

  const service = String(event.service || '').toLowerCase();
  const isReaction = service === 'reaction'
    || String(payload?.messageType || '').toLowerCase() === 'reactionmessage'
    || String(payload?.event || '').toLowerCase() === 'messages.reaction'
    || Boolean(payload?.reaction)
    || Boolean(payload?.magia_normalized?.reaction)
    || trimmedText === 'reaction'
    || trimmedText === '[reaction]';
  if (isReaction) {
    return null;
  }

  const aiProvider = String(event.ai_provider || '').toLowerCase();
  const command = String(payload?.command || '').toLowerCase();
  const operationalIndicators = [
    'conversation_closed',
    'conversation_assigned',
    'resume_ai',
    'close_conversation',
    'assign_conversation',
    'kanban_stage_changed',
    'kanban_move',
  ];
  if (
    operationalIndicators.includes(service)
    || operationalIndicators.includes(aiProvider)
    || operationalIndicators.includes(command)
  ) {
    return null;
  }

  // Se for evento legado com resposta da IA embutida no inbound
  if (event.direction !== 'outbound' && event.response_text) {
    return {
      text: event.response_text,
      sender: 'IA',
      senderType: 'ai',
    };
  }

  const location = normalizeLocation(event.raw_payload, event);
  const isLocation = Boolean(location)
    || trimmedText === '[location]'
    || trimmedText === 'location'
    || String(payload?.messageType || '').toLowerCase() === 'locationmessage';

  let preview = '';
  if (isLocation) {
    const usefulName = location?.name || location?.address;
    preview = usefulName || 'Localização';
  } else {
    const media = normalizeMedia(event.raw_payload);
    const caption = String(media?.caption || '').trim();
    const eventText = String(event.message_text || '').trim();
    const hasRealCaption = caption && !isGeneratedMediaLabel(caption) && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase());

    let text = '';
    if (hasRealCaption) {
      text = caption;
    } else if (eventText && !isGeneratedMediaLabel(eventText)) {
      text = eventText;
    }

    preview = text || mediaPreview(media) || (event.direction === 'outbound' ? event.response_text : '') || '';
  }

  if (!preview) return null;

  const senderInfo = resolveMessageSender(event, fallbackOwner);
  return {
    text: preview,
    sender: senderInfo.label,
    senderType: senderInfo.type,
  };
}

export function eventsToConversations(events = [], tenantSlug = '', teamAgents = [], kanbanColumns = []) {
  if (!Array.isArray(events)) return [];

  const byChat = new Map();

  const preparedEvents = prepareConversationEvents(events);
  const sortedChronological = [...preparedEvents].sort((a, b) => {
    const tA = a.created_at ? Date.parse(a.created_at) : 0;
    const tB = b.created_at ? Date.parse(b.created_at) : 0;
    return (Number.isNaN(tA) ? 0 : tA) - (Number.isNaN(tB) ? 0 : tB);
  });

  for (const event of sortedChronological) {
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    // Mantém o evento em channel_events para auditoria, mas não materializa
    // operações internas como mensagens da conversa.
    if (isInternalOperationalEvent(event)) continue;

    const channelType = normalizeChannel(event.channel_type);
    const stageName = normalizeStage(event.stage);
    const resolvedTenant = tenantSlug || event.tenant_slug || '';
    const key = canonicalConversationKey(
      channelType.type,
      event.external_conversation_id,
      event.contact_handle || event.id,
      resolvedTenant,
    );
    const normalizedExtId = normalizeExternalConversationId(
      channelType.type,
      event.external_conversation_id,
      event.contact_handle,
    );
    const isHumanTransfer = Boolean(event.handoff && (normalizeStage(event.stage) === 'Atendimento humano' || event.service === 'manual_reply'));
    const isClosed = stageName === 'Finalizado' || event.service === 'conversation_closed' || event.ai_provider === 'conversation_closed';
    const payload = asObject(event.raw_payload);
    const eventAssignee = payload?.assignee;
    const initialOwner = eventAssignee?.name || payload?.assigned_to || (
      event.sent_by_user && !['Operador NORIA', 'Operador Mag.IA', 'Disparo NORIA'].includes(event.sent_by_user)
        ? event.sent_by_user
        : null
    );
    const initialOwnerId = eventAssignee?.id || payload?.assignee_id || null;

    if (!byChat.has(key)) {
      const fallbackName = `Contato ${channelType.label}`;
      const trustedContactName = getUsefulTrustedContactName(event);
      const contactName = resolveConversationDisplayName(event, fallbackName);
      const initialAvatar = extractAvatarUrlFromEvent(event);
      const initialPreview = resolveEventMessagePreview(event, initialOwner);
      byChat.set(key, {
        id: `conv-${key}`,
        canonicalKey: key,
        tenantSlug: resolvedTenant,
        normalizedExternalId: normalizedExtId,
        externalConversationId: event.external_conversation_id || normalizedExtId || key,
        contact: contactName,
        contactNameIsTrusted: Boolean(trustedContactName),
        company: event.contact_handle ? `@${event.contact_handle}` : channelType.label,
        channel: channelType.label,
        channelType: channelType.type,
        status: isClosed ? 'finalizado' : isHumanTransfer ? 'atendimento_humano' : 'ia_ativa',
        stage: stageName,
        owner: initialOwner,
        ownerId: initialOwnerId,
        unread: 0,
        lastMessage: initialPreview?.text || event.message_text || mediaPreview(normalizeMedia(event.raw_payload)) || '',
        lastMessageSender: initialPreview?.sender || null,
        lastMessageSenderType: initialPreview?.senderType || null,
        lastAt: formatDate(event.created_at),
        lastActivityAt: event.created_at || null,
        tags: [event.service, stageName].filter(Boolean),
        sentiment: sentimentFromEvent(event),
        value: estimatedValue(event),
        messages: [],
        events: [],
        avatarUrl: initialAvatar || null,
        // Ponto preparado para presença em tempo real.
        // O Supabase e as APIs de canais (ex: WhatsApp) não fornecem presença de contatos;
        // o campo permanece null para não simular um status falso de 'online'.
        presence: null,
      });
    }

    const conversation = byChat.get(key);

    // Se o contato começou com nome genérico/fallback ("Contato WhatsApp") e agora temos um contact_name real:
    const trustedContactName = getUsefulTrustedContactName(event);
    const displayName = resolveConversationDisplayName(event, `Contato ${channelType.label}`);
    if (trustedContactName && !conversation.contactNameIsTrusted) {
      conversation.contact = trustedContactName;
      conversation.contactNameIsTrusted = true;
    } else if (displayName && (!conversation.contact || conversation.contact.startsWith('Contato ') || conversation.contact === 'Contato')) {
      conversation.contact = displayName;
    }

    // Se o evento cronológico trouxer avatar válido no payload, atualiza;
    // evento posterior sem avatar NUNCA apaga avatar já conhecido.
    const candidatePayloadAvatar = extractPayloadAvatar(event);
    if (candidatePayloadAvatar) {
      conversation.avatarUrl = candidatePayloadAvatar;
    } else if (!conversation.avatarUrl && event.avatar_url) {
      conversation.avatarUrl = normalizeAvatarUrl(event.avatar_url) || conversation.avatarUrl;
    }

    const previewInfo = resolveEventMessagePreview(event, conversation.owner || initialOwner);
    if (previewInfo) {
      conversation.lastMessage = previewInfo.text;
      conversation.lastMessageSender = previewInfo.sender;
      conversation.lastMessageSenderType = previewInfo.senderType;
    }
    const media = normalizeMedia(event.raw_payload);
    const location = normalizeLocation(event.raw_payload, event);
    const text = event.message_text || media?.caption || '';
    const visibleText = media && isGeneratedMediaLabel(text) ? '' : text;
    const eventTime = event.created_at ? Date.parse(event.created_at) : NaN;
    const currentActivityTime = conversation.lastActivityAt ? Date.parse(conversation.lastActivityAt) : NaN;
    if (!Number.isNaN(eventTime) && (Number.isNaN(currentActivityTime) || eventTime >= currentActivityTime)) {
      conversation.lastActivityAt = event.created_at;
      conversation.lastAt = formatDate(event.created_at);
    } else if (!conversation.lastActivityAt && event.created_at) {
      conversation.lastActivityAt = event.created_at;
      conversation.lastAt = formatDate(event.created_at);
    }
    applyConversationLifecycle(conversation, event, stageName);
    if (isClosed) {
      conversation.owner = null;
      conversation.ownerId = null;
    } else if (initialOwner) {
      conversation.owner = initialOwner;
      conversation.ownerId = initialOwnerId;
    }
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, stageName].filter(Boolean)));
    if (event.direction === 'outbound') {
      const isOperator = ['agent', 'human', 'operator', 'atendente'].includes(event.sender_type);
      conversation.messages.push({
        from: isOperator ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
        sent_by: event.sent_by_user || (isOperator ? 'Operador' : null),
        text: visibleText || event.response_text || '',
        at: formatDate(event.created_at),
        status: event.delivery_status,
        media,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    } else {
      conversation.messages.push({
        from: 'contact',
        text: visibleText,
        at: formatDate(event.created_at),
        media,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    }
    if (event.direction !== 'outbound' && event.response_text) {
      conversation.messages.push({
        from: 'ai',
        text: event.response_text,
        at: formatDate(event.created_at),
        eventId: event.id ? `${event.id}-response` : null,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    }
    conversation.events.push(`Serviço: ${event.service || 'geral'} - Etapa: ${stageName}`);
  }

  const kanbanCardByChat = new Map();
  if (Array.isArray(kanbanColumns)) {
    for (const column of kanbanColumns) {
      for (const card of (column.cards || [])) {
        if (card.canonicalKey && !kanbanCardByChat.has(card.canonicalKey)) {
          kanbanCardByChat.set(card.canonicalKey, card);
        }
        if (card.normalizedExternalId && !kanbanCardByChat.has(card.normalizedExternalId)) {
          kanbanCardByChat.set(card.normalizedExternalId, card);
        }
        if (card.externalConversationId && !kanbanCardByChat.has(card.externalConversationId)) {
          kanbanCardByChat.set(card.externalConversationId, card);
        }
        if (card.id && !kanbanCardByChat.has(card.id)) {
          kanbanCardByChat.set(card.id, card);
        }
      }
    }
  }

  for (const conversation of byChat.values()) {
    const matchingCard = kanbanCardByChat.get(conversation.canonicalKey)
      || (conversation.normalizedExternalId && kanbanCardByChat.get(conversation.normalizedExternalId))
      || (conversation.externalConversationId && kanbanCardByChat.get(conversation.externalConversationId))
      || kanbanCardByChat.get(conversation.id);

    if (matchingCard && matchingCard.owner) {
      conversation.owner = matchingCard.owner;
      conversation.ownerId = matchingCard.ownerKind === 'ai' ? null : matchingCard.ownerId || conversation.ownerId || null;
      conversation.ownerKind = matchingCard.ownerKind || null;
      if (matchingCard.salesStageKey) {
        conversation.salesStageKey = matchingCard.salesStageKey;
        conversation.salesAiLocked = matchingCard.salesAiLocked;
        const controlMode = resolveSalesControlMode({
          stage_key: matchingCard.salesStageKey,
          ai_locked: matchingCard.salesAiLocked,
        });
        if (conversation.status !== 'finalizado' && (controlMode === 'ai' || controlMode === 'human')) {
          conversation.status = controlMode === 'ai' ? 'ia_ativa' : 'atendimento_humano';
          conversation.stage = normalizeStage(matchingCard.salesStageKey);
        }
      }
    } else {
      const isHumanControlled = conversation.status === 'atendimento_humano'
        || normalizeStage(conversation.stage) === 'Atendimento humano'
        || String(conversation.stage || '').toLowerCase().includes('humano');

      const resolvedOwner = resolveConversationOwnerDetails({
        explicitOwner: conversation.owner,
        explicitOwnerId: conversation.ownerId,
        activeAgents: teamAgents,
        isHumanControlled,
        isAiControlled: !isHumanControlled && conversation.status !== 'finalizado',
        stage: conversation.stage,
      });

      conversation.owner = resolvedOwner.name;
      conversation.ownerId = resolvedOwner.id || conversation.ownerId || null;
      conversation.ownerKind = resolvedOwner.kind;
    }
  }

  return sortConversationsByRecentActivity(Array.from(byChat.values()));
}

export function applyIncomingEventToConversations(conversations = [], event, tenantSlug = '', { markIncomingAsRead = false } = {}) {
  if (!event || isInternalOperationalEvent(event)) return conversations;
  if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) return conversations;

  const stageName = normalizeStage(event.stage);
  const channelType = normalizeChannel(event.channel_type);
  const resolvedTenant = tenantSlug || event.tenant_slug || '';
  const targetKey = canonicalConversationKey(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle || event.id,
    resolvedTenant,
  );
  const targetId = `conv-${targetKey}`;
  const normalizedIncomingExternalId = normalizeExternalConversationId(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle,
  );

  const existingIndex = (conversations || []).findIndex(
    (c) => c.id === targetId
      || (c.canonicalKey && c.canonicalKey === targetKey)
      || (normalizedIncomingExternalId && c.normalizedExternalId && c.normalizedExternalId === normalizedIncomingExternalId)
      || (event.external_conversation_id && (c.externalConversationId === event.external_conversation_id || c.normalizedExternalId === normalizedIncomingExternalId))
      || (c.id === `conv-${event.external_conversation_id}`)
      || (event.contact_handle && (c.contactHandle === event.contact_handle || c.company === `@${event.contact_handle}`)),
  );

  const media = normalizeMedia(event.raw_payload);
  const location = normalizeLocation(event.raw_payload, event);
  const text = event.message_text || media?.caption || '';
  const visibleText = media && isGeneratedMediaLabel(text) ? '' : text;
  const at = formatDate(event.created_at);
  const payload = asObject(event.raw_payload);

  if (existingIndex >= 0) {
    const prevConv = conversations[existingIndex];
    const newMessages = [...(prevConv.messages || [])];
    const incomingEventAlreadyPresent = newMessages.some((message) => event.id && message.eventId === event.id);

    if (event.direction === 'outbound') {
      const isOperator = ['agent', 'human', 'operator', 'atendente'].includes(event.sender_type);
      const msg = {
        from: isOperator ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
        sent_by: event.sent_by_user || (isOperator ? 'Operador' : null),
        text: visibleText || event.response_text || '',
        at,
        status: event.delivery_status,
        media,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      };
      const existingMsgIndex = newMessages.findIndex(
        (m) => (event.id && m.eventId === event.id) || (m.text === msg.text && m.at === at && m.from === msg.from),
      );
      if (existingMsgIndex >= 0) {
        newMessages[existingMsgIndex] = {
          ...newMessages[existingMsgIndex],
          status: event.delivery_status || newMessages[existingMsgIndex].status,
          text: msg.text || newMessages[existingMsgIndex].text,
          media: media || newMessages[existingMsgIndex].media,
          location: (location || newMessages[existingMsgIndex].location) ? {
            ...(newMessages[existingMsgIndex].location || {}),
            ...(location || {}),
          } : null,
        };
      } else {
        newMessages.push(msg);
      }
    } else {
      const msg = {
        from: 'contact',
        text: visibleText,
        at,
        media,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      };
      const existingMsgIndex = newMessages.findIndex(
        (m) => (event.id && m.eventId === event.id) || (m.text === msg.text && m.at === at && m.from === 'contact'),
      );
      if (existingMsgIndex >= 0) {
        newMessages[existingMsgIndex] = {
          ...newMessages[existingMsgIndex],
          status: event.delivery_status || newMessages[existingMsgIndex].status,
          text: msg.text || newMessages[existingMsgIndex].text,
          media: media || newMessages[existingMsgIndex].media,
          location: (location || newMessages[existingMsgIndex].location) ? {
            ...(newMessages[existingMsgIndex].location || {}),
            ...(location || {}),
          } : null,
        };
      } else {
        newMessages.push(msg);
      }

      if (event.response_text) {
        const aiMsg = {
          from: 'ai',
          text: event.response_text,
          at,
          eventId: event.id ? `${event.id}-response` : null,
          createdAt: event.created_at || null,
          sessionId: payload?.conversation_session_id || null,
        };
        const existingAiIndex = newMessages.findIndex(
          (m) => (aiMsg.eventId && m.eventId === aiMsg.eventId) || (m.text === aiMsg.text && m.at === at && m.from === 'ai'),
        );
        if (existingAiIndex < 0) {
          newMessages.push(aiMsg);
        }
      }
    }

    const eventTime = event.created_at ? Date.parse(event.created_at) : NaN;
    const currentActivityTime = prevConv.lastActivityAt ? Date.parse(prevConv.lastActivityAt) : NaN;
    const isNewer = Number.isNaN(currentActivityTime) || (!Number.isNaN(eventTime) && eventTime >= currentActivityTime);

    const incomingPreview = resolveEventMessagePreview(event, prevConv.owner);
    const shouldUpdateLastMessage = Boolean(isNewer && incomingPreview);

    // Atualiza nome de contato caso o anterior seja fallback e o novo evento traga o nome real
    const trustedContactName = getUsefulTrustedContactName(event);
    const displayName = resolveConversationDisplayName(event, `Contato ${channelType.label}`);
    const previousNameIsTrusted = prevConv.contactNameIsTrusted ?? isUsefulContactName(prevConv.contact);
    const updatedContact = trustedContactName && !previousNameIsTrusted
      ? trustedContactName
      : displayName && (!prevConv.contact || prevConv.contact.startsWith('Contato ') || prevConv.contact === 'Contato')
        ? displayName
        : prevConv.contact;

    // Atualiza avatar se o novo evento trouxer um avatar válido; caso contrário, preserva o avatar existente
    const incomingPayloadAvatar = extractPayloadAvatar(event);
    const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);
    const nextAvatarUrl = incomingPayloadAvatar
      || prevConv.avatarUrl
      || incomingEventAvatar
      || null;

    const unreadIncrement = isUnreadInboundEvent(event, {
      eventAlreadyPresent: incomingEventAlreadyPresent,
      markIncomingAsRead,
    }) ? 1 : 0;

    const updated = {
      ...prevConv,
      contact: updatedContact,
      contactNameIsTrusted: trustedContactName ? true : previousNameIsTrusted,
      avatarUrl: nextAvatarUrl,
      messages: newMessages,
      lastMessage: shouldUpdateLastMessage ? incomingPreview.text : prevConv.lastMessage,
      lastMessageSender: shouldUpdateLastMessage ? incomingPreview.sender : (prevConv.lastMessageSender || null),
      lastMessageSenderType: shouldUpdateLastMessage ? incomingPreview.senderType : (prevConv.lastMessageSenderType || null),
      lastAt: isNewer ? at : prevConv.lastAt,
      lastActivityAt: isNewer ? (event.created_at || prevConv.lastActivityAt) : prevConv.lastActivityAt,
      unread: (prevConv.unread || 0) + unreadIncrement,
    };

    applyConversationLifecycle(updated, event, stageName);

    const nextConversations = [...conversations];
    nextConversations[existingIndex] = updated;
    return sortConversationsByRecentActivity(nextConversations);
  }

  const [created] = eventsToConversations([event], resolvedTenant);
  if (created) {
    created.unread = isUnreadInboundEvent(event, { markIncomingAsRead }) ? 1 : 0;
    return sortConversationsByRecentActivity([created, ...(conversations || [])]);
  }

  return conversations;
}

export function applyIncomingEventToKanban(columns = [], event, tenantSlug = '', teamAgents = []) {
  if (!event || isInternalOperationalEvent(event) || !Array.isArray(columns)) return columns;
  const channelType = normalizeChannel(event.channel_type);
  const resolvedTenant = tenantSlug || event.tenant_slug || '';
  const canonicalKey = canonicalConversationKey(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle || event.id,
    resolvedTenant,
  );
  const conversationId = `conv-${canonicalKey}`;
  const legacyConversationId = `conv-${event.channel_type || 'unknown'}:${event.external_conversation_id || event.contact_handle || event.id}`;
  const normalizedExtId = normalizeExternalConversationId(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle,
  );
  const trimmedText = String(event.message_text || '').trim().toLowerCase();
  const service = String(event.service || '').toLowerCase();
  const payload = asObject(event.raw_payload);
  const isReaction = service === 'reaction'
    || String(payload?.messageType || '').toLowerCase() === 'reactionmessage'
    || String(payload?.event || '').toLowerCase() === 'messages.reaction'
    || Boolean(payload?.reaction)
    || Boolean(payload?.magia_normalized?.reaction)
    || trimmedText === 'reaction'
    || trimmedText === '[reaction]';
  const isSecret = trimmedText === '[secretencrypted]';

  const location = normalizeLocation(event.raw_payload, event);
  const media = normalizeMedia(event.raw_payload);
  const isLocation = Boolean(location)
    || trimmedText === '[location]'
    || trimmedText === 'location'
    || String(payload?.messageType || '').toLowerCase() === 'locationmessage';

  let text = '';
  if (isLocation) {
    text = location?.name || location?.address || 'Localização';
  } else {
    const caption = String(media?.caption || '').trim();
    const eventText = String(event.message_text || '').trim();
    const hasRealCaption = caption && !isGeneratedMediaLabel(caption) && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase());
    text = hasRealCaption ? caption : (eventText || media?.caption || '');
  }
  const lastAt = formatDate(event.created_at);

  let modified = false;
  const nextColumns = columns.map((col) => {
    let colModified = false;
    const nextCards = (col.cards || []).map((card) => {
      const matches =
        card.id === `card-${event.id}` ||
        card.id === conversationId ||
        card.id === legacyConversationId ||
        (card.canonicalKey && card.canonicalKey === canonicalKey) ||
        (normalizedExtId && card.normalizedExternalId && card.normalizedExternalId === normalizedExtId) ||
        (event.external_conversation_id && (card.externalConversationId === event.external_conversation_id || card.normalizedExternalId === normalizedExtId)) ||
        (event.contact_handle && card.contactHandle === event.contact_handle);
      if (matches) {
        colModified = true;
        modified = true;
        const incomingPayloadAvatar = extractPayloadAvatar(event);
        const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);

        const payload = asObject(event.raw_payload);
        const assignee = asObject(payload.assignee);
        const candidateAssignee = assignee.name || payload.assigned_to || (event.service === 'conversation_assigned' ? event.sent_by_user : null);
        const newAssigneeName = cleanAgentName(candidateAssignee);
        const hasExplicitAssignment = Boolean(newAssigneeName);

        const isHandoff = Boolean(event.handoff)
          || event.service === 'handoff_requested'
          || event.service === 'conversation_assigned'
          || normalizeStage(event.stage) === 'Atendimento humano'
          || payload?.kanban_transition?.to_column === 'sales_human'
          || payload?.kanban_transition?.to_column === 'com_humano'
          || payload?.kanban_transition?.to_column === 'conversas_humanos';

        let nextOwner = card.owner;
        let nextOwnerId = card.ownerId;
        let nextOwnerKind = card.ownerKind;

        if (hasExplicitAssignment) {
          nextOwner = newAssigneeName;
          nextOwnerId = assignee.id ? String(assignee.id) : null;
          nextOwnerKind = 'agent';
        } else if (isHandoff && (card.ownerKind === 'ai' || card.owner === 'Assistente IA')) {
          let activeAgents = Array.isArray(teamAgents) && teamAgents.length ? teamAgents : null;
          if (!activeAgents && typeof window !== 'undefined' && window.localStorage && resolvedTenant) {
            try {
              const cached = window.localStorage.getItem(`magia:team-agents:${resolvedTenant}`);
              if (cached) activeAgents = JSON.parse(cached);
            } catch (_) {}
          }
          const resolvedAgents = Array.isArray(activeAgents) ? activeAgents : [];
          const humanFallback = resolveConversationOwnerDetails({
            explicitOwner: null,
            activeAgents: resolvedAgents,
            isHumanControlled: true,
          });
          nextOwner = humanFallback.name;
          nextOwnerId = humanFallback.id;
          nextOwnerKind = humanFallback.kind;
        }

        return {
          ...card,
          subtitle: (isReaction || isSecret) ? card.subtitle : (text || mediaPreview(media) || card.subtitle),
          avatarUrl: incomingPayloadAvatar || card.avatarUrl || incomingEventAvatar || null,
          owner: nextOwner,
          ownerId: nextOwnerId,
          ownerKind: nextOwnerKind,
          lastAt: lastAt || card.lastAt,
          lastActivityAt: event.created_at || card.lastActivityAt,
        };
      }
      return card;
    });

    if (colModified) {
      return {
        ...col,
        cards: sortKanbanCardsByConversationActivity(nextCards),
      };
    }
    return col;
  });

  return modified ? nextColumns : columns;
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
  entrada: 'novas_conversas',
  patio: 'novas_conversas',
  patio_novos_contatos: 'novas_conversas',
  novos_contatos: 'novas_conversas',
  qualificacao: 'conversas_andamento',
  qualificação: 'conversas_andamento',
  link_enviado: 'conversas_andamento',
  agendamento_link: 'conversas_andamento',
  conversas_andamento: 'conversas_andamento',
  andamento: 'conversas_andamento',
  ativo: 'conversas_andamento',
  em_atendimento: 'conversas_andamento',
  humano: 'conversas_humanos',
  atendimento_humano: 'conversas_humanos',
  conversas_humanos: 'conversas_humanos',
  humanos: 'conversas_humanos',
  com_humano: 'conversas_humanos',
  conversas_com_humanos: 'conversas_humanos',
  handoff: 'conversas_humanos',
  agendamento: 'agendamentos',
  agendamentos: 'agendamentos',
  agendamento_confirmado: 'agendamentos',
  agenda: 'agendamentos',
  concluido: 'conversas_andamento',
  concluidos: 'conversas_andamento',
};

const GENESIS_TENANT_SLUG = 'wesley_automoveis';
const GENESIS_SALES_STAGES = [
  { key: 'sales_new', navigationLabel: 'Novos contatos' },
  { key: 'sales_qualifying', navigationLabel: 'Qualificação IA' },
  { key: 'sales_hot', navigationLabel: 'Leads quentes' },
  { key: 'sales_warm', navigationLabel: 'Leads Mornos' },
  { key: 'sales_cold', navigationLabel: 'Leads Frios' },
  { key: 'sales_human', navigationLabel: 'Atendimento humano' },
  { key: 'sales_appraisal', navigationLabel: 'Avaliação de retoma' },
  { key: 'sales_financing', navigationLabel: 'Financiamento' },
  { key: 'sales_closed', navigationLabel: 'Negócio fechado' },
  { key: 'sales_after_sales', navigationLabel: 'Pós-venda' },
];
const GENESIS_SALES_STAGE_KEYS = new Set(GENESIS_SALES_STAGES.map((stage) => stage.key));
const GENESIS_SALES_STAGE_BY_KEY = new Map(GENESIS_SALES_STAGES.map((stage, index) => [stage.key, { ...stage, index }]));

export function isGenesisSalesTenant(tenantSlug) {
  return String(tenantSlug || '').trim().toLowerCase() === GENESIS_TENANT_SLUG;
}

export function buildGenesisSalesMovePayload(leadId, stageKey, revision) {
  return {
    p_lead: leadId,
    p_stage: canonicalKanbanKey(stageKey),
    p_revision: revision,
  };
}

export function orderKanbanColumnsForTenant(columns = [], tenantSlug = '') {
  const sorted = [...columns].sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
  if (!isGenesisSalesTenant(tenantSlug)) return sorted;

  return sorted.sort((left, right) => {
    const leftIndex = GENESIS_SALES_STAGE_BY_KEY.get(canonicalKanbanKey(left.automationKey || left.id))?.index;
    const rightIndex = GENESIS_SALES_STAGE_BY_KEY.get(canonicalKanbanKey(right.automationKey || right.id))?.index;
    return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
  });
}

export function emptyKanban() {
  return OFFICIAL_KANBAN_COLUMNS.map((column) => ({ ...column, cards: [] }));
}

export function getKanbanColumnKind(column = {}) {
  const key = canonicalKanbanKey(column.automationKey || column.automation_key || column.id || '');
  if (['verificar_sinal', 'agendamentos', 'conversas_abandonadas', 'follow_ups'].includes(key)) return 'special_view';
  return 'stage';
}

// A IA somente pode permutar as chaves das colunas já existentes. Esta validação
// é executada antes de a proposta chegar à UI e antes de qualquer persistência.
export function validateKanbanOrderProposal(columns = [], proposal = {}) {
  const current = columns.map((column) => canonicalKanbanKey(
    column.automationKey || column.automation_key || column.id,
  )).filter(Boolean);
  const suggested = Array.isArray(proposal?.orderedAutomationKeys)
    ? proposal.orderedAutomationKeys.map(canonicalKanbanKey).filter(Boolean)
    : [];
  const currentSet = new Set(current);
  const suggestedSet = new Set(suggested);
  const valid = current.length > 0
    && suggested.length === current.length
    && suggestedSet.size === suggested.length
    && [...currentSet].every((key) => suggestedSet.has(key));

  return {
    valid,
    orderedAutomationKeys: valid ? suggested : [],
    reasoning: typeof proposal?.reasoning === 'string' ? proposal.reasoning.trim() : '',
  };
}

export function eventsToKanban(
  events,
  tenantSlug = 'clinica_nubia',
  appointments = [],
  kanbanConfig = null,
  followUpJobs = [],
  salesLeads = [],
  teamAgents = [],
) {
  let activeAgents = Array.isArray(teamAgents) && teamAgents.length ? teamAgents : null;
  if (!activeAgents && typeof window !== 'undefined' && window.localStorage && tenantSlug) {
    try {
      const cached = window.localStorage.getItem(`magia:team-agents:${tenantSlug}`);
      if (cached) activeAgents = JSON.parse(cached);
    } catch (_) {}
  }
  const resolvedActiveAgents = Array.isArray(activeAgents) ? activeAgents : [];

  const columns = buildKanbanColumns(kanbanConfig, tenantSlug);
  const salesLeadsByConversation = buildSalesLeadIndex(isGenesisSalesTenant(tenantSlug) ? salesLeads : []);
  const latestByChat = new Map();
  const latestConversationActivityByChat = new Map();
  const latestNamedContactByChat = new Map();
  const explicitOwnerByChat = new Map();
  const explicitOwnerIdByChat = new Map();
  const eventCountsByChat = new Map();
  const conversationStatesByChat = new Map();
  const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const eventCardsByConversation = new Map();

  for (const event of prepareConversationEvents(events).reverse()) {
    if (isKnownKanbanTestArtifact(event)) continue;
    if (isInternalOperationalEvent(event)) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    if (!conversationStatesByChat.has(key)) conversationStatesByChat.set(key, { status: 'ia_ativa' });
    applyConversationLifecycle(conversationStatesByChat.get(key), event, normalizeStage(event.stage));
  }

  // Atribuições precisam ser lidas em ordem temporal, independentemente da ordem da query.
  for (const event of [...events].sort((a, b) => compareDateLabel(a.created_at, b.created_at))) {
    if (isKnownKanbanTestArtifact(event)) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    eventCountsByChat.set(key, (eventCountsByChat.get(key) || 0) + 1);
    const current = latestByChat.get(key);
    if (!current || isMoreRecentRecord(event, current)) latestByChat.set(key, event);

    const payload = asObject(event.raw_payload);
    const assignee = asObject(payload.assignee);
    if (isGenesisSalesTenant(tenantSlug) && event.service === 'resume_ai') {
      explicitOwnerByChat.delete(key);
      explicitOwnerIdByChat.delete(key);
    }
    const candidateName = cleanAgentName(assignee.name || payload.assigned_to);
    const candidateId = assignee.id || payload.assignee_id || null;
    if (candidateName) {
      explicitOwnerByChat.set(key, candidateName);
      if (candidateId) explicitOwnerIdByChat.set(key, candidateId);
      else explicitOwnerIdByChat.delete(key);
    } else if (event.service === 'conversation_assigned' && event.sent_by_user) {
      const cleanSent = cleanAgentName(event.sent_by_user);
      if (cleanSent) {
        explicitOwnerByChat.set(key, cleanSent);
        explicitOwnerIdByChat.delete(key);
      }
    }

    // Eventos de operação determinam a etapa, mas não representam uma nova
    // mensagem da conversa. Mantemos a identidade e a recência independentes.
    if (isKanbanOperationalEvent(event)) continue;
    const currentActivity = latestConversationActivityByChat.get(key);
    if (!currentActivity || isMoreRecentRecord(event, currentActivity)) {
      latestConversationActivityByChat.set(key, event);
    }
    if (getUsefulTrustedContactName(event)) {
      const currentNamedContact = latestNamedContactByChat.get(key);
      if (!currentNamedContact || isMoreRecentRecord(event, currentNamedContact)) {
        latestNamedContactByChat.set(key, event);
      }
    }
  }

  const defaultSchedulingUrl = getTenantSchedulingLink(tenantSlug);

  for (const [key, event] of latestByChat) {
    const channelType = normalizeChannel(event.channel_type);
    const conversationState = conversationStatesByChat.get(key);
    const salesLead = salesLeadsByConversation.get(key);
    const activityEvent = latestConversationActivityByChat.get(key) || event;
    const identityEvent = latestNamedContactByChat.get(key) || activityEvent;
    const targetCandidates = resolveTenantKanbanStage({
      tenantSlug,
      salesLead,
      event,
      conversationState,
      context: {
        direction: event.direction,
        isFirstContact: (eventCountsByChat.get(key) || 0) <= 1,
      },
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

    const currentControlMode = resolveSalesControlMode(salesLead);
    const isHumanControlled = currentControlMode !== null ? currentControlMode === 'human' : (Boolean(event.handoff)
      || conversationState?.status === 'atendimento_humano'
      || normalizeStage(event.stage) === 'Atendimento humano'
      || isKanbanAssignedToHuman(event)
      || ['com_humano', 'conversas_humanos', 'aguardando_humano', 'sales_human'].includes(target));
    let aiReason = isHumanControlled ? '' : 'IA conduzindo a conversa';
    if (currentControlMode === 'none') aiReason = '';
    if (!isHumanControlled && target === 'agendamentos') {
      aiReason = 'Registro operacional do sistema';
    } else if (!isHumanControlled && target === 'verificar_sinal') {
      aiReason = 'Sinal informado pela cliente';
    } else if (!isHumanControlled && target === 'produtos_apresentados') {
      aiReason = 'Catalogo ou fotos apresentados';
    } else if (!isHumanControlled && target === 'interesse_compra') {
      aiReason = 'Cliente demonstrou interesse de compra';
    } else if (!isHumanControlled && target === 'aguardando_finalizacao') {
      aiReason = 'Aguardando finalizacao do pedido';
    } else if (!isHumanControlled && target === 'finalizadas') {
      aiReason = 'Atendimento finalizado';
    } else if (!isHumanControlled && target === 'conversas_abandonadas') {
      aiReason = 'Conversa sem encerramento recente';
    } else if (!isHumanControlled && target === 'novas_conversas') {
      aiReason = 'Primeiro contato recebido';
    }

    const chatExplicitOwner = explicitOwnerByChat.get(key)
      || cleanAgentName(asObject(event.raw_payload)?.assignee?.name)
      || cleanAgentName(asObject(event.raw_payload)?.assigned_to)
      || null;
    const chatExplicitOwnerId = explicitOwnerIdByChat.get(key)
      || asObject(event.raw_payload)?.assignee?.id
      || asObject(event.raw_payload)?.assignee_id
      || null;

    const ownerMetadata = resolveConversationOwnerDetails({
      explicitOwner: chatExplicitOwner,
      explicitOwnerId: chatExplicitOwnerId,
      currentControlMode,
      activeAgents: resolvedActiveAgents,
      isHumanControlled,
      isAiControlled: !isHumanControlled && target !== 'finalizadas',
      aiLocked: Boolean(salesLead?.ai_locked),
      handoff: Boolean(event.handoff),
      stage: salesLead?.stage_key || event.stage,
      targetColumnId: target,
    });

    const card = {
      id: `card-${event.id}`,
      canonicalKey: key,
      normalizedExternalId: normalizeExternalConversationId(channelType.type, event.external_conversation_id),
      externalConversationId: event.external_conversation_id,
      title: resolveConversationDisplayName(identityEvent, `Contato ${channelType.label}`),
      subtitle: salesFinancingSummary(salesLead, tenantSlug) || activityEvent.message_text || activityEvent.service || 'Mensagem recente',
      channel: channelType.label,
      channelType: channelType.type,
      stage: normalizeStage(salesLead?.stage_key || event.stage),
      targetColumnId: target,
      value: formatCurrency(estimatedValue(event)),
      owner: ownerMetadata.name,
      ownerId: ownerMetadata.id,
      ownerKind: ownerMetadata.kind,
      salesLeadId: salesLead?.id || null,
      salesStageKey: salesLead?.stage_key || null,
      salesRevision: Number.isInteger(salesLead?.revision) ? salesLead.revision : null,
      salesIntent: salesLead?.state?.intent || null,
      salesHot: Boolean(salesLead?.hot),
      salesAiLocked: Boolean(salesLead?.ai_locked),
      salesInterestRegistered: Boolean(salesLead?.interest_registered),
      aiReason,
      appointmentId: relatedAppointmentId,
      appointmentStatus: relatedAppointment?.status || '',
      actionType: target === 'verificar_sinal' && relatedAppointmentId ? 'confirm_signal' : '',
      schedulingLink: defaultSchedulingUrl,
      hasSchedulingLink: Boolean(defaultSchedulingUrl) && (target === 'agendamentos' || hasSchedulingSignal(event.message_text)),
      lastAt: formatDate(activityEvent.created_at),
      lastActivityAt: activityEvent.created_at || null,
      avatarUrl: extractAvatarUrlFromEvent(activityEvent) || extractAvatarUrlFromEvent(identityEvent) || null,
    };
    column.cards.push(card);
    eventCardsByConversation.set(key, { card, column, occurredAt: event.created_at });
  }

  const latestAppointmentsByConversation = new Map();
  for (const appointment of appointments.filter((item) => item.status !== 'cancelled')) {
    const key = canonicalConversationKey(
      appointment.channelType || appointment.channel_type,
      appointment.externalConversationId || appointment.external_conversation_id,
      `appointment-${appointment.id}`,
    );
    const current = latestAppointmentsByConversation.get(key);
    if (!current || isMoreRecentRecord(appointment, current)) latestAppointmentsByConversation.set(key, appointment);
  }

  const appointmentCards = [...latestAppointmentsByConversation.values()]
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
    const key = canonicalConversationKey(
      appointmentCard.channelType,
      appointmentCard.externalConversationId,
      appointmentCard.id,
    );
    const matchingEvent = eventCardsByConversation.get(key);

    if (matchingEvent) {
      const appointment = latestAppointmentsByConversation.get(key);
      if (isMoreRecentRecord(appointment, { updated_at: matchingEvent.occurredAt })) {
        matchingEvent.column.cards = matchingEvent.column.cards.filter((card) => card.id !== matchingEvent.card.id);
        const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');
        if (targetColumn) {
          const canonicalCard = mergeAppointmentCard(appointmentCard, matchingEvent.card);
          targetColumn.cards.push(canonicalCard);
          eventCardsByConversation.set(key, {
            card: canonicalCard,
            column: targetColumn,
            occurredAt: appointmentTimestamp(appointment),
          });
        }
      } else {
        Object.assign(matchingEvent.card, enrichCardWithAppointment(matchingEvent.card, appointmentCard));
      }
      continue;
    }

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

  addFollowUpCards(columns, followUpJobs, latestByChat, tenantSlug);

  for (const column of columns) {
    column.cards = sortKanbanCardsByConversationActivity(column.cards);
  }

  return columns;
}

function isKanbanOperationalEvent(event = {}) {
  if (isInternalOperationalEvent(event)) return true;
  return [
    'conversation_assigned',
    'resume_ai',
    'conversation_closed',
    'handoff_requested',
  ].includes(String(event.service || '').trim().toLowerCase());
}

export function sortKanbanCardsByConversationActivity(cards = []) {
  if (!Array.isArray(cards)) return [];
  return [...cards].sort((left, right) => {
    const leftAt = Date.parse(left?.lastActivityAt || '');
    const rightAt = Date.parse(right?.lastActivityAt || '');
    if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) return 0;
    return rightAt - leftAt;
  });
}

export async function loadContactAvatars(tenantId) {
  const supabase = getClient();
  const contactAvatarColumns = [
    'tenant_id',
    'source_channel',
    'external_handle',
    'avatar_url',
  ].join(', ');
  const { data, error } = await supabase
    .from('contacts')
    .select(contactAvatarColumns)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .not('external_handle', 'is', null)
    .limit(1000);
  if (error) {
    // A interface continua disponível mesmo se a query falhar
    console.warn('Contact avatars fallback:', error.message);
    return [];
  }
  return data || [];
}

export function contactAvatarKey(channel, externalHandle, tenantId = '') {
  const normChannel = normalizeChannel(channel).type || 'unknown';
  const normHandle = normalizeExternalConversationId(normChannel, externalHandle) || String(externalHandle || '').trim().toLowerCase();
  const tenantPrefix = tenantId ? `${String(tenantId).trim().toLowerCase()}:` : '';
  return `${tenantPrefix}${normChannel}:${normHandle}`;
}

export function normalizeAvatarUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function buildContactAvatarIndex(contacts = [], tenantId = '') {
  const index = new Map();
  const targetTenant = String(tenantId || '').trim();

  for (const contact of contacts) {
    const contactTenant = String(contact?.tenant_id || '').trim();
    if (targetTenant && contactTenant && contactTenant !== targetTenant) {
      continue;
    }
    const avatarUrl = normalizeAvatarUrl(contact?.avatar_url || contact?.avatarUrl);
    if (!avatarUrl || !contact?.external_handle) continue;

    const scopedTenant = targetTenant || contactTenant;
    if (scopedTenant) {
      index.set(contactAvatarKey(contact.source_channel, contact.external_handle, scopedTenant), avatarUrl);
    }
    index.set(contactAvatarKey(contact.source_channel, contact.external_handle), avatarUrl);
  }
  return index;
}

export function applyContactAvatars(events = [], avatarIndex, tenantId = '') {
  if (!Array.isArray(events) || !avatarIndex) return events;
  return events.map((event) => {
    const channel = event.channel_type;
    const handle = event.external_conversation_id || event.contact_handle;
    const scopedTenant = tenantId || event.tenant_id || event.tenant_slug || '';
    const avatarUrl = (scopedTenant && avatarIndex.get(contactAvatarKey(channel, handle, scopedTenant)))
      || avatarIndex.get(contactAvatarKey(channel, handle))
      || null;
    return {
      ...event,
      avatar_url: avatarUrl,
    };
  });
}

export function applyContactAvatarsToBroadcastContacts(contacts = [], avatarIndex, tenantId = '') {
  if (!Array.isArray(contacts) || !avatarIndex) return contacts;
  return contacts.map((contact) => {
    const channel = contact.channel_type || contact.channelType;
    const handle = contact.external_conversation_id || contact.externalConversationId;
    const scopedTenant = tenantId || contact.tenant_id || contact.tenantId || '';
    const avatarUrl = (scopedTenant && avatarIndex.get(contactAvatarKey(channel, handle, scopedTenant)))
      || avatarIndex.get(contactAvatarKey(channel, handle))
      || null;
    return {
      ...contact,
      avatarUrl,
    };
  });
}

export function resolveContactAvatarState({ currentFailed = false, prevUrl = null, nextUrl = null } = {}) {
  const normNext = normalizeAvatarUrl(nextUrl);
  const normPrev = normalizeAvatarUrl(prevUrl);
  const failed = normNext !== normPrev ? false : currentFailed;
  return {
    failed,
    url: failed ? null : normNext,
    shouldRenderImage: Boolean(normNext && !failed),
  };
}

function appointmentTimestamp(appointment) {
  const raw = appointment?.raw || appointment || {};
  return raw.updated_at || raw.occurred_at || raw.created_at || appointment?.updatedAt || appointment?.createdAt || '';
}

function isMoreRecentRecord(candidate, current) {
  const candidateAt = Date.parse(candidate?.created_at || appointmentTimestamp(candidate));
  const currentAt = Date.parse(current?.created_at || appointmentTimestamp(current));
  if (!Number.isFinite(candidateAt)) return false;
  if (!Number.isFinite(currentAt)) return true;
  return candidateAt > currentAt;
}

function enrichCardWithAppointment(card, appointmentCard) {
  return {
    ...card,
    appointmentId: appointmentCard.appointmentId,
    appointmentStatus: appointmentCard.appointmentStatus,
    appointmentMetadata: appointmentCard.appointmentMetadata,
    actionType: appointmentCard.actionType || card.actionType,
    hasSchedulingLink: card.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
  };
}

function mergeAppointmentCard(appointmentCard, eventCard) {
  return {
    ...appointmentCard,
    title: eventCard.title || appointmentCard.title,
    channel: eventCard.channel || appointmentCard.channel,
    channelType: eventCard.channelType || appointmentCard.channelType,
    externalConversationId: eventCard.externalConversationId || appointmentCard.externalConversationId,
    owner: eventCard.owner || appointmentCard.owner,
    ownerId: eventCard.ownerId || null,
    ownerKind: eventCard.ownerKind || null,
    schedulingLink: eventCard.schedulingLink,
    hasSchedulingLink: eventCard.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
  };
}

function addFollowUpCards(columns, followUpJobs, latestByChat, tenantSlug) {
  if (tenantSlug !== 'clinica_nubia_oficial' && !isGenesisSalesTenant(tenantSlug)) return;
  const column = findKanbanColumn(columns, 'follow_ups');
  if (!column) return;

  const nextJobByConversation = new Map();
  for (const job of followUpJobs) {
    if (!['pending', 'processing'].includes(job.status)) continue;
    const key = canonicalConversationKey(job.channel_type || 'whatsapp', job.external_conversation_id, job.id);
    if (!job.external_conversation_id) continue;
    const current = nextJobByConversation.get(key);
    // A claimed job is the active execution; otherwise show the earliest pending step.
    if (!current || (job.status === 'processing' && current.status !== 'processing')
      || (job.status === current.status && Date.parse(job.due_at) < Date.parse(current.due_at))) {
      nextJobByConversation.set(key, job);
    }
  }

  for (const [key, job] of nextJobByConversation) {
    const latestEvent = latestByChat.get(key);
    const channelType = normalizeChannel(job.channel_type);
    const label = followUpLabel(job.step_key);
    column.cards.push({
      id: `follow-up-${job.id}`,
      externalConversationId: job.external_conversation_id,
      title: job.contact_name || latestEvent?.contact_name || `Contato ${channelType.label}`,
      subtitle: job.objective || 'Retomada automática programada.',
      channel: channelType.label,
      channelType: channelType.type,
      stage: `Follow-up ${label}`,
      targetColumnId: 'follow_ups',
      owner: 'Assistente IA',
      aiReason: job.status === 'processing' ? 'IA preparando o follow-up' : 'Follow-up programado',
      followUpLabel: label,
      followUpStatus: job.status,
      followUpDueAt: job.due_at,
      isFollowUp: true,
      lastAt: formatDate(job.due_at || job.created_at),
    });
  }
}

function followUpLabel(stepKey) {
  const key = String(stepKey || '').trim().toLowerCase();
  if (key === '3h') return '3h';
  if (key === '24h' || key === '1d' || key === '1dia') return '1 dia';
  if (key === '15d' || key === '15dias') return '15 dias';
  return stepKey || 'Programado';
}

async function loadSalesLeads(tenantId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('sales_leads')
    .select('id, tenant_id, channel_type, chat_id, stage_key, ai_locked, revision, state, product, hot, interest_registered, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Sales leads fallback:', error.message);
    return [];
  }
  return data || [];
}

function isKnownKanbanTestArtifact(event) {
  return String(event?.contact_name || '').trim() === 'Test'
    && String(event?.message_text || '').trim() === 'Test kanban move';
}

export function salesFinancingSummary(lead, tenantSlug) {
  if (!isGenesisSalesTenant(tenantSlug)) return '';
  const q = lead?.state?.financing_qualification;
  if (!['deposit_30_and_financing_documents_v1','deposit_20_and_financing_documents_v2'].includes(q?.rule)) return '';
  const percent = q.rule === 'deposit_20_and_financing_documents_v2' ? 20 : 30;
  const labels = { ready: 'Entrada e documentos recebidos', documents_pending: 'Documentação pendente',
    deposit_insufficient: q.deposit_cents === 0 ? 'Sem entrada' : `Entrada abaixo de ${percent}%`, deposit_unknown: 'Entrada não informada', vehicle_pending: 'Veículo a definir' };
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const amount = Number.isSafeInteger(q.deposit_cents) ? `Entrada: ${money(q.deposit_cents)}` : '';
  const minimum = Number.isSafeInteger(q.minimum_deposit_cents) ? `Mínimo: ${money(q.minimum_deposit_cents)}` : '';
  return [labels[q.status], amount, minimum].filter(Boolean).join(' | ');
}

function buildSalesLeadIndex(salesLeads = []) {
  const index = new Map();
  for (const lead of salesLeads) {
    if (!lead?.chat_id) continue;
    const key = canonicalConversationKey(lead.channel_type, lead.chat_id, lead.id);
    const current = index.get(key);
    if (!current || isMoreRecentRecord(lead, current)) index.set(key, lead);
  }
  return index;
}

export function resolveSalesControlMode(salesLead) {
  if (!salesLead) return null;
  const stage = canonicalKanbanKey(salesLead.stage_key);
  if (salesLead.ai_locked === true || stage === 'sales_human') return 'human';
  if (salesLead.ai_locked === false && ['sales_new', 'sales_qualifying', 'sales_hot', 'sales_warm', 'sales_cold'].includes(stage)) return 'ai';
  return 'none';
}

export function resolveTenantKanbanStage({ tenantSlug, salesLead, event, conversationState, context = {} }) {
  const manualTarget = canonicalKanbanKey(event?.raw_payload?.kanban_transition?.to_column);
  if (!isGenesisSalesTenant(tenantSlug)) {
    if (manualTarget) return [manualTarget];
    if (conversationState?.status === 'atendimento_humano') return ['com_humano', 'conversas_humanos', 'aguardando_humano'];
    return pickColumn(event?.stage, event?.handoff, event?.message_text, { ...context, event });
  }

  const persistedStage = canonicalKanbanKey(salesLead?.stage_key);
  if (GENESIS_SALES_STAGE_KEYS.has(persistedStage)) return [persistedStage];

  // Sem etapa comercial persistida, sinais operacionais e o contexto do lead são
  // apenas um fallback. Uma conversa encerrada nunca se torna venda concluída.
  if (manualTarget && GENESIS_SALES_STAGE_KEYS.has(manualTarget)) return [manualTarget];
  const eventStage = canonicalKanbanKey(event?.stage);
  if (GENESIS_SALES_STAGE_KEYS.has(eventStage)) return [eventStage];
  if (salesLead?.ai_locked || conversationState?.status === 'atendimento_humano' || isKanbanWaitingHuman(event, event?.handoff)) {
    return ['sales_human'];
  }

  const intent = String(salesLead?.state?.intent || '').trim().toLowerCase();
  if (intent === 'after_sales') return ['sales_after_sales'];
  if (intent === 'sell') return ['sales_appraisal'];
  if (salesLead?.hot) return ['sales_hot'];
  if (context.isFirstContact && context.direction !== 'outbound') return ['sales_new'];

  const genericTarget = pickColumn(event?.stage, event?.handoff, event?.message_text, { ...context, event })[0];
  if (['com_humano', 'conversas_humanos', 'aguardando_humano'].includes(genericTarget)) return ['sales_human'];
  return ['sales_qualifying'];
}

function buildKanbanColumns(kanbanConfig, tenantSlug = '') {
  const configuredColumns = kanbanConfig?.columns;
  if (!Array.isArray(configuredColumns) || !configuredColumns.length) {
    return emptyKanban();
  }

  const seen = new Set();
  const columns = configuredColumns
    .slice()
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
    .map((column) => {
      const canonicalKey = (column.automation_key && canonicalKanbanKey(column.automation_key))
        || (column.name && canonicalKanbanKey(column.name))
        || canonicalKanbanKey(column.id);
      const officialColumn = OFFICIAL_KANBAN_COLUMNS.find((item) => item.automationKey === canonicalKey);
      const rawKey = column.automation_key || column.name || column.id;
      const finalKey = canonicalKey || normalizeKey(column.name) || normalizeKey(rawKey) || String(column.id);
      const colId = canonicalKey || String(column.id || column.name);
      return {
        ...(officialColumn || {}),
        ...(GENESIS_SALES_STAGE_BY_KEY.get(canonicalKey) || {}),
        id: colId,
        title: column.name || officialColumn?.title || rawKey || 'Etapa',
        automationKey: finalKey,
        boardId: column.board_id,
        boardColumnId: column.id,
        position: column.position,
        cards: [],
      };
    })
    .filter((column) => {
      const uniqueKey = column.id || column.automationKey;
      if (!uniqueKey || seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });
  return orderKanbanColumnsForTenant(columns, tenantSlug);
}

function findKanbanColumn(columns, targetKey) {
  if (!columns || !columns.length || !targetKey) return null;
  const target = canonicalKanbanKey(targetKey);
  const targetNorm = normalizeKey(targetKey);
  return columns.find((column) => (
    canonicalKanbanKey(column.automationKey) === target ||
    canonicalKanbanKey(column.automation_key) === target ||
    canonicalKanbanKey(column.id) === target ||
    canonicalKanbanKey(column.title) === target ||
    canonicalKanbanKey(column.name) === target ||
    normalizeKey(column.title) === targetNorm ||
    normalizeKey(column.name) === targetNorm ||
    String(column.id) === String(targetKey) ||
    String(column.boardColumnId) === String(targetKey)
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
  const manualTarget = canonicalKanbanKey(event?.raw_payload?.kanban_transition?.to_column);

  if (manualTarget) return [manualTarget];

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

export function ownerMetadataFromKanbanEvent(target, event, activeAgents = []) {
  const payload = asObject(event?.raw_payload);
  const assignee = asObject(payload?.assignee);
  const assigneeId = assignee?.id || payload?.assignee_id || null;
  const candidateName = assignee?.name || payload?.assigned_to || (isKanbanAssignedToHuman(event) ? event?.sent_by_user : null);

  return resolveConversationOwnerDetails({
    explicitOwner: candidateName,
    explicitOwnerId: assigneeId,
    activeAgents,
  });
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

function compareDateLabel(a, b) {
  const epochA = a ? Date.parse(a) : 0;
  const epochB = b ? Date.parse(b) : 0;
  return (Number.isNaN(epochA) ? 0 : epochA) - (Number.isNaN(epochB) ? 0 : epochB);
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

export async function updateTeamAgentStatus(agentId, newStatus, tenantSlug) {
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

export async function removeTeamAgent(agentId, tenantSlug) {
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

export async function loadTenantSettings(tenantSlug) {
  const supabase = getClient();
  if (!supabase || !tenantSlug) return null;
  const tenant = await loadTenant(tenantSlug);
  if (!tenant) return null;
  try {
    const { data, error } = await supabase
      .from('tenant_settings')
      .select('timezone, business_hours, settings')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error) {
      console.warn('Falha ao carregar tenant_settings:', error.message);
      return null;
    }
    return {
      timezone: data?.timezone || 'America/Sao_Paulo',
      businessHours: (data?.business_hours && Object.keys(data.business_hours).length > 0) ? data.business_hours : null,
      business_hours: (data?.business_hours && Object.keys(data.business_hours).length > 0) ? data.business_hours : null,
      settings: data?.settings || {},
    };
  } catch (e) {
    console.warn('Erro ao carregar tenant_settings:', e);
    return null;
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
    unitName: row.metadata?.unit_name || '',
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

async function moveGenesisSalesCard(tenantSlug, card, targetColumnKey, agentName = null, targetColObj = null) {
  const canonical = canonicalKanbanKey(targetColObj?.automationKey || targetColumnKey);
  const sourceColumn = canonicalKanbanKey(card.targetColumnId || card.salesStageKey || card.stage || '');
  const isConversationClose = canonical === 'conversation_closed';
  if (!isConversationClose && !GENESIS_SALES_STAGE_KEYS.has(canonical)) {
    throw new Error('Etapa comercial inválida para o Kanban Genesis.');
  }
  if (!isConversationClose && sourceColumn === canonical) return [];

  const conversationId = String(card.externalConversationId || card.conversationId || card.id || '');
  const channelType = normalizeChannel(card.channelType || card.channel || 'whatsapp').type;
  const nowIso = new Date().toISOString();
  const ownerName = card.ownerKind === 'agent' || card.ownerKind === 'human' ? card.owner : null;
  const targetTitle = String(targetColObj?.title || targetColumnKey || '').trim();
  const isHumanTarget = canonical === 'sales_human';
  const stage = isConversationClose ? 'Finalizada' : (targetTitle || canonical);
  const newEvent = {
    tenant_slug: tenantSlug,
    channel_type: channelType,
    external_conversation_id: conversationId,
    external_message_id: `kanban_move_${Date.now()}`,
    direction: 'internal',
    sender_type: isHumanTarget ? 'agent' : 'system',
    sent_by_user: isHumanTarget ? (agentName || ownerName || 'Atendente') : null,
    contact_name: card.title || card.contactName || 'Contato',
    message_text: isConversationClose
      ? '[Kanban] Conversa encerrada sem alteração da etapa comercial.'
      : `[Kanban] Etapa comercial alterada para: ${stage}`,
    response_text: isConversationClose ? 'Conversa encerrada no painel.' : 'Etapa comercial atualizada no painel.',
    service: isConversationClose ? 'conversation_closed' : 'sales_stage_changed',
    stage,
    handoff: isHumanTarget,
    delivery_status: 'internal',
    ai_provider: 'kanban_action',
    created_at: nowIso,
    raw_payload: {
      event_type: isConversationClose ? 'conversation_closed' : 'kanban_stage_changed',
      event_category: 'kanban',
      is_internal: true,
      ...(card.ownerId ? { assignee: { id: card.ownerId, name: ownerName || card.owner } } : {}),
      kanban_transition: {
        from_stage: card.salesStageKey || card.stage,
        to_column: isConversationClose ? card.targetColumnId : canonical,
        moved_at: nowIso,
        moved_by: agentName || ownerName || 'Operador',
      },
    },
  };

  const supabase = getClient();
  if (!supabase) return [newEvent];

  if (isConversationClose) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao encerrar a conversa.');
    newEvent.tenant_id = tenant.id;
    const { error } = await supabase.from('channel_events').insert([newEvent]);
    if (error) throw error;
    return [newEvent];
  }

  let leadId = card.salesLeadId || null;
  let revision = Number.isInteger(card.salesRevision) ? card.salesRevision : null;
  if (!leadId || revision === null) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao salvar a movimentação do Kanban.');
    const { data: lead, error: leadError } = await supabase
      .from('sales_leads')
      .select('id, revision')
      .eq('tenant_id', tenant.id)
      .eq('channel_type', channelType)
      .eq('chat_id', conversationId)
      .maybeSingle();
    if (leadError) throw leadError;
    leadId = lead?.id || null;
    revision = Number.isInteger(lead?.revision) ? lead.revision : null;
  }
  if (!leadId || revision === null) throw new Error('Lead comercial não encontrado para esta conversa.');

  const { data: updatedLead, error: moveError } = await supabase.rpc(
    'magia_sales_move',
    buildGenesisSalesMovePayload(leadId, canonical, revision),
  );
  if (moveError) throw moveError;
  if (!updatedLead?.id || updatedLead.stage_key !== canonical) {
    throw new Error('A etapa comercial não foi persistida para este lead.');
  }

  newEvent.raw_payload.sales_lead_id = updatedLead.id;
  newEvent.raw_payload.sales_stage_key = updatedLead.stage_key;
  newEvent.salesLeadId = updatedLead.id;
  newEvent.salesStageKey = updatedLead.stage_key;
  newEvent.salesRevision = Number.isInteger(updatedLead.revision) ? updatedLead.revision : null;
  newEvent.salesAiLocked = Boolean(updatedLead.ai_locked);
  return [newEvent];
}

export async function moveKanbanCard(activeTenantSlug, card, targetColumnKey, agentName = null, targetColObj = null) {
  const tenantSlug = activeTenantSlug || 'clinica_nubia';
  if (isGenesisSalesTenant(tenantSlug)) {
    return moveGenesisSalesCard(tenantSlug, card, targetColumnKey, agentName, targetColObj);
  }
  const canonical = canonicalKanbanKey(targetColObj?.automationKey || targetColumnKey);
  const targetTitle = String(targetColObj?.title || targetColObj?.name || targetColumnKey || '').toLowerCase();
  const sourceColumn = canonicalKanbanKey(card.targetColumnId || card.stage || '');

  // A mesma etapa não é uma transição e não deve criar auditoria duplicada.
  if (sourceColumn && sourceColumn === canonical) return [];

  let stage = 'Qualificacao';
  let service = 'kanban_move';
  let handoff = false;
  let senderType = 'system';
  let sentByUser = agentName || null;
  let responseText = null;

  const isHumanTarget = canonical === 'com_humano'
    || canonical === 'conversas_humanos'
    || targetTitle.includes('humano')
    || targetTitle.includes('atendente');

  const isWaitingHumanTarget = canonical === 'aguardando_humano'
    || targetTitle.includes('aguardando humano')
    || targetTitle.includes('aguardando atendimento');

  const isFinalizadasTarget = canonical === 'finalizadas'
    || targetTitle.includes('finalizada')
    || targetTitle.includes('concluida')
    || targetTitle.includes('encerrada');

  const isAgendamentosTarget = canonical === 'agendamentos'
    || targetTitle.includes('agendamento')
    || targetTitle.includes('agenda');

  const isAbandonedTarget = canonical === 'conversas_abandonadas'
    || targetTitle.includes('abandonad');

  if (isFinalizadasTarget) {
    stage = 'Finalizada';
    service = 'conversation_closed';
    handoff = false;
    responseText = 'Atendimento finalizado no painel.';
  } else if (isHumanTarget) {
    stage = 'Atendimento humano';
    service = 'conversation_assigned';
    handoff = true;
    senderType = 'agent';
    sentByUser = agentName || 'Atendente';
    responseText = `Conversa assumida por ${sentByUser}.`;
  } else if (isWaitingHumanTarget) {
    stage = 'Atendimento humano';
    service = 'handoff_requested';
    handoff = true;
    responseText = 'Aguardando atendimento humano.';
  } else if (isAgendamentosTarget) {
    stage = 'Agendamento';
    service = 'agendamento';
    handoff = true;
    responseText = 'Movido para agendamentos.';
  } else if (isAbandonedTarget) {
    stage = 'Finalizada';
    service = 'conversation_abandoned';
    handoff = false;
    responseText = 'Conversa marcada como abandonada.';
  } else {
    stage = targetColObj?.title || 'Qualificacao';
    service = 'ia_active';
    handoff = false;
    responseText = 'Retornado para atendimento da IA.';
  }

  const conversationId = String(card.externalConversationId || card.conversationId || card.id || '');
  const contactName = card.title || card.contactName || 'Contato';
  const channelType = card.channelType || card.channel || 'telegram';
  const nowIso = new Date().toISOString();

  const newEvent = {
    tenant_slug: tenantSlug,
    channel_type: channelType,
    external_conversation_id: conversationId,
    external_message_id: `kanban_move_${Date.now()}`,
    direction: 'internal',
    sender_type: senderType,
    sent_by_user: sentByUser,
    contact_name: contactName,
    message_text: `[Kanban] Etapa alterada para: ${stage}`,
    response_text: responseText,
    service,
    stage,
    handoff,
    delivery_status: 'internal',
    ai_provider: 'kanban_action',
    created_at: nowIso,
    raw_payload: {
      event_type: 'kanban_stage_changed',
      event_category: 'kanban',
      is_internal: true,
      kanban_transition: {
        from_stage: card.stage,
        to_column: canonical || targetColObj?.automationKey || targetColumnKey,
        moved_at: nowIso,
        moved_by: sentByUser || 'Operador',
      },
    },
  };

  const supabase = getClient();
  if (supabase) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao salvar a movimentação do Kanban.');
    newEvent.tenant_id = tenant.id;
    const { error } = await supabase.from('channel_events').insert([newEvent]);
    if (error) throw error;
    return [newEvent];
  }

  return [newEvent];
}

export { isEligibleForExternalOutbound, isInternalOperationalEvent };
