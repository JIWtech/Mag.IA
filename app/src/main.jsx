import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canCloseConversation } from './conversationLifecycle';
import { kanbanAgentFilterValue, KANBAN_OWNER_FILTERS, matchesKanbanOwnerFilter } from './kanbanFilters';
import { CHANNEL_OPTIONS, isTenantAuthorized } from './tenantAccess';
import { createRoot } from 'react-dom/client';
import readXlsxFile from 'read-excel-file/browser';
import { SiInstagram, SiTelegram, SiWhatsapp } from 'react-icons/si';
import {
  Mail,
  Lock,
  ArrowRight,
  AlertCircle,
  ArrowLeft,
  Bot,
  Building2,
  CalendarCheck,
  CalendarDays,
  CarFront,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  Flame,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  Globe,
  Inbox,
  FileText,
  Image as ImageIcon,
  Instagram,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Music2,
  RefreshCcw,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  Video,
  Wrench,
} from 'lucide-react';
import {
  agents,
  clientStatus,
  conversations,
  funnelStages,
  kanbanColumns,
  tenants as mockTenants,
} from './mockData';
import {
  getCurrentSession,
  isAuthRequired,
  signInWithPassword,
  signOut,
  subscribeToAuthState,
} from './authService';
import { applyKanbanFlowOrder, getIntegrationStatus, integrationTargets, requestKanbanFlowSuggestion, sendN8nCommand } from './integration';
import {
  createBroadcastCampaign,
  emptyFunnel,
  emptyKanban,
  getInitialTenantSlug,
  getTenantSchedulingLink,
  hasSupabaseConfig,
  loadAvailableTenants,
  loadClientData,
  loadTeamAgents,
  moveKanbanCard,
  isGenesisSalesTenant,
  orderKanbanColumnsForTenant,
  persistTenantSlug,
  saveAppointment,
  loadAppointmentScheduling,
  loadAppointmentAvailability,
  subscribeToClientEvents,
  shouldRefreshConversationState,
  createDebouncedRealtimeRefresh,
  resolveConversationHeaderOwner,
  updateBroadcastCampaign,
  updateBroadcastRecipient,
  upsertBroadcastContacts,
  removeTeamAgent,
  saveTeamAgent,
  updateTeamAgentStatus,
  loadTenantSettings,
  getKanbanColumnKind,
  validateKanbanOrderProposal,
  sortConversationsByRecentActivity,
  sortKanbanCardsByConversationActivity,
  applyIncomingEventToConversations,
  applyIncomingEventToKanban,
  applyConversationReadState,
  canonicalConversationKey,
  conversationReadKey,
  getLatestReadableEvent,
  markConversationRead,
  normalizeAvatarUrl,
  shouldAdvanceConversationRead,
  subscribeToConversationReads,
  upsertConversationReadMarker,
} from './dataService';
import noriaLogo from './assets/noria_logo.png';
import { NoriaSelect } from './components/NoriaSelect';
import '@fontsource-variable/manrope';
import './styles.css';

const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'conversas', label: 'Conversas', icon: MessageCircle },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'disparos', label: 'Disparos', icon: Megaphone },
  { id: 'agendamentos', label: 'Agendamentos', icon: CalendarDays },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];
const activePageStorageKey = 'magia:active-page';
const appDataCachePrefix = 'magia:app-data:';
const sessionBootstrappedKey = 'noria:session-bootstrapped';

function isSessionBootstrapped() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage?.getItem(sessionBootstrappedKey) === '1';
  } catch (e) {
    return false;
  }
}

function setSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(sessionBootstrappedKey, '1');
    }
  } catch (e) {}
}

function clearSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(sessionBootstrappedKey);
    }
  } catch (e) {}
}

function getInitialActivePage() {
  const stored = localStorage.getItem(activePageStorageKey);
  return menu.some((item) => item.id === stored) ? stored : 'dashboard';
}

function appDataSignature(value) {
  return JSON.stringify(value, (key, entry) => (
    key === 'url' || key === 'thumbnailUrl' ? undefined : entry
  ));
}

function loadCachedAppData(tenantSlug) {
  if (isAuthRequired()) return null;
  try {
    const raw = localStorage.getItem(`${appDataCachePrefix}${tenantSlug}`);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.conversations ? cached : null;
  } catch {
    return null;
  }
}

function cacheAppData(tenantSlug, data) {
  if (isAuthRequired()) return;
  try {
    const serialized = JSON.stringify(data, (key, value) => (
      key === 'url' || key === 'thumbnailUrl' ? undefined : value
    ));
    if (serialized.length <= 2_000_000) {
      localStorage.setItem(`${appDataCachePrefix}${tenantSlug}`, serialized);
    }
  } catch {
    // Cache local é opcional: quota cheia nunca deve afetar o painel.
  }
}

const statusLabels = {
  ia_ativa: 'Bot ativo',
  atendimento_humano: 'Atendimento humano',
  aguardando_cliente: 'Aguardando cliente',
  finalizada: 'Finalizada',
  finalizado: 'Finalizada',
  erro: 'Atenção',
  bloqueada: 'Bloqueada',
};


function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function getInitialAppData(tenantSlug) {
  const cached = loadCachedAppData(tenantSlug);
  if (cached) return { data: cached, ready: true };
  if (hasSupabaseConfig()) {
    return {
      data: {
        conversations: [],
        kanbanColumns: emptyKanban(),
        funnelStages: emptyFunnel(),
        source: 'supabase',
        status: {
          source: 'supabase',
          botUsername: '',
          channel: '',
          supabase: true,
          ai: 'Regras e automações',
          latestAt: 'Sincronizando...',
          humanQueue: 0,
        },
        appointments: [],
        broadcastContacts: [],
        broadcastCampaigns: [],
        conversationReads: [],
        tenantId: null,
      },
      ready: false,
    };
  }
  return {
    data: {
      conversations,
      kanbanColumns,
      funnelStages,
      source: 'mock',
      status: null,
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
      conversationReads: [],
      tenantId: null,
    },
    ready: true,
  };
}

function App() {
  const [active, setActive] = useState(getInitialActivePage);
  const [tenantSlug, setTenantSlug] = useState(getInitialTenantSlug);
  const [availableTenants, setAvailableTenants] = useState(() => {
    if (hasSupabaseConfig() || isAuthRequired()) return [];
    const initialSlug = getInitialTenantSlug();
    const found = mockTenants.find((tenant) => tenant.slug === initialSlug);
    return found ? mockTenants : [{ slug: initialSlug, name: initialSlug }, ...mockTenants];
  });
  const [session, setSession] = useState(null);
  const [tenantAccess, setTenantAccess] = useState({ userId: null, loaded: false, error: '' });
  const [dataScope, setDataScope] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(isAuthRequired());
  const [loading, setLoading] = useState(false);
  const initialSetup = useMemo(() => getInitialAppData(getInitialTenantSlug()), []);
  const [appData, setAppData] = useState(initialSetup.data);
  const [appDataReady, setAppDataReady] = useState(initialSetup.ready);
  const [agentsReady, setAgentsReady] = useState(false);

  const activeTenantSlug = tenantSlug || getInitialTenantSlug() || 'jiw';
  const selectedTenant = availableTenants.find((tenant) => tenant.slug === activeTenantSlug)
    || { slug: activeTenantSlug, name: activeTenantSlug };
  const integration = getIntegrationStatus(activeTenantSlug);
  const hasTenantAccess = !isAuthRequired()
    || isTenantAuthorized(session?.user?.id, tenantAccess, availableTenants, activeTenantSlug);
  const scopeKey = JSON.stringify([session?.user?.id || 'local', activeTenantSlug]);
  const currentScope = useRef(scopeKey);
  const kanbanMoveInFlightRef = useRef(new Set());
  const conversationViewRef = useRef({ canonicalKey: '', visible: false });
  const conversationReadTimersRef = useRef(new Map());
  currentScope.current = hasTenantAccess ? scopeKey : '';
  const allowedChannels = appData.enabledChannels || [];

  const [agentsList, setAgentsList] = useState([]);
  const [tenantSettings, setTenantSettings] = useState(null);
  const [initialConversationId, setInitialConversationId] = useState(null);
  const [prefilledAppointment, setPrefilledAppointment] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const scheduleConversationRead = useCallback((conversation) => {
    const userId = session?.user?.id || null;
    const tenantId = appData.tenantId;
    const latestEvent = getLatestReadableEvent(conversation);
    if (!tenantId || !userId || !conversation || !latestEvent?.eventId || !latestEvent?.createdAt) return;

    const channelType = conversation.channelType || conversation.channel;
    const externalConversationId = conversation.externalConversationId || conversation.normalizedExternalId;
    const key = conversationReadKey(tenantId, userId, channelType, externalConversationId);
    const knownMarker = (appData.conversationReads || []).find((marker) => conversationReadKey(
      marker.tenant_id,
      marker.user_id,
      marker.channel_type,
      marker.external_conversation_id,
    ) === key);
    if (!shouldAdvanceConversationRead(knownMarker, latestEvent)) return;

    const optimisticMarker = {
      tenant_id: tenantId,
      user_id: userId,
      channel_type: channelType,
      external_conversation_id: externalConversationId,
      last_read_event_id: latestEvent.eventId,
      last_read_at: latestEvent.createdAt,
    };
    setAppData((previous) => {
      if (!previous || previous.tenantId !== tenantId) return previous;
      const previousMarker = (previous.conversationReads || []).find((marker) => conversationReadKey(
        marker.tenant_id,
        marker.user_id,
        marker.channel_type,
        marker.external_conversation_id,
      ) === key);
      if (!shouldAdvanceConversationRead(previousMarker, latestEvent)) return previous;
      const conversationReads = upsertConversationReadMarker(previous.conversationReads || [], optimisticMarker);
      return {
        ...previous,
        conversationReads,
        conversations: applyConversationReadState(previous.conversations, conversationReads, tenantId, userId),
      };
    });

    const existingTimer = conversationReadTimersRef.current.get(key);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(async () => {
      conversationReadTimersRef.current.delete(key);
      try {
        const persistedMarker = await markConversationRead({
          tenantId,
          channelType,
          externalConversationId,
          lastReadEventId: latestEvent.eventId,
        });
        if (!persistedMarker) return;
        setAppData((previous) => {
          if (!previous || previous.tenantId !== tenantId) return previous;
          const conversationReads = upsertConversationReadMarker(previous.conversationReads || [], persistedMarker);
          return {
            ...previous,
            conversationReads,
            conversations: applyConversationReadState(previous.conversations, conversationReads, tenantId, userId),
          };
        });
      } catch (error) {
        console.warn('Nao foi possivel salvar a leitura da conversa:', error.message || error);
        refreshData({ showLoading: false });
      }
    }, 180);
    conversationReadTimersRef.current.set(key, timer);
  }, [appData.conversationReads, appData.tenantId, session?.user?.id]);

  const handleConversationViewStateChange = useCallback(({ conversation, visible } = {}) => {
    conversationViewRef.current = {
      canonicalKey: conversation?.canonicalKey || '',
      visible: Boolean(visible && conversation?.canonicalKey),
    };
    if (conversationViewRef.current.visible) scheduleConversationRead(conversation);
  }, [scheduleConversationRead]);

  useEffect(() => () => {
    for (const timer of conversationReadTimersRef.current.values()) window.clearTimeout(timer);
    conversationReadTimersRef.current.clear();
  }, [activeTenantSlug, session?.user?.id]);

  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [mobileNavOpen]);

  const handleSignOut = async () => {
    clearSessionBootstrapped();
    setAvailableTenants([]);
    setTenantAccess({ userId: null, loaded: false, error: '' });
    setDataScope('');
    setAppData(getInitialAppData('').data);
    setSession(null);
    await signOut();
  };

  const handleOpenChatFromKanban = (conversationId) => {
    setInitialConversationId(conversationId);
    setActive('conversas');
  };

  const handleOpenAppointmentFromKanban = (card) => {
    setPrefilledAppointment({
      contactName: card.title || '',
      title: card.service || card.subtitle || 'Bronzeamento',
      notes: `Agendamento via Kanban (${card.stage || 'Qualificação'})`,
      selectedConversationId: card.externalConversationId || '',
    });
    setActive('agendamentos');
  };

  const handleMoveKanbanCard = async (card, targetColumnKey, targetColObj = null) => {
    const currentColumn = String(card.targetColumnId || card.stage || '');
    if (currentColumn === targetColumnKey || (targetColObj && currentColumn === targetColObj.id)) return;

    const moveKey = [
      activeTenantSlug,
      card.channelType || card.channel || 'unknown',
      card.externalConversationId || card.conversationId || card.id,
    ].join(':');
    if (kanbanMoveInFlightRef.current.has(moveKey)) return;
    kanbanMoveInFlightRef.current.add(moveKey);

    // Atualização otimista no estado local
    setAppData((prev) => {
      if (!prev?.kanbanColumns) return prev;
      const nextColumns = prev.kanbanColumns.map((col) => {
        const filteredCards = (col.cards || []).filter((c) => c.id !== card.id);
        const colKey = col.automationKey || col.id;
        const matchesTarget =
          colKey === targetColumnKey ||
          col.id === targetColumnKey ||
          (targetColObj && (
            col.id === targetColObj.id ||
            col.automationKey === targetColObj.automationKey ||
            col.title === targetColObj.title
          ));
        if (matchesTarget) {
          return {
            ...col,
            cards: sortKanbanCardsByConversationActivity([{
              ...card,
              stage: targetColObj?.title || targetColumnKey,
              targetColumnId: col.automationKey || targetColumnKey,
            }, ...filteredCards]),
          };
        }
        return { ...col, cards: filteredCards };
      });
      return { ...prev, kanbanColumns: nextColumns };
    });

    try {
      const [persistedMove] = await moveKanbanCard(activeTenantSlug, card, targetColumnKey, null, targetColObj);
      if (persistedMove?.salesLeadId) {
        setAppData((prev) => ({
          ...prev,
          kanbanColumns: (prev?.kanbanColumns || []).map((column) => ({
            ...column,
            cards: (column.cards || []).map((currentCard) => currentCard.id === card.id
              ? {
                ...currentCard,
                salesLeadId: persistedMove.salesLeadId,
                salesStageKey: persistedMove.salesStageKey,
                salesRevision: persistedMove.salesRevision,
                salesAiLocked: persistedMove.salesAiLocked,
              }
              : currentCard),
          })),
        }));
      }
    } catch (err) {
      console.warn('Falha ao salvar movimentação de card no banco:', err);
      refreshData({ showLoading: false });
    } finally {
      kanbanMoveInFlightRef.current.delete(moveKey);
    }
  };

  const handleKanbanOrderApplied = (orderedAutomationKeys) => {
    const positions = new Map(orderedAutomationKeys.map((key, index) => [key, index]));
    setAppData((prev) => ({
      ...prev,
      kanbanColumns: [...(prev?.kanbanColumns || [])]
        .map((column) => ({ ...column, position: positions.get(column.automationKey || column.id) }))
        .sort((left, right) => left.position - right.position),
    }));
  };

  const handleFinishConversationFromKanban = async (card) => {
    if (isGenesisSalesTenant(activeTenantSlug)) {
      try {
        await moveKanbanCard(activeTenantSlug, card, 'conversation_closed');
        refreshData({ showLoading: false });
      } catch (err) {
        console.warn('Falha ao encerrar conversa do Kanban:', err);
      }
      return;
    }
    handleMoveKanbanCard(card, 'finalizadas');
  };

  useEffect(() => {
    document.title = 'NORIA';
    try {
      localStorage.removeItem('magia:team-agents');
    } catch (e) { }
  }, []);

  useEffect(() => {
    let active = true;
    if (!hasTenantAccess) return undefined;
    setAgentsReady(false);
    setAgentsList([]);
    setTenantSettings(null);
    loadTeamAgents(activeTenantSlug)
      .then((list) => {
        if (active) {
          setAgentsList(list);
          setAgentsReady(true);
        }
      })
      .catch(() => {
        if (active) setAgentsReady(true);
      });
    loadTenantSettings(activeTenantSlug)
      .then((settings) => {
        if (active) setTenantSettings(settings);
      })
      .catch((err) => {
        console.warn('Falha ao carregar configuracoes do tenant:', err);
        if (active) setTenantSettings(null);
      });
    return () => {
      active = false;
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  async function handleAddAgent(newAgent) {
    const saved = await saveTeamAgent(activeTenantSlug, newAgent);
    setAgentsList((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
  }

  async function handleToggleAgentStatus(agentId) {
    const agent = agentsList.find((ag) => ag.id === agentId);
    const newStatus = agent?.status === 'online' ? 'standby' : 'online';
    setAgentsList((prev) => prev.map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag));
    await updateTeamAgentStatus(agentId, newStatus, activeTenantSlug);
  }

  async function handleDeleteAgent(agentId) {
    setAgentsList((prev) => prev.filter((ag) => ag.id !== agentId));
    await removeTeamAgent(agentId, activeTenantSlug);
  }

  async function handleAssignAgent(conversationOrId, agent) {
    const selectedConversation = typeof conversationOrId === 'object'
      ? conversationOrId
      : appData.conversations.find((conv) => conv.id === conversationOrId);
    const conversationId = selectedConversation?.id || conversationOrId;

    setAppData((prev) => {
      const nextConversations = prev.conversations.map((conv) => {
        if (conv.id === conversationId) {
          const newMessages = [
            ...(conv.messages || []),
            {
              from: 'system',
              text: `Conversa atribuída a ${agent.name}`,
              at: 'Agora',
            },
          ];
          return {
            ...conv,
            owner: agent.name,
            ownerId: agent.id,
            ownerKind: 'agent',
            status: 'atendimento_humano',
            messages: newMessages,
          };
        }
        return conv;
      });
      const nextKanbanColumns = (prev.kanbanColumns || []).map((col) => ({
        ...col,
        cards: (col.cards || []).map((card) => {
          if (
            card.canonicalKey === selectedConversation?.canonicalKey
            || (selectedConversation?.normalizedExternalId && card.normalizedExternalId === selectedConversation.normalizedExternalId)
            || (selectedConversation?.externalConversationId && card.externalConversationId === selectedConversation.externalConversationId)
            || card.id === selectedConversation?.id
          ) {
            return {
              ...card,
              owner: agent.name,
              ownerId: agent.id,
              ownerKind: 'agent',
            };
          }
          return card;
        }),
      }));
      return {
        ...prev,
        conversations: nextConversations,
        kanbanColumns: nextKanbanColumns,
      };
    });

    setAgentsList((prev) => prev.map((ag) => ag.id === agent.id ? { ...ag, load: (ag.load || 0) + 1 } : ag));

    if (!selectedConversation) return;
    try {
      await sendN8nCommand('assign_conversation', {
        channel_type: selectedConversation.channelType || selectedConversation.channel?.toLowerCase(),
        external_conversation_id: selectedConversation.externalConversationId || selectedConversation.id.replace(/^conv-/, ''),
        contact_name: selectedConversation.contact,
        message_text: `Conversa atribuida a ${agent.name}`,
        sent_by_user: agent.name,
        assignee: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
        },
      }, activeTenantSlug);
      await refreshData();
    } catch (error) {
      console.warn('Falha ao persistir atribuicao de conversa:', error.message || error);
    }
  }

  useEffect(() => {
    if (!isAuthRequired()) return undefined;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(appDataCachePrefix) || key.startsWith('magia:team-agents')) localStorage.removeItem(key);
    }
    let mounted = true;
    getCurrentSession().then((currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
      setCheckingAuth(false);
      if (currentSession) {
        setSessionBootstrapped();
      } else {
        clearSessionBootstrapped();
      }
    });
    const unsubscribe = subscribeToAuthState((nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setSessionBootstrapped();
      } else {
        clearSessionBootstrapped();
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function refreshData({ showLoading = true } = {}) {
    if (!hasTenantAccess) return;
    const requestedScope = scopeKey;
    if (showLoading) setLoading(true);
    try {
      const data = await loadClientData({
        conversations,
        kanbanColumns,
        funnelStages,
        appointments: appData.appointments || [],
        broadcastContacts: appData.broadcastContacts || [],
        broadcastCampaigns: appData.broadcastCampaigns || [],
        conversationReads: appData.conversationReads || [],
        tenantId: appData.tenantId || null,
      }, activeTenantSlug, session?.user?.id || null);
      if (currentScope.current !== requestedScope) return;
      setLoadError('');
      cacheAppData(activeTenantSlug, data);
      setAppData((previous) => (
        appDataSignature(previous) === appDataSignature(data) ? previous : data
      ));
    } catch (error) {
      if (currentScope.current === requestedScope) setLoadError(error.message || 'Falha ao carregar os dados.');
    } finally {
      if (currentScope.current === requestedScope) {
        setAppDataReady(true);
        if (showLoading) setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (isAuthRequired() && !session) return;
    let cancelled = false;
    const userId = session?.user?.id || null;
    setTenantAccess({ userId, loaded: false, error: '' });
    loadAvailableTenants(mockTenants).then((tenantsFromDb) => {
      if (cancelled) return;
      setAvailableTenants(tenantsFromDb);
      const exists = tenantsFromDb.some((tenant) => tenant.slug === activeTenantSlug);
      if (!exists && tenantsFromDb[0]) {
        setTenantSlug(tenantsFromDb[0].slug);
        persistTenantSlug(tenantsFromDb[0].slug);
      }
      setTenantAccess({ userId, loaded: true, error: '' });
    }).catch((error) => {
      if (cancelled) return;
      setAvailableTenants([]);
      setTenantAccess({ userId, loaded: true, error: error.message });
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    localStorage.setItem(activePageStorageKey, active);
  }, [active]);

  useEffect(() => {
    if (!hasTenantAccess) return undefined;
    const userId = session?.user?.id || null;
    setDataScope(scopeKey);
    setLoadError('');
    persistTenantSlug(activeTenantSlug);
    const cached = loadCachedAppData(activeTenantSlug);
    if (cached) {
      setAppData(cached);
      setAppDataReady(true);
    } else {
      setAppData(getInitialAppData(activeTenantSlug).data);
      setAppDataReady(false);
    }
    refreshData({ showLoading: false });

    const refreshFromRealtime = createDebouncedRealtimeRefresh(() => {
      refreshData({ showLoading: false });
    });

    const unsubscribe = subscribeToClientEvents((payload) => {
      if (payload?.table === 'channel_events' && payload?.new) {
        const incomingEvent = payload.new;
        const incomingConversationKey = canonicalConversationKey(
          incomingEvent.channel_type,
          incomingEvent.external_conversation_id,
          incomingEvent.contact_handle || incomingEvent.id,
          activeTenantSlug,
        );
        const markIncomingAsRead = conversationViewRef.current.visible
          && conversationViewRef.current.canonicalKey === incomingConversationKey;
        setAppData((prev) => {
          if (!prev) return prev;
          const nextConversations = applyIncomingEventToConversations(
            prev.conversations,
            incomingEvent,
            activeTenantSlug,
            { markIncomingAsRead },
          );
          const nextKanbanColumns = applyIncomingEventToKanban(
            prev.kanbanColumns,
            incomingEvent,
            activeTenantSlug,
          );
          return {
            ...prev,
            conversations: nextConversations,
            kanbanColumns: nextKanbanColumns,
          };
        });

        if (shouldRefreshConversationState(incomingEvent)) {
          refreshFromRealtime();
        }
      } else {
        refreshFromRealtime();
      }
    }, activeTenantSlug);

    const unsubscribeConversationReads = subscribeToConversationReads((payload) => {
      const marker = payload?.new;
      if (!marker?.tenant_id || !marker?.user_id) {
        refreshFromRealtime();
        return;
      }
      setAppData((prev) => {
        if (!prev || marker.tenant_id !== prev.tenantId || marker.user_id !== userId) return prev;
        const conversationReads = upsertConversationReadMarker(prev.conversationReads || [], marker);
        return {
          ...prev,
          conversationReads,
          conversations: applyConversationReadState(prev.conversations, conversationReads, prev.tenantId, userId),
        };
      });
    }, userId);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshData({ showLoading: false });
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    // O Realtime é o mecanismo primário. Mantemos um fallback pouco frequente
    // para tabelas ainda não cobertas pela subscription, sem recarregar todo o
    // conjunto de dados a cada 10 segundos.
    const fallbackPolling = window.setInterval(() => {
      refreshData({ showLoading: false });
    }, 5 * 60 * 1000);

    return () => {
      unsubscribe();
      unsubscribeConversationReads();
      refreshFromRealtime.cancel();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(fallbackPolling);
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  const hasBootstrapped = isSessionBootstrapped();
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const authPreviewMode = urlParams?.get('auth');

  if (authPreviewMode === 'loading' || checkingAuth) {
    return <AuthShell title="Carregando NORIA..." />;
  }

  if (authPreviewMode === 'login' || authPreviewMode === '1' || (isAuthRequired() && !checkingAuth && !session)) {
    return <LoginPage />;
  }

  if (isAuthRequired() && (!tenantAccess.loaded || tenantAccess.userId !== session?.user?.id)) {
    return <AuthShell title="Verificando acesso..." />;
  }
  if (!hasTenantAccess) {
    return <AuthShell title={tenantAccess.error || 'Nenhuma empresa vinculada a esta conta'}>
      <button className="secondary-button" onClick={handleSignOut}><LogOut size={16} /> Sair</button>
    </AuthShell>;
  }
  if (dataScope !== scopeKey) return <AuthShell title="Carregando empresa..." />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={noriaLogo} alt="NORIA" className="brand-logo-img" />
        </div>

        <nav className="nav-list">
          {menu.map((item) => {
            const Icon = item.icon;
            const isSelected = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isSelected ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

      </aside>

      {mobileNavOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />
          <aside id="mobile-nav-drawer" className="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Navegação principal">
            <div className="mobile-nav-header">
              <div className="mobile-nav-brand">
                <img src={noriaLogo} alt="NORIA" className="brand-logo-img" />
                <div className="mobile-brand-text">
                  <strong>NORIA</strong>
                  <small>Inteligência em movimento</small>
                </div>
              </div>
              <button
                type="button"
                className="icon-button close-drawer-btn"
                onClick={() => setMobileNavOpen(false)}
                title="Fechar menu"
                aria-label="Fechar menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mobile-nav-list">
              {menu.map((item) => {
                const Icon = item.icon;
                const isSelected = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mobile-nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      setActive(item.id);
                      setMobileNavOpen(false);
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mobile-nav-footer">
              <small className="mobile-tenant-info"><Building2 size={13} /> {selectedTenant.name}</small>
            </div>
          </aside>
        </>
      )}

      <main className="main" style={{ position: 'relative' }}>
        <div className={`refresh-progress-bar ${loading ? 'active' : ''}`} />
        {loadError && <div className="inline-error" role="alert">{loadError}</div>}
        <header className="topbar">
          <div className="topbar-brand-block kanban-title-block">
            <div className="topbar-title-row">
              <button
                type="button"
                className="mobile-menu-btn icon-button"
                onClick={() => setMobileNavOpen(true)}
                title="Menu"
                aria-label="Abrir navegação"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-nav-drawer"
              >
                <Menu size={18} />
              </button>
              <span className="kanban-title-accent" aria-hidden="true" />
              <h1>{menu.find((item) => item.id === active)?.label}</h1>
            </div>
            <div className="kanban-title-context page-context">
              <div className="page-context-tenant">
                <Building2 size={14} aria-hidden="true" />
                <strong>{selectedTenant.name}</strong>
              </div>
              {selectedTenant.industry && (
                <div className="page-context-segment">{selectedTenant.industry}</div>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <NoriaSelect
              value={activeTenantSlug}
              onValueChange={setTenantSlug}
              options={availableTenants.map((tenant) => ({
                value: tenant.slug,
                label: tenant.name,
              }))}
              ariaLabel="Selecionar empresa"
              icon={Building2}
              title={selectedTenant.name}
            />
            <div className="topbar-utility-buttons">
              <button className="icon-button" type="button" title="Atualizar" aria-label="Atualizar" onClick={refreshData}>
                <RefreshCcw size={17} className={loading ? 'spin' : ''} />
              </button>
              {isAuthRequired() && (
                <button className="secondary-button logout-btn" type="button" title="Sair" aria-label="Sair" onClick={handleSignOut}>
                  <LogOut size={16} />
                  <span className="logout-text">Sair</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {active === 'dashboard' && (
          <Dashboard
            conversations={appData.conversations}
            dataSource={appData.source}
            status={appData.status}
            ready={appDataReady}
            onOpenConversation={handleOpenChatFromKanban}
          />
        )}
        {active === 'conversas' && (
          <Conversations
            allowedChannels={allowedChannels}
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onSent={refreshData}
            agentsList={agentsList}
            agentsReady={agentsReady}
            onAssignAgent={handleAssignAgent}
            initialConversationId={initialConversationId}
            onInitialConversationOpened={() => setInitialConversationId(null)}
            onNavigateSettings={() => setActive('configuracoes')}
            onConversationViewStateChange={handleConversationViewStateChange}
            ready={appDataReady}
            kanbanColumns={appData.kanbanColumns}
          />
        )}
        {active === 'kanban' && (
          <Kanban
            allowedChannels={allowedChannels}
            kanbanColumns={appData.kanbanColumns}
            tenantName={selectedTenant.name}
            agentsList={agentsList}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            onOpenChat={handleOpenChatFromKanban}
            onOpenAppointment={handleOpenAppointmentFromKanban}
            onMoveCard={handleMoveKanbanCard}
            onOrderApplied={handleKanbanOrderApplied}
            onFinishConversation={handleFinishConversationFromKanban}
            ready={appDataReady}
          />
        )}
        {active === 'funil' && <Funnel funnelStages={appData.funnelStages} tenantName={selectedTenant.name} ready={appDataReady} />}
        {active === 'disparos' && (
          <Broadcasts
            allowedChannels={allowedChannels}
            conversations={appData.conversations}
            contacts={appData.broadcastContacts || []}
            campaigns={appData.broadcastCampaigns || []}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            ready={appDataReady}
          />
        )}
        {active === 'agendamentos' && (
          <Appointments
            appointments={appData.appointments || []}
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            initialData={prefilledAppointment}
            ready={appDataReady}
          />
        )}
        {active === 'configuracoes' && (
          <SettingsPage
            allowedChannels={allowedChannels}
            agents={agentsList}
            agentsReady={agentsReady}
            onAddAgent={handleAddAgent}
            onToggleAgentStatus={handleToggleAgentStatus}
            onDeleteAgent={handleDeleteAgent}
            tenant={selectedTenant}
            tenantName={selectedTenant.name}
            tenantSettings={tenantSettings}
            tenantSlug={activeTenantSlug}
            integration={integration}
          />
        )}
      </main>
    </div>
  );
}

function formatConversationPreview(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (lower === '/reset' || lower === 'reset') {
    return 'Conversa reiniciada';
  }
  return text;
}

function getConversationLastMessageOrigin(item) {
  if (!item) return null;
  if (item.lastMessageSender) return item.lastMessageSender;
  const messages = item.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
      if (lastMsg.from === 'ai' || lastMsg.sender_type === 'bot') return 'IA';
      if (lastMsg.from === 'agent' || lastMsg.sender_type === 'agent') {
        return lastMsg.sent_by || item.owner || 'Atendente';
      }
      if (lastMsg.from === 'system' || lastMsg.sender_type === 'system') return 'Sistema';
      if (lastMsg.from === 'contact' || lastMsg.sender_type === 'contact') return 'Cliente';
    }
  }
  return null;
}

function Dashboard({ conversations = [], dataSource, status, ready = true, onOpenConversation }) {
  const [isMobileRecentList, setIsMobileRecentList] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  ));
  const [visibleCount, setVisibleCount] = useState(() => (isMobileRecentList ? 5 : 10));
  const recentConversationsListRef = useRef(null);
  const recentConversationsSentinelRef = useRef(null);

  const sortedConversations = useMemo(() => {
    return sortConversationsByRecentActivity(conversations);
  }, [conversations]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncRecentListMode = (event) => setIsMobileRecentList(event.matches);
    mediaQuery.addEventListener('change', syncRecentListMode);
    return () => mediaQuery.removeEventListener('change', syncRecentListMode);
  }, []);

  useEffect(() => {
    setVisibleCount(isMobileRecentList ? 5 : 10);
  }, [conversations, isMobileRecentList]);

  useEffect(() => {
    const sentinel = recentConversationsSentinelRef.current;
    const list = recentConversationsListRef.current;
    if (!ready || !isMobileRecentList || visibleCount >= sortedConversations.length || !sentinel || !list) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisibleCount((current) => Math.min(current + 5, sortedConversations.length));
      observer.disconnect();
    }, { root: list, rootMargin: '0px 0px 96px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isMobileRecentList, ready, sortedConversations.length, visibleCount]);

  const stats = useMemo(() => {
    const activeBot = conversations.filter((item) => item.status === 'ia_ativa').length;
    const human = conversations.filter((item) => item.status === 'atendimento_humano').length;

    return [
      {
        id: 'conversas',
        label: 'Conversas',
        value: conversations.length.toString(),
        icon: Inbox,
      },
      {
        id: 'bot',
        label: 'Bot ativo',
        value: activeBot.toString(),
        icon: Bot,
      },
      {
        id: 'human',
        label: 'Em atendimento humano',
        value: human.toString(),
        icon: UsersRound,
      },
    ];
  }, [conversations]);

  function handleTableScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 30) {
      setVisibleCount((prev) => Math.min(prev + 5, sortedConversations.length));
    }
  }

  const displayedConversations = useMemo(() => {
    return sortedConversations.slice(0, visibleCount);
  }, [sortedConversations, visibleCount]);

  return (
    <section className="dashboard-page">
      <div className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`metric-card metric-card-${stat.id}`} key={stat.id || stat.label}>
              <div className="metric-icon">
                <Icon size={22} />
              </div>
              <div className="metric-info">
                <span className="metric-label">{stat.label}</span>
                <div className="metric-value-wrap">
                  {ready ? (
                    <strong className="metric-value">{stat.value}</strong>
                  ) : (
                    <div className="metric-skeleton-value skeleton-block" />
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="dashboard-main-grid">
        {/* COLUNA ESQUERDA (~74%): Conversas recentes (Painel Principal Dominante) */}
        <section className="panel dashboard-conversations-panel">
          <PanelTitle
            icon={MessageCircle}
            title="Conversas recentes"
            action={ready ? `${displayedConversations.length} de ${sortedConversations.length}` : '—'}
          />
          <div className="table scrollable-table dashboard-table">
            <div className="table-head">
              <span>Contato</span>
              <span>Canal</span>
              <span>Status</span>
              <span>Etapa</span>
              <span>Responsável</span>
              <span>Última mensagem</span>
              <span className="th-time">Horário</span>
              <span className="th-action">Ação</span>
            </div>
            <div className="table-body" ref={recentConversationsListRef} onScroll={isMobileRecentList ? undefined : handleTableScroll}>
              {!ready ? (
                [1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div className="table-row table-row-skeleton" key={i}>
                    <div className="table-contact-cell">
                      <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%', flexShrink: 0 }} />
                      <div className="table-contact-info">
                        <SkeletonLine width="95px" />
                        <SkeletonLine width="60px" style={{ marginTop: '4px' }} />
                      </div>
                    </div>
                    <SkeletonLine width="65px" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <SkeletonBlock width="7px" height="7px" style={{ borderRadius: '50%' }} />
                      <SkeletonLine width="75px" />
                    </div>
                    <SkeletonLine width="80px" />
                    <SkeletonLine width="90px" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <SkeletonLine width="60px" height="10px" />
                      <SkeletonLine width="160px" />
                    </div>
                    <SkeletonLine width="55px" style={{ justifySelf: 'end' }} />
                    <SkeletonBlock width="54px" height="26px" style={{ borderRadius: '6px', justifySelf: 'end' }} />
                  </div>
                ))
              ) : (
                <>
                  {displayedConversations.map((item) => {
                    const messageOrigin = getConversationLastMessageOrigin(item);
                    const channel = item.channelType || item.channel;
                    return (
                      <div className="table-row" key={item.id}>
                        <div className="table-contact-cell">
                          <div className="conversation-avatar-wrapper compact">
                            <ContactAvatar name={item.contact} avatarUrl={item.avatarUrl} />
                          </div>
                          <div className="table-contact-info">
                            <strong className="contact-name">{item.contact}</strong>
                            {item.company && item.company.startsWith('@') && (
                              <small className="contact-handle">{item.company}</small>
                            )}
                          </div>
                        </div>

                        <div className="table-channel-cell">
                          <div className={`channel-indicator ${getChannelClass(channel)}`}>
                            <ChannelIcon channel={channel} size={15} />
                            <span className="channel-name">{item.channel}</span>
                          </div>
                        </div>

                        <div className={`dashboard-status-indicator status-${item.status}`}>
                          <span className="status-dot" aria-hidden="true" />
                          <span className="status-label">{statusLabels[item.status] || item.status}</span>
                        </div>

                        <span className="stage-pill-text">{item.stage}</span>

                        <span className="owner-text">{item.owner}</span>

                        <div className="dashboard-message-cell">
                          {messageOrigin && <span className="message-origin-label">{messageOrigin}</span>}
                          <span className="message-preview-text" title={item.lastMessage}>
                            {formatConversationPreview(item.lastMessage)}
                          </span>
                        </div>

                        <small className="timestamp-text">{item.lastAt}</small>

                        <div className="table-action-cell">
                          <button
                            type="button"
                            className="dashboard-action-btn"
                            onClick={() => onOpenConversation?.(item.id || item.externalConversationId)}
                            title={`Abrir conversa com ${item.contact}`}
                            aria-label={`Abrir conversa com ${item.contact}`}
                          >
                            <span>Abrir</span>
                            <ExternalLink size={12} className="action-icon" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {isMobileRecentList && displayedConversations.length < sortedConversations.length && (
                    <div className="dashboard-recent-conversations-sentinel" ref={recentConversationsSentinelRef} aria-hidden="true" />
                  )}
                  {!sortedConversations.length && (
                    <EmptyState
                      title="Nenhuma conversa real ainda"
                      text="Nenhuma conversa recebida."
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </section>

      </div>
    </section>
  );
}

function ChannelIcon({ channel, size = 14 }) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('insta')) {
    return <Instagram size={size} />;
  }
  if (type.includes('whats') || type.includes('zap')) {
    return <SiWhatsapp size={size} aria-hidden="true" />;
  }
  if (type.includes('telegram')) {
    return <Send size={size} />;
  }
  return <Globe size={size} />;
}

function getInitials(name) {
  if (!name) return 'C';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function ContactAvatar({ name, avatarUrl, className = 'conversation-avatar' }) {
  const [failed, setFailed] = useState(false);
  const validUrl = normalizeAvatarUrl(avatarUrl);

  useEffect(() => {
    setFailed(false);
  }, [validUrl]);

  if (validUrl && !failed) {
    return (
      <div className={`${className} has-image`}>
        <img
          src={validUrl}
          alt={name ? `Foto de perfil de ${name}` : ''}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return <div className={className}>{getInitials(name)}</div>;
}

function getChannelClass(channel) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('whats') || type.includes('zap')) return 'channel-whatsapp';
  if (type.includes('insta')) return 'channel-instagram';
  if (type.includes('telegram')) return 'channel-telegram';
  return 'channel-webchat';
}

function ContactAvatarBadge({ channel, presence = null }) {
  const channelType = channel || 'whatsapp';
  const channelClass = getChannelClass(channelType);
  const channelLabel = String(channelType).toLowerCase().includes('telegram')
    ? 'Telegram'
    : String(channelType).toLowerCase().includes('insta')
      ? 'Instagram'
      : 'WhatsApp';

  // Nota de integridade de dados:
  // O Supabase e as APIs/webhooks de mensageria (ex: WhatsApp) não fornecem dados de presença
  // de contatos (online/offline). O indicador visual atua como um pip discreto (6–8px) indicando
  // o canal de atendimento de origem sem fingir que o contato está online.
  // Caso futuramente seja conectada uma fonte de presença real, os estados 'online' e 'offline'
  // já estão prontos estruturalmente.
  const title = presence === 'online'
    ? 'Contato online'
    : presence === 'offline'
      ? 'Contato offline'
      : `Canal: ${channelLabel}`;

  const presenceClass = presence === 'online'
    ? 'presence-online'
    : presence === 'offline'
      ? 'presence-offline'
      : 'presence-unknown';

  return (
    <span
      className={`channel-avatar-badge ${channelClass} ${presenceClass}`}
      title={title}
      aria-label={title}
      role="status"
    />
  );
}

function MediaAttachment({ media, onMediaLoad }) {
  const [expandedImage, setExpandedImage] = useState(false);
  const config = {
    image: { label: 'Imagem recebida', icon: ImageIcon },
    audio: { label: 'Áudio recebido', icon: Music2 },
    video: { label: 'Vídeo recebido', icon: Video },
    document: { label: 'Documento recebido', icon: FileText },
  }[media?.kind] || { label: 'Anexo recebido', icon: FileText };
  const Icon = config.icon;

  if (media?.kind === 'image' && media.url) {
    return <>
      <button className="media-image-button" type="button" onClick={() => setExpandedImage(true)} aria-label="Ampliar imagem">
        <img className="media-image" src={media.thumbnailUrl || media.url} alt={media.caption || config.label} loading="lazy" onLoad={onMediaLoad} />
      </button>
      {expandedImage && (
        <div className="media-lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada" onClick={() => setExpandedImage(false)}>
          <button className="media-lightbox-close" type="button" aria-label="Fechar imagem" onClick={() => setExpandedImage(false)}><X size={20} /></button>
          <img className="media-lightbox-image" src={media.url} alt={media.caption || config.label} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>;
  }
  if (media?.kind === 'audio' && media.url) {
    return <audio className="media-audio" controls preload="metadata" src={media.url}>Seu navegador não suporta áudio.</audio>;
  }
  if (media?.kind === 'video' && media.url) {
    return <video className="media-video" controls preload="metadata" poster={media.thumbnailUrl || undefined} src={media.url}>Seu navegador não suporta vídeo.</video>;
  }
  if (media?.kind === 'document' && media.url) {
    return <a className="media-placeholder media-download" href={media.url} target="_blank" rel="noreferrer"><Icon size={20} /><span>{media.fileName || config.label}</span><ExternalLink size={15} /></a>;
  }
  return <div className="media-placeholder" title="O arquivo original ainda não foi disponibilizado pelo canal"><Icon size={20} /><span>{media?.fileName || config.label}</span><small>Prévia indisponível</small></div>;
}

function SkeletonLine({ width, height, style, className }) {
  return <span className={`skeleton-line ${className || ''}`} style={{ width, height, ...style }} />;
}

function SkeletonBlock({ width, height, style, className }) {
  return <div className={`skeleton-block ${className || ''}`} style={{ width, height, ...style }} />;
}

function Conversations({
  allowedChannels = CHANNEL_OPTIONS.map(c => c.id),
  conversations = [],
  tenantSlug,
  onSent,
  agentsList = [],
  agentsReady = true,
  onAssignAgent,
  initialConversationId = null,
  onInitialConversationOpened,
  onNavigateSettings = null,
  onConversationViewStateChange = null,
  ready = true,
  kanbanColumns = [],
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => (
    typeof window === 'undefined' || window.matchMedia('(min-width: 769px)').matches
  ));
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  const kanbanCardsByConversationKey = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(kanbanColumns)) return map;
    for (const column of kanbanColumns) {
      for (const card of (column.cards || [])) {
        if (card.canonicalKey && !map.has(card.canonicalKey)) map.set(card.canonicalKey, card);
        if (card.normalizedExternalId && !map.has(card.normalizedExternalId)) map.set(card.normalizedExternalId, card);
        if (card.externalConversationId && !map.has(card.externalConversationId)) map.set(card.externalConversationId, card);
        if (card.id && !map.has(card.id)) map.set(card.id, card);
      }
    }
    return map;
  }, [kanbanColumns]);

  const isSearchExpanded = searchOpen || Boolean(query && query.trim() !== '');

  const handleOpenSearch = () => {
    setSearchOpen(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleCloseSearch = () => {
    if (query) {
      setQuery('');
    } else {
      setSearchOpen(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        setSearchOpen(false);
      }
    }
  };

  const [filter, setFilter] = useState('todas');
  const [channelFilter, setChannelFilter] = useState('todos');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignToast, setAssignToast] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [closedLocally, setClosedLocally] = useState({});
  const closeInFlight = useRef(false);
  const [sendError, setSendError] = useState('');

  const cancelCloseBtnRef = useRef(null);
  const closeActionBtnRef = useRef(null);
  const assignActionBtnRef = useRef(null);
  const assignModalCloseBtnRef = useRef(null);
  const messagesEndRef = React.useRef(null);
  const messageStreamRef = React.useRef(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 769px)');
    const syncViewport = () => setIsDesktopViewport(mediaQuery.matches);
    const syncVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
    syncViewport();
    syncVisibility();
    mediaQuery.addEventListener?.('change', syncViewport);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      mediaQuery.removeEventListener?.('change', syncViewport);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (showCloseModal) {
      setTimeout(() => {
        cancelCloseBtnRef.current?.focus();
      }, 50);
    }
  }, [showCloseModal]);

  useEffect(() => {
    if (showAssignModal) {
      setTimeout(() => {
        assignModalCloseBtnRef.current?.focus();
      }, 50);
    }
  }, [showAssignModal]);

  function handleOpenCloseModal() {
    if (!canEndSelected || closeInFlight.current) return;
    setSendError('');
    setShowCloseModal(true);
  }

  function handleCancelCloseModal() {
    if (ending) return;
    setShowCloseModal(false);
    setSendError('');
    setTimeout(() => {
      closeActionBtnRef.current?.focus();
    }, 40);
  }

  function handleCloseAssignModal() {
    setShowAssignModal(false);
    setTimeout(() => {
      assignActionBtnRef.current?.focus();
    }, 40);
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (showCloseModal) {
          e.stopPropagation();
          if (!ending) {
            handleCancelCloseModal();
          }
          return;
        }
        if (showAssignModal) {
          e.stopPropagation();
          handleCloseAssignModal();
          return;
        }
        if (showFilterMenu) {
          e.stopPropagation();
          setShowFilterMenu(false);
          return;
        }
        if (isSearchExpanded) {
          e.stopPropagation();
          handleCloseSearch();
          return;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showCloseModal, showAssignModal, showFilterMenu, isSearchExpanded, ending]);

  function scrollToLatest() {
    const stream = messageStreamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  const channelCounts = useMemo(() => {
    const counts = { todos: conversations.length, telegram: 0, whatsapp: 0, instagram: 0 };
    for (const c of conversations) {
      const type = String(c.channelType || c.channel || '').toLowerCase();
      if (type.includes('telegram')) counts.telegram++;
      else if (type.includes('whats') || type.includes('zap')) counts.whatsapp++;
      else if (type.includes('insta')) counts.instagram++;
    }
    return counts;
  }, [conversations]);

  const unreadCount = useMemo(() => {
    return conversations.filter((c) => (c.unread || 0) > 0).length;
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesQuery = !normalizedQuery || [
        conversation.contact,
        conversation.company,
        conversation.lastMessage,
        conversation.lastMessageSender,
        conversation.stage,
        ...(conversation.tags || []),
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);

      const matchesFilter =
        filter === 'todas' ||
        (filter === 'ia' && conversation.status === 'ia_ativa') ||
        (filter === 'humanas' && conversation.status === 'atendimento_humano') ||
        (filter === 'nao_lidas' && (conversation.unread || 0) > 0);

      const channelType = String(conversation.channelType || conversation.channel || '').toLowerCase();
      const matchesChannel =
        channelFilter === 'todos' ||
        (channelFilter === 'telegram' && channelType.includes('telegram')) ||
        (channelFilter === 'whatsapp' && (channelType.includes('whats') || channelType.includes('zap'))) ||
        (channelFilter === 'instagram' && channelType.includes('insta'));

      return matchesQuery && matchesFilter && matchesChannel;
    });
  }, [conversations, filter, channelFilter, query]);

  const selected = useMemo(() => {
    return conversations.find((conversation) => conversation.id === selectedId) || null;
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!ready || !conversations.length) {
      if (selectedId && !conversations.length) setSelectedId(null);
      return;
    }
    if (!conversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, ready, selectedId]);

  const selectedConversationIsVisible = Boolean(
    selected
    && ready
    && isDocumentVisible
    && (isDesktopViewport || mobileChatOpen),
  );

  useEffect(() => {
    onConversationViewStateChange?.({
      conversation: selected,
      visible: selectedConversationIsVisible,
    });
    return () => onConversationViewStateChange?.({ conversation: null, visible: false });
  }, [
    onConversationViewStateChange,
    selected?.id,
    selected?.messages?.length,
    selectedConversationIsVisible,
  ]);

  const matchingKanbanCard = useMemo(() => {
    if (!selected) return null;
    return kanbanCardsByConversationKey.get(selected.canonicalKey)
      || (selected.normalizedExternalId && kanbanCardsByConversationKey.get(selected.normalizedExternalId))
      || (selected.externalConversationId && kanbanCardsByConversationKey.get(selected.externalConversationId))
      || kanbanCardsByConversationKey.get(selected.id)
      || null;
  }, [selected, kanbanCardsByConversationKey]);

  const headerOwner = useMemo(
    () => resolveConversationHeaderOwner(selected, matchingKanbanCard, agentsList),
    [selected, matchingKanbanCard, agentsList],
  );
  const validOwnerAgent = headerOwner.kind === 'agent' ? headerOwner : null;
  const isAiOwner = headerOwner.kind === 'ai';

  const selectedCloseKey = JSON.stringify([tenantSlug, selected?.id]);
  const canEndSelected = canCloseConversation(selected, closedLocally[selectedCloseKey]);

  useEffect(() => {
    setShowCloseModal(false);
  }, [selectedCloseKey]);

  useEffect(() => {
    if (!initialConversationId) return;
    const conversation = conversations.find((item) => (
      item.id === initialConversationId
      || item.externalConversationId === initialConversationId
      || item.canonicalKey === initialConversationId
      || item.normalizedExternalId === initialConversationId
    ));
    if (!conversation) return;
    setQuery('');
    setFilter('todas');
    setChannelFilter('todos');
    setSelectedId(conversation.id);
    setMobileChatOpen(true);
    onInitialConversationOpened?.();
  }, [conversations, initialConversationId, onInitialConversationOpened]);

  useEffect(() => {
    scrollToLatest();
    const timer = window.setTimeout(scrollToLatest, 120);
    return () => window.clearTimeout(timer);
  }, [selected?.id, selected?.messages?.length]);

  async function sendManualReply() {
    const text = draft.trim();
    if (!selected || !text || sending) return;

    setSending(true);
    setSendError('');
    try {
      await sendN8nCommand('manual_reply', {
        channel_type: selected.channelType || selected.channel.toLowerCase(),
        external_conversation_id: selected.externalConversationId || selected.id.replace(/^conv-/, ''),
        contact_name: selected.contact,
        message_text: text,
        sent_by_user: 'Operador NORIA',
      }, tenantSlug);
      setDraft('');
      await onSent?.({ showLoading: false });
    } catch (error) {
      setSendError(error.message || 'Não foi possível enviar a resposta.');
    } finally {
      setSending(false);
    }
  }

  async function executeCloseConversation() {
    if (!canEndSelected || closeInFlight.current) return;

    closeInFlight.current = true;
    setEnding(true);
    setSendError('');
    try {
      await sendN8nCommand('close_conversation', {
        channel_type: selected.channelType || selected.channel.toLowerCase(),
        external_conversation_id: selected.externalConversationId || selected.id.replace(/^conv-/, ''),
        contact_name: selected.contact,
        message_text: 'Atendimento encerrado pela interface',
        sent_by_user: 'Operador NORIA',
        reason: 'Atendimento finalizado pelo operador',
      }, tenantSlug);
      setClosedLocally((current) => ({
        ...current,
        [selectedCloseKey]: {
          closedEventId: selected.closedEventId,
          lastInboundId: selected.lastInboundId,
        },
      }));
      setShowCloseModal(false);
      await onSent?.({ showLoading: false });
      setTimeout(() => {
        closeActionBtnRef.current?.focus();
      }, 40);
    } catch (error) {
      setSendError(error.message || 'Não foi possível encerrar o atendimento.');
    } finally {
      closeInFlight.current = false;
      setEnding(false);
    }
  }

  return (
    <section className={`conversation-layout ${mobileChatOpen ? 'mobile-chat-open' : 'mobile-list-open'}`}>
      <aside className="conversation-list panel">
        <div className="toolbar" style={{ position: 'relative' }}>
          <div className="conversations-search-wrapper">
            <button
              type="button"
              className="icon-button search-expand-btn"
              onClick={handleOpenSearch}
              title="Buscar conversa"
              aria-label="Buscar conversa"
            >
              <Search size={16} />
            </button>
            <div className="search-box">
              <Search size={16} className="search-icon-inside" />
              <input
                ref={searchInputRef}
                placeholder="Buscar conversa..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-label="Buscar conversa"
              />
              {Boolean(query && query.trim() !== '') && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={handleCloseSearch}
                  title="Limpar busca"
                  aria-label="Limpar busca"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="filter-dropdown-wrapper">
            <button
              className={`icon-button ${channelFilter !== 'todos' ? 'active-filter' : ''}`}
              title="Filtrar por canal"
              aria-label="Abrir filtros de canais"
              type="button"
              onClick={() => setShowFilterMenu((prev) => !prev)}
            >
              <Filter size={17} />
              {channelFilter !== 'todos' && (
                <span className={`filter-indicator-dot ${getChannelClass(channelFilter)}`} />
              )}
            </button>

            {showFilterMenu && (
              <>
                <div className="dropdown-overlay" onClick={() => setShowFilterMenu(false)} />
                <div className="filter-popover-menu" role="menu">
                  <div className="filter-primary-section">
                    <div className="filter-popover-header">
                      <span>Filtros</span>
                    </div>
                    <button
                      type="button"
                      className={`filter-menu-item ${filter === 'todas' ? 'selected' : ''}`}
                      onClick={() => { setFilter('todas'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {filter === 'todas' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span>Todas</span>
                      </div>
                      <span className="count-badge">{conversations.length}</span>
                    </button>
                    <button
                      type="button"
                      className={`filter-menu-item ${filter === 'nao_lidas' ? 'selected' : ''}`}
                      onClick={() => { setFilter('nao_lidas'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {filter === 'nao_lidas' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span>Não lidas</span>
                      </div>
                      {(unreadCount || 0) > 0 && <span className="count-badge unread-badge">{unreadCount}</span>}
                    </button>
                    <button
                      type="button"
                      className={`filter-menu-item ${filter === 'ia' ? 'selected' : ''}`}
                      onClick={() => { setFilter('ia'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {filter === 'ia' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span>IA</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`filter-menu-item ${filter === 'humanas' ? 'selected' : ''}`}
                      onClick={() => { setFilter('humanas'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {filter === 'humanas' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span>Humanas</span>
                      </div>
                    </button>
                    <div className="filter-popover-divider" />
                  </div>

                  <div className="filter-channel-section">
                    <div className="filter-popover-header">
                      <span>Canais</span>
                    </div>
                    <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'todos' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('todos'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'todos' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-webchat"><Sparkles size={12} /></span>
                        <span>Todos os canais</span>
                      </div>
                      <span className="count-badge">{channelCounts.todos}</span>
                    </button>
                    {allowedChannels.includes('telegram') && <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'telegram' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('telegram'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'telegram' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-telegram"><ChannelIcon channel="telegram" size={12} /></span>
                        <span>Telegram</span>
                      </div>
                      <span className="count-badge telegram">{channelCounts.telegram}</span>
                    </button>}
                    {allowedChannels.includes('whatsapp') && <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'whatsapp' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('whatsapp'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'whatsapp' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-whatsapp"><ChannelIcon channel="whatsapp" size={12} /></span>
                        <span>WhatsApp</span>
                      </div>
                      <span className="count-badge whatsapp">{channelCounts.whatsapp}</span>
                    </button>}
                    {allowedChannels.includes('instagram') && <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'instagram' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('instagram'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'instagram' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-instagram"><ChannelIcon channel="instagram" size={12} /></span>
                        <span>Instagram</span>
                      </div>
                      <span className="count-badge instagram">{channelCounts.instagram}</span>
                    </button>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="chips">
          <button className={`chip ${filter === 'todas' ? 'active' : ''}`} type="button" onClick={() => setFilter('todas')}>Todas</button>
          <button className={`chip ${filter === 'nao_lidas' ? 'active' : ''}`} type="button" onClick={() => setFilter('nao_lidas')}>
            Não lidas
            {(unreadCount || 0) > 0 && <span className="chip-unread-count">{unreadCount}</span>}
          </button>
          <button className={`chip ${filter === 'ia' ? 'active' : ''}`} type="button" onClick={() => setFilter('ia')}>IA</button>
          <button className={`chip ${filter === 'humanas' ? 'active' : ''}`} type="button" onClick={() => setFilter('humanas')}>Humanas</button>

          {channelFilter !== 'todos' && (
            <button
              className={`chip active channel-filter-active-chip ${getChannelClass(channelFilter)}`}
              type="button"
              onClick={() => setChannelFilter('todos')}
              title="Remover filtro de canal"
            >
              <ChannelIcon channel={channelFilter} size={12} />
              <span>{channelFilter === 'telegram' ? 'Telegram' : channelFilter === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</span>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="conversation-items-scroll" key={`${filter}-${channelFilter}`}>
          {!ready ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div className="conversation-item conversation-item-skeleton" key={i}>
                <div className="conversation-avatar-wrapper">
                  <div className="conversation-avatar skeleton-block" />
                </div>
                <div className="conversation-item-main">
                  <div className="conversation-item-top">
                    <SkeletonLine width="90px" />
                    <SkeletonLine width="40px" />
                  </div>
                  <div className="conversation-item-bottom">
                    <SkeletonLine width="140px" />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <>
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item ${getChannelClass(conversation.channelType || conversation.channel)} ${selected?.id === conversation.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(conversation.id);
                    setMobileChatOpen(true);
                  }}
                >
                  <div className="conversation-avatar-wrapper">
                    <ContactAvatar name={conversation.contact} avatarUrl={conversation.avatarUrl} />
                    <ContactAvatarBadge
                      channel={conversation.channelType || conversation.channel}
                      presence={conversation.presence}
                    />
                  </div>

                  <div className="conversation-item-main">
                    <div className="conversation-item-top">
                      <strong className="contact-name">{conversation.contact}</strong>
                      <small className="timestamp">{conversation.lastAt}</small>
                    </div>
                    <div className="conversation-item-bottom">
                      <span
                        className="last-message"
                        title={conversation.lastMessageSender
                          ? `${conversation.lastMessageSender}: ${formatConversationPreview(conversation.lastMessage)}`
                          : formatConversationPreview(conversation.lastMessage)}
                      >
                        {conversation.lastMessageSender && (
                          <span className="last-message-sender">{conversation.lastMessageSender}: </span>
                        )}
                        <span className="last-message-text">{formatConversationPreview(conversation.lastMessage)}</span>
                      </span>
                      {(conversation.unread || 0) > 0 && (
                        <span className="item-unread-badge" aria-label={`${conversation.unread} mensagens não lidas`}>
                          {conversation.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {!filteredConversations.length && <EmptyState title="Nenhum resultado" text="Ajuste a busca ou os filtros para ver outras conversas." compact />}
            </>
          )}
        </div>
      </aside>

      <section className="chat-panel panel">
        {!ready ? (
          <div className="chat-empty-panel">
            <SkeletonBlock width="180px" height="20px" style={{ margin: '0 auto 12px', borderRadius: '4px' }} />
            <SkeletonLine width="140px" style={{ margin: '0 auto' }} />
          </div>
        ) : selected ? <>
          <div className="chat-header">
            <div className="chat-header-left">
              <button
                type="button"
                className="mobile-back-button"
                onClick={() => setMobileChatOpen(false)}
                aria-label="Voltar para conversas"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="chat-header-avatar-wrap">
                <ContactAvatar name={selected.contact} avatarUrl={selected.avatarUrl} />
                <ContactAvatarBadge
                  channel={selected.channelType || selected.channel}
                  presence={selected.presence}
                />
              </div>
              <div className="chat-header-main-info">
                <div className="chat-header-name-row">
                  <strong className="chat-header-name">{selected.contact}</strong>
                </div>
                <div className="chat-header-sub">
                  <span className="chat-header-stage-chip">{selected.stage}</span>
                  <div className={`chat-header-owner-chip ${validOwnerAgent ? 'has-owner' : isAiOwner ? 'is-ai' : 'no-owner'}`}>
                    {isAiOwner ? (
                      <Bot size={12} className="owner-chip-icon" />
                    ) : (
                      <UserRound size={12} className="owner-chip-icon" />
                    )}
                    <span className="owner-chip-name">
                      {validOwnerAgent ? validOwnerAgent.name : isAiOwner ? 'Assistente IA' : 'Sem responsável'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="header-actions">
              <button
                ref={closeActionBtnRef}
                className="secondary-button text-danger chat-action-btn chat-action-close"
                type="button"
                onClick={handleOpenCloseModal}
                disabled={ending || !canEndSelected}
                title={canEndSelected ? 'Encerrar atendimento' : 'Atendimento já finalizado'}
                aria-label="Encerrar atendimento"
              >
                <CheckCircle2 size={16} />
                <span className="action-text">{ending ? 'Encerrando...' : 'Encerrar'}</span>
              </button>
              <button
                ref={assignActionBtnRef}
                className="secondary-button chat-action-btn chat-action-assign"
                type="button"
                onClick={() => setShowAssignModal(true)}
                title="Atribuir conversa"
                aria-label="Atribuir conversa"
              >
                <UserRound size={16} />
                <span className="action-text">Atribuir</span>
              </button>
            </div>
          </div>
          <div className="message-stream" ref={messageStreamRef}>
            {(selected.messages || []).map((message, index) => {
              const isAi = message.from === 'ai' || message.sender_type === 'bot';
              const isAgent = message.from === 'agent' || message.sender_type === 'agent';
              const isSystem = message.from === 'system' || message.sender_type === 'system';

              let senderLabel = selected.contact;
              if (isAi) senderLabel = 'Assistente IA';
              else if (isAgent) senderLabel = message.sent_by || selected.owner || 'Operador';
              else if (isSystem) senderLabel = 'Sistema';

              return (
                <div key={`${message.at}-${index}`} className={`bubble ${isAi ? 'ai' : isAgent || isSystem ? 'agent' : 'contact'}`}>
                  <div className="bubble-sender">{senderLabel}</div>
                  {message.media && <MediaAttachment media={message.media} onMediaLoad={scrollToLatest} />}
                  {message.text && <p className="bubble-text">{message.text}</p>}
                  <div className="bubble-meta">
                    <span className="bubble-time">{message.at}</span>
                    {(isAi || isAgent || isSystem) && <CheckCheck size={13} className="bubble-check" />}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="composer">
            <input
              placeholder="Responder..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendManualReply();
                }
              }}
            />
            <button
              className="primary-button composer-send-btn"
              type="button"
              onClick={sendManualReply}
              disabled={sending || !draft.trim()}
              aria-label="Enviar mensagem"
            >
              <Send size={16} />
              <span className="composer-send-text">{sending ? 'Enviando...' : 'Enviar'}</span>
            </button>
          </div>
          {sendError && <div className="inline-error">{sendError}</div>}
        </> : <EmptyState title="Selecione uma conversa" text="Escolha um atendimento na lista lateral para visualizar as mensagens." />}
      </section>

      {showCloseModal && selected && (
        <div
          className="modal-backdrop"
          onClick={() => { if (!ending) handleCancelCloseModal(); }}
          role="presentation"
        >
          <div
            className="modal-panel confirm-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-modal-title"
            aria-describedby="close-modal-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-modal-header">
              <div className="confirm-modal-title-row">
                <div className="confirm-danger-icon" aria-hidden="true">
                  <AlertCircle size={20} />
                </div>
                <h3 id="close-modal-title" className="modal-title">Encerrar atendimento?</h3>
              </div>
              <button
                className="icon-button modal-close-btn"
                type="button"
                onClick={handleCancelCloseModal}
                disabled={ending}
                aria-label="Fechar"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="confirm-modal-body">
              <p id="close-modal-desc" className="confirm-modal-desc">
                Esta conversa sairá do atendimento humano. A próxima mensagem do contato voltará a ser atendida pela IA.
              </p>

              <div className="modal-target-contact compact">
                <MessageCircle size={14} />
                <span>Atendimento: <strong>{selected.contact || 'Cliente'}</strong></span>
                {selected.channel && <span className="modal-target-channel">· {selected.channel}</span>}
              </div>

              {sendError && <div className="inline-error confirm-error">{sendError}</div>}
            </div>

            <div className="confirm-modal-footer">
              <button
                ref={cancelCloseBtnRef}
                type="button"
                className="secondary-button confirm-cancel-btn"
                onClick={handleCancelCloseModal}
                disabled={ending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button confirm-close-btn"
                onClick={executeCloseConversation}
                disabled={ending || !canEndSelected}
                aria-label="Encerrar atendimento"
                title="Encerrar atendimento"
              >
                {ending ? (
                  <>
                    <RefreshCcw size={15} className="spin" />
                    <span>Encerrando...</span>
                  </>
                ) : (
                  <span>Encerrar</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && selected && (
        <div className="modal-backdrop" onClick={handleCloseAssignModal} role="presentation">
          <div
            className="modal-panel assign-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="assign-modal-header">
              <div className="assign-modal-header-main">
                <h3 id="assign-modal-title" className="assign-modal-title">Atribuir atendimento</h3>
                <span className="assign-modal-contact">{selected.contact || 'Cliente'}</span>
              </div>
              <button
                ref={assignModalCloseBtnRef}
                className="icon-button assign-modal-close-btn"
                type="button"
                onClick={handleCloseAssignModal}
                aria-label="Fechar"
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="assign-modal-body">
              {!agentsReady ? (
                <div className="assign-skeleton-list">
                  {[1, 2].map((i) => (
                    <div className="assign-skeleton-row" key={i}>
                      <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%' }} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <SkeletonLine width="110px" height="12px" />
                        <SkeletonLine width="70px" height="10px" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : agentsList.length > 0 ? (
                <div className="assign-agent-list">
                  {agentsList.map((agent) => {
                    const isCurrent = (validOwnerAgent && String(validOwnerAgent.id) === String(agent.id))
                      || (validOwnerAgent && validOwnerAgent.name === agent.name)
                      || selected.owner === agent.name;
                    return (
                      <div
                        key={agent.id}
                        className={`assign-agent-row ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {
                          if (!isCurrent) {
                            onAssignAgent?.(selected, agent);
                            handleCloseAssignModal();
                            setAssignToast(`Conversa atribuída a ${agent.name}`);
                            setTimeout(() => setAssignToast(''), 3000);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (!isCurrent) {
                              onAssignAgent?.(selected, agent);
                              handleCloseAssignModal();
                              setAssignToast(`Conversa atribuída a ${agent.name}`);
                              setTimeout(() => setAssignToast(''), 3000);
                            }
                          }
                        }}
                      >
                        <div className="assign-agent-avatar">
                          {getInitials(agent.name)}
                        </div>
                        <div className="assign-agent-meta">
                          <span className="assign-agent-name">{agent.name}</span>
                          {agent.role && <span className="assign-agent-role">{agent.role}</span>}
                        </div>
                        {isCurrent && (
                          <span className="assign-current-badge">Atual</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="assign-empty-state">
                  <UserRound size={22} className="assign-empty-icon" />
                  <div className="assign-empty-texts">
                    <p className="assign-empty-title">Nenhum atendente cadastrado</p>
                    <p className="assign-empty-desc">Cadastre um atendente em Configurações para poder atribuir esta conversa.</p>
                  </div>
                  {onNavigateSettings && (
                    <button
                      type="button"
                      className="assign-empty-cta-btn"
                      onClick={() => {
                        handleCloseAssignModal();
                        onNavigateSettings();
                      }}
                    >
                      Ir para Configurações
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {assignToast && (
        <div className="toast-notification">
          <CheckCircle2 size={18} color="#10b981" />
          <span>{assignToast}</span>
        </div>
      )}
    </section>
  );
}

function useHorizontalMouseDragScroll(containerRef, { blockInteractiveTargets = false } = {}) {
  const dragStateRef = useRef({
    pointerId: null,
    startX: 0,
    initialScrollLeft: 0,
    dragging: false,
    suppressClick: false,
    suppressTimer: null,
    frameId: null,
    targetScrollLeft: 0,
    originalScrollBehavior: '',
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const state = dragStateRef.current;
    const interactiveSelector = 'button, a, input, textarea, select, [role="button"], [draggable="true"], .kanban-card';

    const flushScroll = () => {
      state.frameId = null;
      container.scrollLeft = state.targetScrollLeft;
    };

    const resetPointer = () => {
      if (state.pointerId !== null && container.hasPointerCapture?.(state.pointerId)) {
        container.releasePointerCapture(state.pointerId);
      }
      state.pointerId = null;
      state.dragging = false;
      container.style.scrollBehavior = state.originalScrollBehavior;
      container.classList.remove('is-drag-scrolling');
    };

    const handlePointerDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      // A new press starts a new gesture. It must never inherit click
      // suppression left by a drag that did not emit a residual click.
      state.suppressClick = false;
      window.clearTimeout(state.suppressTimer);
      if (blockInteractiveTargets && event.target.closest(interactiveSelector)) return;
      if (container.scrollWidth <= container.clientWidth) return;

      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.initialScrollLeft = container.scrollLeft;
      state.targetScrollLeft = container.scrollLeft;
      state.originalScrollBehavior = container.style.scrollBehavior;
      state.dragging = false;
      container.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event) => {
      if (event.pointerId !== state.pointerId) return;
      const deltaX = event.clientX - state.startX;
      if (!state.dragging && Math.abs(deltaX) < 6) return;

      if (!state.dragging) {
        state.dragging = true;
        container.style.scrollBehavior = 'auto';
        container.classList.add('is-drag-scrolling');
      }

      event.preventDefault();
      state.targetScrollLeft = state.initialScrollLeft - deltaX * 1.12;
      if (state.frameId === null) state.frameId = window.requestAnimationFrame(flushScroll);
    };

    const handlePointerEnd = (event) => {
      if (event.pointerId !== state.pointerId) return;
      const dragged = state.dragging;
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        flushScroll();
      }
      resetPointer();

      if (dragged) {
        state.suppressClick = true;
        window.clearTimeout(state.suppressTimer);
        state.suppressTimer = window.setTimeout(() => {
          state.suppressClick = false;
        }, 350);
      }
    };

    const handleClickCapture = (event) => {
      if (!state.suppressClick) return;
      state.suppressClick = false;
      window.clearTimeout(state.suppressTimer);
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);
    container.addEventListener('click', handleClickCapture, true);

    return () => {
      window.clearTimeout(state.suppressTimer);
      if (state.frameId !== null) window.cancelAnimationFrame(state.frameId);
      resetPointer();
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
      container.removeEventListener('click', handleClickCapture, true);
    };
  }, [containerRef, blockInteractiveTargets]);
}

function useKanbanDragAutoScroll(containerRef, isDragging, onColumnHover) {
  const scrollStateRef = useRef({
    frameId: null,
    speed: 0,
    originalScrollBehavior: '',
    lastCoords: null,
    lastHoveredColId: null,
  });

  useEffect(() => {
    if (!isDragging) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const state = scrollStateRef.current;
    const EDGE_ZONE = 110;
    const MIN_SPEED = 2.5;
    const MAX_SPEED = 18;

    const stopLoop = () => {
      state.speed = 0;
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      if (state.originalScrollBehavior) {
        container.style.scrollBehavior = state.originalScrollBehavior;
        state.originalScrollBehavior = '';
      }
    };

    const scrollStep = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer || state.speed === 0) {
        state.frameId = null;
        return;
      }

      const maxScroll = Math.max(0, currentContainer.scrollWidth - currentContainer.clientWidth);
      const currentScroll = currentContainer.scrollLeft;
      const speed = state.speed;

      let didScroll = false;
      if (speed > 0 && currentScroll < maxScroll) {
        currentContainer.scrollLeft = Math.min(maxScroll, currentScroll + speed);
        didScroll = true;
      } else if (speed < 0 && currentScroll > 0) {
        currentContainer.scrollLeft = Math.max(0, currentScroll + speed);
        didScroll = true;
      }

      // Se moveu o scroll e temos coordenadas do cursor, atualiza a coluna sob o cursor
      if (didScroll && state.lastCoords && typeof onColumnHover === 'function') {
        const el = document.elementFromPoint(state.lastCoords.x, state.lastCoords.y);
        const colEl = el?.closest?.('.kanban-column');
        if (colEl) {
          const colId = colEl.getAttribute('data-column-id');
          if (colId && colId !== state.lastHoveredColId) {
            state.lastHoveredColId = colId;
            onColumnHover(colId);
          }
        } else if (state.lastHoveredColId !== null) {
          state.lastHoveredColId = null;
          onColumnHover(null);
        }
      }

      if (didScroll) {
        state.frameId = window.requestAnimationFrame(scrollStep);
      } else {
        state.frameId = null;
      }
    };

    const startLoop = () => {
      if (state.frameId === null) {
        if (!state.originalScrollBehavior) {
          state.originalScrollBehavior = container.style.scrollBehavior;
        }
        container.style.scrollBehavior = 'auto';
        state.frameId = window.requestAnimationFrame(scrollStep);
      }
    };

    const handleWindowDragOver = (event) => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const rect = currentContainer.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      state.lastCoords = { x, y };

      // Se o cursor estiver fora dos limites verticais do Kanban (+/- 60px de tolerância), para o auto-scroll
      if (y < rect.top - 60 || y > rect.bottom + 60) {
        stopLoop();
        return;
      }

      // Zona de auto-scroll à esquerda
      if (x < rect.left + EDGE_ZONE && x >= rect.left - 50) {
        const dist = Math.max(0, x - rect.left);
        const ratio = 1 - Math.min(1, dist / EDGE_ZONE);
        const eased = ratio * ratio;
        state.speed = -(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * eased);
        startLoop();
      }
      // Zona de auto-scroll à direita
      else if (x > rect.right - EDGE_ZONE && x <= rect.right + 50) {
        const dist = Math.max(0, rect.right - x);
        const ratio = 1 - Math.min(1, dist / EDGE_ZONE);
        const eased = ratio * ratio;
        state.speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * eased;
        startLoop();
      }
      // Fora das zonas de borda
      else {
        stopLoop();
      }
    };

    const handleDragEndOrDrop = () => {
      stopLoop();
      state.lastCoords = null;
      state.lastHoveredColId = null;
    };

    window.addEventListener('dragover', handleWindowDragOver, { passive: true });
    window.addEventListener('dragend', handleDragEndOrDrop);
    window.addEventListener('drop', handleDragEndOrDrop);

    return () => {
      stopLoop();
      state.lastCoords = null;
      state.lastHoveredColId = null;
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragend', handleDragEndOrDrop);
      window.removeEventListener('drop', handleDragEndOrDrop);
    };
  }, [containerRef, isDragging, onColumnHover]);
}

function useKanbanWheelScroll(containerRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let lastVerticalScrollTime = 0;
    let restoreTimer = null;

    const handleWheel = (event) => {
      if (event.defaultPrevented) return;

      // Se o scroll horizontal nativo for predominante (ex: trackpad com gesto horizontal), deixa o navegador agir
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      // Analisa a hierarquia para verificar se o cursor está sobre uma lista vertical de cards
      const target = event.target;
      const cardsContainer = target?.closest?.('.column-cards-container');

      if (cardsContainer) {
        const scrollableDistance = cardsContainer.scrollHeight - cardsContainer.clientHeight;
        const hasVerticalScroll = scrollableDistance > 3;

        // Se a coluna possui scroll vertical e o usuário não estiver segurando Shift (padrão para forçar horizontal)
        if (hasVerticalScroll && !event.shiftKey) {
          const isScrollingDown = event.deltaY > 0;
          const isScrollingUp = event.deltaY < 0;
          const isAtBottom = cardsContainer.scrollTop + cardsContainer.clientHeight >= cardsContainer.scrollHeight - 3;
          const isAtTop = cardsContainer.scrollTop <= 3;

          // Se há espaço para rolar verticalmente na direção do wheel, preserva o scroll vertical dos cards
          if ((isScrollingDown && !isAtBottom) || (isScrollingUp && !isAtTop)) {
            lastVerticalScrollTime = Date.now();
            return;
          }

          // Se acabou de rolar verticalmente (nos últimos 180ms), amortece o final da rolagem
          // para não disparar um salto horizontal repentino no mesmo gesto contínuo
          if (Date.now() - lastVerticalScrollTime < 180) {
            return;
          }
        }
      }

      // Normalização do delta proporcional ao deltaMode
      let delta = event.deltaY;
      if (event.deltaMode === 1) {
        // DOM_DELTA_LINE (típico de roda de mouse no Windows)
        delta *= 30;
      } else if (event.deltaMode === 2) {
        // DOM_DELTA_PAGE
        delta *= container.clientWidth * 0.8;
      }

      // Limita a velocidade por tick para evitar saltos bruscos
      const clampedDelta = Math.max(-160, Math.min(160, delta));
      if (clampedDelta === 0) return;

      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxScroll <= 0) return;

      const currentScroll = container.scrollLeft;
      const targetScroll = Math.max(0, Math.min(maxScroll, currentScroll + clampedDelta));

      // Impede o scroll vertical da página principal (body)
      event.preventDefault();

      if (targetScroll !== currentScroll) {
        if (container.style.scrollBehavior !== 'auto') {
          container.style.scrollBehavior = 'auto';
        }
        container.scrollLeft = targetScroll;

        window.clearTimeout(restoreTimer);
        restoreTimer = window.setTimeout(() => {
          if (container) container.style.scrollBehavior = '';
        }, 150);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.clearTimeout(restoreTimer);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef]);
}

function displayContactPhone(contact) {
  const raw = String(contact.phone || contact.external_conversation_id || contact.externalConversationId || '').trim();
  if (!raw) return 'Telefone não informado';
  const value = raw.replace(/@(s\.whatsapp\.net|c\.us|g\.us|telegram|instagram)\b.*$/i, '');
  const digits = value.replace(/\D/g, '');
  if (/^55\d{11}$/.test(digits)) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return value;
}

function displayContactName(contact) {
  const name = String(contact.display_name || contact.displayName || contact.name || contact.contact_name || '').trim();
  return name && !/@(s\.whatsapp\.net|c\.us|g\.us)\b/i.test(name) ? name : displayContactPhone(contact);
}

function Kanban({
  allowedChannels = CHANNEL_OPTIONS.map(c => c.id),
  kanbanColumns = [],
  tenantName = '',
  agentsList = [],
  tenantSlug = 'clinica_nubia',
  onChanged,
  onOpenChat,
  onOpenAppointment,
  onMoveCard,
  onOrderApplied,
  onFinishConversation,
  ready = true,
}) {
  const [agentFilter, setAgentFilter] = useState(KANBAN_OWNER_FILTERS.ALL);
  const [channelFilter, setChannelFilter] = useState('todos');
  const [kanbanCardTransition, setKanbanCardTransition] = useState('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCardId, setCopiedCardId] = useState(null);
  const [confirmingCardId, setConfirmingCardId] = useState('');
  const [kanbanActionStatus, setKanbanActionStatus] = useState('');
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);
  const [activeColumnId, setActiveColumnId] = useState('');
  const [flowProposal, setFlowProposal] = useState(null);
  const [flowToast, setFlowToast] = useState('');
  const [flowStatus, setFlowStatus] = useState('idle');
  const boardRef = useRef(null);
  const columnRefs = useRef(new Map());
  const channelTransitionTimersRef = useRef({ exit: null, enter: null });
  const pendingChannelFilterRef = useRef(null);

  useHorizontalMouseDragScroll(boardRef, { blockInteractiveTargets: true });
  useKanbanDragAutoScroll(boardRef, Boolean(draggingCardId), setDragOverColumnId);
  useKanbanWheelScroll(boardRef);

  useEffect(() => () => {
    const timers = channelTransitionTimersRef.current;
    if (timers.exit) window.clearTimeout(timers.exit);
    if (timers.enter) window.clearTimeout(timers.enter);
  }, []);

  useEffect(() => {
    if (!flowToast) return undefined;
    const timeout = window.setTimeout(() => setFlowToast(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [flowToast]);

  const handleKanbanChannelChange = (nextChannel) => {
    if (pendingChannelFilterRef.current === nextChannel) return;

    const timers = channelTransitionTimersRef.current;
    if (timers.exit) window.clearTimeout(timers.exit);
    if (timers.enter) window.clearTimeout(timers.enter);
    timers.exit = null;
    timers.enter = null;

    if (nextChannel === channelFilter) {
      pendingChannelFilterRef.current = null;
      setKanbanCardTransition('idle');
      return;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      pendingChannelFilterRef.current = null;
      setChannelFilter(nextChannel);
      setKanbanCardTransition('idle');
      return;
    }

    pendingChannelFilterRef.current = nextChannel;
    setKanbanCardTransition('exiting');
    timers.exit = window.setTimeout(() => {
      setChannelFilter(nextChannel);
      pendingChannelFilterRef.current = null;
      setKanbanCardTransition('entering');
      timers.enter = window.setTimeout(() => {
        setKanbanCardTransition('idle');
        timers.enter = null;
      }, 180);
      timers.exit = null;
    }, 110);
  };

  const schedulingUrl = getTenantSchedulingLink(tenantSlug);

  const orderedColumns = useMemo(
    () => orderKanbanColumnsForTenant(kanbanColumns || [], tenantSlug),
    [kanbanColumns, tenantSlug],
  );

  async function handleSuggestKanbanFlow() {
    const boardId = orderedColumns[0]?.boardId;
    if (!boardId || !orderedColumns.length) {
      setFlowToast('Não foi possível organizar o fluxo deste tenant agora.');
      return;
    }
    setFlowStatus('loading');
    setFlowToast('');
    try {
      const result = await requestKanbanFlowSuggestion({
        boardId,
        tenantName,
        columns: orderedColumns.map((column) => ({
          name: column.title,
          automationKey: column.automationKey || column.id,
          kind: getKanbanColumnKind(column),
          description: getColumnPresentation(column).description,
        })),
      }, tenantSlug);
      const proposal = validateKanbanOrderProposal(orderedColumns, result?.proposal || result);
      if (!proposal.valid) throw new Error('A sugestão da IA não contém exatamente as colunas deste Kanban.');
      setFlowProposal(proposal);
      setFlowStatus('review');
    } catch (error) {
      console.error('Falha ao sugerir organização do Kanban:', error);
      setFlowToast('Não foi possível organizar o fluxo agora. Tente novamente.');
      setFlowStatus('idle');
    }
  }

  async function handleApplyKanbanFlow() {
    if (!flowProposal?.valid) return;
    const boardId = orderedColumns[0]?.boardId;
    setFlowStatus('applying');
    setFlowToast('');
    try {
      await applyKanbanFlowOrder({ boardId, orderedAutomationKeys: flowProposal.orderedAutomationKeys }, tenantSlug);
      onOrderApplied?.(flowProposal.orderedAutomationKeys);
      setFlowProposal(null);
      setFlowStatus('idle');
      setKanbanActionStatus('Organização do fluxo salva para este tenant.');
      onChanged?.();
    } catch (error) {
      console.error('Falha ao aplicar organização do Kanban:', error);
      setFlowToast('Não foi possível salvar a organização do fluxo. Tente novamente.');
      setFlowStatus('review');
    }
  }

  function copySchedulingLink(cardId, link) {
    const targetLink = link || schedulingUrl;
    if (!targetLink) return;
    navigator.clipboard.writeText(targetLink);
    setCopiedCardId(cardId);
    setTimeout(() => setCopiedCardId(null), 2500);
  }

  function formatSchedulingLink(link) {
    if (!link) return '';
    try {
      return new URL(link).host;
    } catch (e) {
      return link;
    }
  }

  async function handleConfirmSignal(card) {
    if (!card?.appointmentId || confirmingCardId) return;
    const confirmed = window.confirm('Confirmar pagamento do sinal e concluir esta etapa?');
    if (!confirmed) return;
    setConfirmingCardId(card.id);
    setKanbanActionStatus('');
    try {
      await sendN8nCommand('confirm_payment_signal', {
        appointment_id: card.appointmentId,
        channel_type: card.channelType || card.channel?.toLowerCase() || 'telegram',
        external_conversation_id: card.externalConversationId,
        contact_name: card.title,
        sent_by_user: 'Operador Mag.IA',
      }, tenantSlug);
      setKanbanActionStatus('Sinal confirmado e mensagem enviada ao cliente.');
      await onChanged?.();
    } catch (error) {
      setKanbanActionStatus(error.message || 'Nao foi possivel confirmar o sinal.');
    } finally {
      setConfirmingCardId('');
    }
  }
  const getChannelClass = (type = 'telegram') => {
    const norm = String(type).toLowerCase();
    if (norm.includes('whats')) return 'channel-whatsapp';
    if (norm.includes('insta')) return 'channel-instagram';
    return 'channel-telegram';
  };
  const getColumnPresentation = (column = {}) => {
    const key = [column.automationKey, column.id, column.title]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const navigationLabel = column.navigationLabel || '';
    if (/sales_closed/.test(key)) return { tone: 'green', shortLabel: navigationLabel || 'Negócio fechado', description: 'Venda efetivamente concluída.', Icon: CheckCircle2 };
    if (/sales_after_sales/.test(key)) return { tone: 'blue', shortLabel: navigationLabel || 'Pós-venda', description: 'Atendimentos de manutenção e pós-venda.', Icon: Wrench };
    if (/sales_appraisal/.test(key)) return { tone: 'amber', shortLabel: navigationLabel || 'Avaliação de retoma', description: 'Avaliação de veículo para retoma.', Icon: CarFront };
    if (/sales_financing/.test(key)) return { tone: 'violet', shortLabel: navigationLabel || 'Financiamento', description: 'Fila operacional de financiamento.', Icon: CircleDollarSign };
    if (/sales_hot/.test(key)) return { tone: 'amber', shortLabel: navigationLabel || 'Leads quentes', description: 'Leads de compra com prioridade comercial.', Icon: Flame };
    if (/sales_human/.test(key)) return { tone: 'violet', shortLabel: navigationLabel || 'Atendimento humano', description: 'Atendimento assumido pela equipe.', Icon: UserRound };
    if (/sales_qualifying/.test(key)) return { tone: 'cyan', shortLabel: navigationLabel || 'Qualificação IA', description: 'IA coletando informações comerciais.', Icon: Bot };
    if (/sales_new/.test(key)) return { tone: 'blue', shortLabel: navigationLabel || 'Novos contatos', description: 'Novos contatos aguardando qualificação.', Icon: MessageCircle };

    if (/finalizada/.test(key)) {
      return { tone: 'green', shortLabel: 'Finalizadas', description: 'Atendimentos concluídos.', Icon: CheckCircle2 };
    }
    if (/aguardando[_\s-]?humano/.test(key)) {
      return { tone: 'violet', shortLabel: 'Aguardando', displayTitle: 'Aguardando humano', description: 'Aguardando atendimento da equipe.', Icon: UserRound };
    }
    if (/com[_\s-]?humano|conversas[_\s-]?humanos/.test(key)) {
      return { tone: 'violet', shortLabel: 'Em atendimento', displayTitle: 'Em atendimento humano', description: 'Com atendentes da equipe.', Icon: UserRound };
    }
    if (/verificar[_\s-]?sinal/.test(key)) {
      return { tone: 'amber', shortLabel: 'Sinal', description: 'Aguardando confirmação.', Icon: CircleDollarSign };
    }
    if (/andamento/.test(key)) {
      return { tone: 'amber', shortLabel: 'Andamento', description: 'Em negociação.', Icon: Clock3 };
    }
    if (/agendamento/.test(key)) {
      return { tone: 'blue', shortLabel: 'Agenda', description: 'Conversas com horário marcado.', Icon: CalendarDays };
    }
    if (/produto/.test(key)) {
      return { tone: 'violet', shortLabel: 'Produtos', description: 'Produtos e serviços enviados.', Icon: Sparkles };
    }
    if (/nova/.test(key)) {
      return { tone: 'blue', shortLabel: 'Novas', description: 'Aguardando primeiro contato.', Icon: MessageCircle };
    }
    if (/conversas[_\s-]?ia|\bia\b/.test(key)) {
      return { tone: 'cyan', shortLabel: 'Conversas IA', description: 'Em atendimento com a IA.', Icon: Bot };
    }
    return { tone: 'cyan', shortLabel: column.title || 'Etapa', description: 'Conversas nesta etapa.', Icon: Inbox };
  };

  const filteredColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orderedColumns.map((col) => {
      const cards = (col?.cards || []).filter((card) => {
        const ownerStr = String(card?.owner || '');
        const channelStr = String(card?.channelType || card?.channel || '').toLowerCase();
        const matchesQuery =
          !query ||
          [card?.title, card?.subtitle, ownerStr, card?.channel, card?.aiReason]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query);
        const matchesAgent = matchesKanbanOwnerFilter(card, agentFilter);
        const matchesChannel =
          channelFilter === 'todos' || channelStr.includes(channelFilter);
        return matchesQuery && matchesAgent && matchesChannel;
      });
      return { ...col, cards };
    });
  }, [orderedColumns, agentFilter, channelFilter, searchQuery]);

  useEffect(() => {
    if (!filteredColumns.some((column) => column.id === activeColumnId)) {
      setActiveColumnId(filteredColumns[0]?.id || '');
    }
  }, [activeColumnId, filteredColumns]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !filteredColumns.length) return undefined;

    const updateActiveColumn = () => {
      const boardBounds = board.getBoundingClientRect();
      let mostVisibleColumnId = filteredColumns[0]?.id || '';
      let largestVisibleWidth = -1;
      for (const column of filteredColumns) {
        const element = columnRefs.current.get(column.id);
        if (!element) continue;
        const bounds = element.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(bounds.right, boardBounds.right) - Math.max(bounds.left, boardBounds.left));
        if (visibleWidth > largestVisibleWidth) {
          largestVisibleWidth = visibleWidth;
          mostVisibleColumnId = column.id;
        }
      }
      setActiveColumnId((current) => current === mostVisibleColumnId ? current : mostVisibleColumnId);
    };

    updateActiveColumn();
    board.addEventListener('scroll', updateActiveColumn, { passive: true });
    window.addEventListener('resize', updateActiveColumn);
    return () => {
      board.removeEventListener('scroll', updateActiveColumn);
      window.removeEventListener('resize', updateActiveColumn);
    };
  }, [filteredColumns]);

  function scrollToColumn(columnId) {
    const board = boardRef.current;
    const column = columnRefs.current.get(columnId);
    if (!board || !column) return;

    const boardBounds = board.getBoundingClientRect();
    const columnBounds = column.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    const targetLeft = Math.min(
      maxScrollLeft,
      Math.max(0, board.scrollLeft + columnBounds.left - boardBounds.left - 10),
    );

    board.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
    setActiveColumnId(columnId);
  }

  // Drag & Drop Handlers
  const handleDragStart = (e, card, column) => {
    setDraggingCardId(card.id);
    e.dataTransfer.effectAllowed = 'move';
    // Usamos text/plain para compatibilidade maxima em todos os browsers
    e.dataTransfer.setData('text/plain', JSON.stringify({
      cardId: card.id,
      sourceColumnId: column.id,
      card,
    }));
  };

  const handleDragEnd = () => {
    setDraggingCardId(null);
    setDragOverColumnId(null);
  };

  const handleDragOver = (e, column) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== column.id) {
      setDragOverColumnId(column.id);
    }
  };

  const handleDragLeave = (e, column) => {
    if (dragOverColumnId === column.id) {
      setDragOverColumnId(null);
    }
  };

  const handleDrop = (e, targetColumn) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverColumnId(null);
    setDraggingCardId(null);
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.card) return;
      if (data.sourceColumnId === targetColumn.id) return;
      if (onMoveCard) {
        onMoveCard(data.card, targetColumn.automationKey || targetColumn.id, targetColumn);
      }
    } catch (err) {
      console.warn('Erro ao processar drop no Kanban:', err);
    }
  };

  return (
    <section className="kanban-page">
      <div className="kanban-toolbar-wrap">
        <div className="kanban-toolbar">
          <div className="kanban-toolbar-search-group">
            <div className="search-box">
              <Search size={16} />
              <input
                placeholder="Buscar por contato, serviço ou mensagem..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="kanban-toolbar-filter-group kanban-toolbar-channel-group">
            <span className="filter-label">Canais</span>
            <div className="chips">
              <button
                type="button"
                className={`chip kanban-filter-control channel-all ${channelFilter === 'todos' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange('todos')}
              >
                Todos os canais
              </button>
              {allowedChannels.includes('whatsapp') && <button
                type="button"
                className={`chip kanban-filter-control channel-whatsapp ${channelFilter === 'whatsapp' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'whatsapp' ? 'todos' : 'whatsapp')}
              >
                <SiWhatsapp className="kanban-brand-icon kanban-brand-icon--whatsapp" size={14} aria-hidden="true" /> WhatsApp
              </button>}
              {allowedChannels.includes('telegram') && <button
                type="button"
                className={`chip kanban-filter-control channel-telegram ${channelFilter === 'telegram' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'telegram' ? 'todos' : 'telegram')}
              >
                <SiTelegram className="kanban-brand-icon kanban-brand-icon--telegram" size={14} aria-hidden="true" /> Telegram
              </button>}
              {allowedChannels.includes('instagram') && <button
                type="button"
                className={`chip kanban-filter-control channel-instagram ${channelFilter === 'instagram' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'instagram' ? 'todos' : 'instagram')}
              >
                <SiInstagram className="kanban-brand-icon kanban-brand-icon--instagram" size={14} aria-hidden="true" /> Instagram
              </button>}
            </div>
          </div>

          <div className="kanban-toolbar-filter-group kanban-toolbar-agents-row">
            <span className="filter-label">Responsável</span>
            <NoriaSelect
              value={agentFilter}
              onValueChange={setAgentFilter}
              options={[
                { value: KANBAN_OWNER_FILTERS.ALL, label: 'Todos' },
                { value: KANBAN_OWNER_FILTERS.AI, label: 'Assistente IA' },
                ...agentsList
                  .filter((agent) => agent?.id && agent?.name)
                  .map((agent) => ({ value: kanbanAgentFilterValue(agent.id), label: agent.name })),
              ]}
              ariaLabel="Filtrar por responsável"
              icon={UserRound}
              className="kanban-owner-select"
              contentClassName="kanban-owner-select-content"
            />
          </div>
          <button
            type="button"
            className="secondary-button kanban-ai-flow-button"
            onClick={handleSuggestKanbanFlow}
            disabled={flowStatus === 'loading' || flowStatus === 'applying' || !orderedColumns[0]?.boardId}
          >
            {flowStatus === 'loading' ? <><RefreshCcw className="kanban-ai-flow-icon spin" size={16} /> Analisando fluxo...</> : <><Sparkles className="kanban-ai-flow-icon" size={16} /> Organizar fluxo com IA</>}
          </button>
          {kanbanActionStatus && <small className="kanban-action-status">{kanbanActionStatus}</small>}
        </div>
      </div>

      {flowProposal && (
        <section className="card" aria-live="polite">
          <h3>Proposta de organização do fluxo</h3>
          <div className="split-grid">
            <div><strong>Ordem atual</strong><ol>{orderedColumns.map((column) => <li key={column.id}>{column.title}</li>)}</ol></div>
            <div><strong>Sugestão da IA</strong><ol>{flowProposal.orderedAutomationKeys.map((key) => <li key={key}>{orderedColumns.find((column) => (column.automationKey || column.id) === key)?.title || key}</li>)}</ol></div>
          </div>
          {flowProposal.reasoning && <p>{flowProposal.reasoning}</p>}
          <div className="row-actions">
            <button type="button" className="secondary-button" onClick={() => { setFlowProposal(null); setFlowStatus('idle'); }}>Cancelar</button>
            <button type="button" className="primary-button" onClick={handleApplyKanbanFlow} disabled={flowStatus === 'applying'}>{flowStatus === 'applying' ? <><RefreshCcw className="spin" size={16} /> Aplicando...</> : 'Aplicar organização'}</button>
          </div>
        </section>
      )}
      {flowToast && (
        <div className="toast-notification" role="status">
          <AlertCircle size={18} color="#fca5a5" />
          <span>{flowToast}</span>
        </div>
      )}

      <div className="stage-navigation-wrapper">
        <div className="kanban-stage-navigation" aria-label="Navegação rápida entre etapas">
          <div className="kanban-stage-shortcuts">
            {filteredColumns.map((column) => {
              const presentation = getColumnPresentation(column);
              const ShortcutIcon = presentation.Icon;
              return (
                <button
                  key={column.id}
                  type="button"
                  className={`kanban-stage-shortcut kanban-stage-shortcut--${presentation.tone} ${activeColumnId === column.id ? 'active' : ''}`}
                  onClick={() => scrollToColumn(column.id)}
                  title={`Ir para ${presentation.displayTitle || column.title}`}
                  aria-label={`Ir para etapa ${presentation.displayTitle || column.title}`}
                >
                  <ShortcutIcon className="kanban-stage-shortcut-icon" size={17} aria-hidden="true" />
                  <span>{presentation.shortLabel}</span>
                  <strong>{ready ? column.cards.length : '—'}</strong>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="kanban-board kanban-scroll-drag-surface"
        ref={boardRef}
        onDragOver={(e) => {
          if (draggingCardId) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          if (!draggingCardId) return;
          e.preventDefault();
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const colEl = el?.closest?.('.kanban-column');
          const colId = colEl?.getAttribute('data-column-id');
          const targetCol = filteredColumns.find((c) => String(c.id) === String(colId));
          if (targetCol) {
            handleDrop(e, targetCol);
          } else {
            handleDragEnd();
          }
        }}
      >
        {filteredColumns.map((column) => {
          const isWaitingColumn = column.automationKey === 'aguardando_humano' || column.id === 'aguardando_humano';
          const isFinishedColumn = column.automationKey === 'finalizadas' || column.id === 'finalizadas';
          const isDragOver = dragOverColumnId === column.id;
          const presentation = getColumnPresentation(column);
          const StageIcon = presentation.Icon;

          return (
            <div
              className={`kanban-column kanban-column--${presentation.tone} ${isDragOver ? 'is-dragover' : ''}`}
              key={column.id}
              data-column-id={column.id}
              ref={(node) => {
                if (node) columnRefs.current.set(column.id, node);
                else columnRefs.current.delete(column.id);
              }}
              onDragOver={(e) => handleDragOver(e, column)}
              onDragLeave={(e) => handleDragLeave(e, column)}
              onDrop={(e) => handleDrop(e, column)}
            >
              <div className="column-header">
                <span className="column-stage-icon" aria-hidden="true"><StageIcon size={19} /></span>
                <div className="column-heading-copy">
                  <strong className="column-title">{presentation.displayTitle || column.title}</strong>
                  <small className="column-description">{presentation.description}</small>
                </div>
                <span className="column-count-badge">{ready ? column.cards.length : '—'}</span>
              </div>

              <div
                className="column-cards-container"
                onDragOver={(e) => handleDragOver(e, column)}
                onDrop={(e) => handleDrop(e, column)}
              >
                {!ready ? (
                  [1, 2].map((i) => (
                    <article className="kanban-card kanban-card-skeleton" key={i}>
                      <div className="kanban-card-header">
                        <SkeletonLine width="90px" height="14px" />
                        <SkeletonLine width="35px" height="11px" />
                      </div>
                      <SkeletonLine width="130px" height="12px" style={{ marginTop: '8px' }} />
                      <div className="kanban-card-footer" style={{ marginTop: '12px' }}>
                        <SkeletonLine width="60px" height="11px" />
                      </div>
                    </article>
                  ))
                ) : (
                  <>
                    {column.cards.map((card) => {
                      const channelClass = getChannelClass(card.channelType || card.channel);
                      const isDragging = draggingCardId === card.id;

                      return (
                        <article
                          className={`kanban-card ${channelClass} ${isDragging ? 'is-dragging' : ''} ${kanbanCardTransition === 'exiting' ? 'is-channel-exiting' : ''} ${kanbanCardTransition === 'entering' ? 'is-channel-entering' : ''}`}
                          key={card.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, card, column)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, column)}
                          onDrop={(e) => handleDrop(e, column)}
                        >
                          <div className="kanban-card-header">
                            <div className="contact-title-line">
                              <span className={`channel-indicator-icon ${channelClass}`}>
                                <ChannelIcon channel={card.channelType || card.channel} size={12} />
                              </span>
                              <strong className="contact-name">{card.title}</strong>
                            </div>
                            <small className="card-time">{card.lastAt}</small>
                          </div>

                          <p className="card-subtitle" title={card.subtitle || ''}>{formatConversationPreview(card.subtitle)}</p>

                          {isWaitingColumn && (
                            <div className="waiting-sla-badge">
                              <Clock3 size={11} />
                              <span>Aguardando resposta humana</span>
                            </div>
                          )}

                          {card.aiReason && (
                            <div className="ai-verification-badge">
                              <Sparkles size={12} className="ai-sparkle-icon" />
                              <span>{card.aiReason}</span>
                            </div>
                          )}

                          {card.hasSchedulingLink && (card.schedulingLink || schedulingUrl) && (
                            <div className="scheduling-link-box">
                              <div className="link-info">
                                <CalendarCheck size={14} className="calendar-icon" />
                                <span className="link-text" title={card.schedulingLink || schedulingUrl}>
                                  {formatSchedulingLink(card.schedulingLink || schedulingUrl)}
                                </span>
                              </div>
                              <div className="link-actions">
                                <button
                                  type="button"
                                  className="link-copy-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copySchedulingLink(card.id, card.schedulingLink);
                                  }}
                                  title="Copiar link de agendamento"
                                >
                                  {copiedCardId === card.id ? (
                                    <>
                                      <Check size={12} color="#10b981" /> Copiado!
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={12} /> Copiar
                                    </>
                                  )}
                                </button>
                                <a
                                  href={card.schedulingLink || schedulingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="link-external-btn"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Abrir página de agendamento"
                                >
                                  <ExternalLink size={12} />
                                </a>
                              </div>
                            </div>
                          )}

                          {card.actionType === 'confirm_signal' && (
                            <button
                              type="button"
                              className="confirm-signal-button"
                              disabled={Boolean(confirmingCardId)}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleConfirmSignal(card);
                              }}
                              title="Confirmar pagamento do sinal"
                            >
                              <CheckCircle2 size={14} />
                              {confirmingCardId === card.id ? 'Confirmando...' : 'Confirmar'}
                            </button>
                          )}

                          <div className="kanban-card-owner">
                            <div className="card-owner-info">
                              {card.ownerKind === 'ai' || card.owner === 'Assistente IA' ? (
                                <Bot size={12} />
                              ) : (
                                <UserRound size={12} />
                              )}
                              <span>{card.owner || 'Sem responsável'}</span>
                            </div>
                          </div>

                          {/* AÇÕES RÁPIDAS NO CARD (ITEM B) */}
                          <div className="kanban-card-quick-actions">
                            {onOpenChat && (
                              <button
                                type="button"
                                className="card-quick-btn chat"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenChat(card.externalConversationId || card.id);
                                }}
                                title="Abrir e responder no chat"
                              >
                                <MessageCircle size={12} />
                                <span>Responder</span>
                              </button>
                            )}

                            {onOpenAppointment && kanbanColumns.some((col) => (col.automationKey || col.id) === 'agendamentos') && (
                              <button
                                type="button"
                                className="card-quick-btn schedule"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenAppointment(card);
                                }}
                                title="Criar agendamento rápido"
                              >
                                <CalendarCheck size={12} />
                                <span>Agendar</span>
                              </button>
                            )}

                            {onFinishConversation && !isFinishedColumn && (
                              <button
                                type="button"
                                className="card-quick-btn finish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFinishConversation(card);
                                }}
                                title="Concluir e mover para Finalizadas"
                              >
                                <CheckCircle2 size={12} />
                                <span>Finalizar</span>
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!column.cards.length && <div className="column-empty">Sem conversas nesta etapa</div>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Funnel({ funnelStages, tenantName }) {
  const max = Math.max(...funnelStages.map((stage) => stage.count), 1);
  return (
    <section className="content-grid">
      <section className="panel">
        <PanelTitle icon={GitBranch} title="Funil comercial" action="Mês atual" />
        <div className="funnel-list">
          {funnelStages.map((stage) => (
            <div className="funnel-row" key={stage.id}>
              <div>
                <strong>{stage.name}</strong>
                <span>{stage.count} oportunidades · {formatCurrency(stage.value)}</span>
              </div>
              <div className="funnel-track">
                <div style={{ width: `${(stage.count / max) * 100}%` }} />
              </div>
              <em>{stage.conversion}%</em>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={CalendarCheck} title="Próximas ações" />
        <div className="task-list">
          <Task title="Testar conversa real no Telegram" meta={`${tenantName} · webhook multi-tenant`} />
          <Task title="Confirmar tenant no Supabase" meta="Banco de dados multi-tenant" />
          <Task title="Acompanhar mensagens reais" meta="Eventos de canais em tempo real" />
          <Task title="Monitorar IA paga" meta="Gemini com limite diário configurado" />
        </div>
      </section>
    </section>
  );
}

function Broadcasts({ conversations = [], contacts = [], campaigns = [], tenantSlug, onChanged, ready = true, allowedChannels = CHANNEL_OPTIONS.map(c => c.id) }) {
  const defaultChannel = allowedChannels.includes('telegram') ? 'telegram' : allowedChannels[0] || 'whatsapp';
  const [draftContacts, setDraftContacts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [messageText, setMessageText] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const allContacts = useMemo(() => {
    const conversationContacts = conversations
      .map(conversationToBroadcastContact)
      .filter((contact) => contact.externalConversationId && allowedChannels.includes(contact.channelType));
    return mergeBroadcastContacts(contacts, conversationContacts, draftContacts)
      .filter((contact) => allowedChannels.includes(contact.channelType || contact.channel_type || defaultChannel));
  }, [allowedChannels, contacts, conversations, defaultChannel, draftContacts]);
  const stages = useMemo(() => Array.from(new Set(conversations.map((item) => item.stage).filter(Boolean))), [conversations]);
  const selectedContacts = allContacts.filter((contact) => selected.has(contact.key));
  const visibleContacts = useMemo(() => {
    const query = contactSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return allContacts;
    return allContacts.filter((contact) => {
      const name = contact.name || contact.contact_name || '';
      const phone = contact.phone || contact.external_conversation_id || contact.externalConversationId || '';
      return `${name} ${phone}`.toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [allContacts, contactSearch]);
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selected.has(contact.key || contactKey(contact)));

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseContactFile(file);
      const normalized = parsed.map((row) => normalizeImportedContact(row, defaultChannel))
        .filter((row) => row.externalConversationId && allowedChannels.includes(row.channelType));
      setDraftContacts((prev) => mergeBroadcastContacts(prev, normalized));
      setSelected((prev) => {
        const next = new Set(prev);
        normalized.forEach((contact) => next.add(contactKey(contact)));
        return next;
      });
      setStatus(`${normalized.length} contatos importados.`);
    } catch (error) {
      setStatus(error.message || 'Nao foi possivel importar a planilha.');
    } finally {
      event.target.value = '';
    }
  }

  function addRecentContacts() {
    const recent = conversations.map(conversationToBroadcastContact).filter((item) => item.externalConversationId);
    setDraftContacts((prev) => mergeBroadcastContacts(prev, recent));
    setSelected((prev) => {
      const next = new Set(prev);
      recent.forEach((contact) => next.add(contactKey(contact)));
      return next;
    });
    setStatus(`${recent.length} contatos recentes adicionados.`);
  }

  function addStageContacts() {
    if (!stageFilter) return;
    const stageContacts = conversations
      .filter((conversation) => conversation.stage === stageFilter)
      .map(conversationToBroadcastContact)
      .filter((item) => item.externalConversationId);
    setDraftContacts((prev) => mergeBroadcastContacts(prev, stageContacts));
    setSelected((prev) => {
      const next = new Set(prev);
      stageContacts.forEach((contact) => next.add(contactKey(contact)));
      return next;
    });
    setStatus(`${stageContacts.length} contatos do quadro adicionados.`);
  }

  function toggleContact(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisibleContacts() {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleContacts.forEach((contact) => {
        const key = contact.key || contactKey(contact);
        if (allVisibleSelected) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  }

  function clearSelectedContacts() {
    setSelected(new Set());
  }

  async function sendCampaign() {
    const text = messageText.trim();
    if (!text || !selectedContacts.length || busy) return;
    setBusy(true);
    setStatus('Preparando disparo...');
    let sent = 0;
    let failed = 0;
    let campaign = null;
    try {
      const savedContacts = await upsertBroadcastContacts(tenantSlug, selectedContacts);
      const recipients = mergeBroadcastContacts(savedContacts, selectedContacts);
      campaign = await createBroadcastCampaign(tenantSlug, {
        name: campaignName.trim() || `Disparo ${new Date().toLocaleDateString('pt-BR')}`,
        message_template: text,
        channelType: defaultChannel,
        total_recipients: recipients.length,
        status: 'sending',
      }, recipients);

      for (const contact of recipients) {
        try {
          await updateBroadcastRecipient(campaign.id, contact.external_conversation_id || contact.externalConversationId, { status: 'sending' });
          const result = await sendN8nCommand('broadcast_send', {
            channel_type: contact.channel_type || contact.channelType || defaultChannel,
            external_conversation_id: contact.external_conversation_id || contact.externalConversationId,
            contact_name: contact.name || contact.contact_name || 'Contato',
            message_text: text,
            sent_by_user: 'Disparo NORIA',
          }, tenantSlug);
          sent += 1;
          await updateBroadcastRecipient(campaign.id, contact.external_conversation_id || contact.externalConversationId, {
            status: 'sent',
            sent_at: new Date().toISOString(),
            external_message_id: result.external_message_id || null,
          });
          setStatus(`Enviando... ${sent} enviados, ${failed} falhas.`);
        } catch (error) {
          failed += 1;
          await updateBroadcastRecipient(campaign.id, contact.external_conversation_id || contact.externalConversationId, {
            status: 'failed',
            error: error.message || String(error),
          }).catch(() => {});
        }
      }

      await updateBroadcastCampaign(campaign.id, {
        status: failed ? 'partial_error' : 'sent',
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      });
      setStatus(`Disparo concluido: ${sent} enviados, ${failed} falhas.`);
      setMessageText('');
      setCampaignName('');
      setSelected(new Set());
      await onChanged?.();
    } catch (error) {
      if (campaign?.id) {
        await updateBroadcastCampaign(campaign.id, { status: 'failed', failed_count: selectedContacts.length }).catch(() => {});
      }
      setStatus(error.message || 'Falha ao executar disparo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="broadcast-page">
      <section className="panel broadcast-campaign-panel">
        <div className="broadcast-campaign-heading">
          <h2>Nova campanha</h2>
          <p>Defina o público, escreva sua mensagem e prepare o envio.</p>
        </div>
        <div className="broadcast-grid">
          <div className="broadcast-contacts">
            <div className="broadcast-section-heading">
              <div><UsersRound size={18} /><h3>Contatos</h3></div>
              <button className="broadcast-select-all" type="button" onClick={toggleAllVisibleContacts} disabled={!visibleContacts.length}>{allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}</button>
            </div>
            <p className="broadcast-section-description">Escolha os contatos que irão receber esta campanha.</p>
            <label className="broadcast-contact-search"><Search size={16} /><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Buscar por nome ou telefone..." /></label>
            <div className="contact-table broadcast-contact-list">
              {!ready ? [1, 2, 3].map((i) => <div className="contact-row" key={i} style={{ pointerEvents: 'none' }}><SkeletonBlock width="16px" height="16px" style={{ borderRadius: '3px' }} /><SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%' }} /><div style={{ flex: 1 }}><SkeletonLine width="110px" style={{ display: 'block' }} /><SkeletonLine width="140px" style={{ marginTop: '4px', display: 'block' }} /></div></div>) : <>
                {visibleContacts.map((contact) => {
                  const key = contact.key || contactKey(contact);
                  const name = displayContactName(contact);
                  const phone = displayContactPhone(contact);
                  const channel = contact.channel_type || contact.channelType || defaultChannel;
                  return <label className={`contact-row ${selected.has(key) ? 'is-selected' : ''}`} key={key}><input type="checkbox" checked={selected.has(key)} onChange={() => toggleContact(key)} /><ContactAvatar name={name} avatarUrl={contact.avatarUrl} className="broadcast-contact-avatar" /><span className="broadcast-contact-details"><strong>{name}</strong><small>{phone}</small></span><span className={`broadcast-channel-icon ${getChannelClass(channel)}`} title={channel}><ChannelIcon channel={channel} size={16} /></span></label>;
                })}
                {!visibleContacts.length && <EmptyState title={allContacts.length ? 'Nenhum contato encontrado' : 'Nenhum contato disponível'} text={allContacts.length ? 'Tente outro nome ou telefone.' : 'Os contatos disponíveis aparecerão aqui.'} compact />}
              </>}
            </div>
          </div>
          <div className="broadcast-composer">
            <label className="broadcast-field-label"><span>Nome da campanha</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex: Confirmacao de horarios" /></label>
            <label className="broadcast-field-label"><span>Mensagem</span><textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Digite a mensagem que sera enviada aos contatos selecionados." /></label>
            <div className="broadcast-send-row"><button className="primary-button" type="button" onClick={sendCampaign} disabled={busy || !messageText.trim() || !selectedContacts.length}>Enviar</button><small>{status}</small></div>
          </div>
        </div>
      </section>
      <section className="broadcast-footer-grid">
        <section className="panel">
          <PanelTitle icon={Clock3} title="Histórico de campanhas" />
          <div className="campaign-list">
            {!ready ? [1, 2].map((i) => <article className="campaign-card" key={i} style={{ pointerEvents: 'none' }}><div style={{ flex: 1 }}><SkeletonLine width="110px" style={{ display: 'block' }} /><SkeletonLine width="140px" style={{ marginTop: '4px', display: 'block' }} /></div><SkeletonBlock width="60px" height="18px" style={{ borderRadius: '4px' }} /></article>) : <>
              {campaigns.map((campaign) => {
                const date = campaign.sent_at || campaign.created_at;
                const metadata = date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : 'Sem data';
                const statusLabel = campaign.status === 'sent' ? 'Concluída' : campaign.status === 'partial_error' ? 'Parcial' : campaign.status === 'failed' ? 'Falhou' : 'Enviando';
                const statusTone = campaign.status === 'sent' ? 'ia_ativa' : campaign.status === 'failed' ? 'humano' : 'channel';
                return <article className="campaign-card" key={campaign.id}><div><strong>{campaign.name}</strong><span>{metadata} · {campaign.total_recipients || 0} destinatários</span></div><Badge value={statusLabel} status={statusTone} /></article>;
              })}
              {!campaigns.length && <EmptyState title="Sem campanhas" text="Os disparos realizados ficarão registrados aqui." compact />}
            </>}
          </div>
        </section>
        <section className="panel">
          <div className="broadcast-selected-heading"><div><UsersRound size={18} /><h2>Contatos selecionados ({selectedContacts.length})</h2></div>{selectedContacts.length > 0 && <button type="button" onClick={clearSelectedContacts}>Limpar todos</button>}</div>
          <div className="selected-contact-list">
            {selectedContacts.map((contact) => {
              const key = contact.key || contactKey(contact);
              const name = displayContactName(contact);
              const phone = displayContactPhone(contact);
              const channel = contact.channel_type || contact.channelType || defaultChannel;
              return <article className="selected-contact-row" key={key}><ContactAvatar name={name} avatarUrl={contact.avatarUrl} className="broadcast-contact-avatar" /><span className="broadcast-contact-details"><strong>{name}</strong><small>{phone}</small></span><span className={`broadcast-channel-icon ${getChannelClass(channel)}`} title={channel}><ChannelIcon channel={channel} size={16} /></span><button type="button" aria-label={`Remover ${name}`} onClick={() => toggleContact(key)}><X size={15} /></button></article>;
            })}
            {!selectedContacts.length && <EmptyState title="Nenhum contato selecionado" text="Selecione contatos na lista acima." compact />}
          </div>
        </section>
      </section>
    </section>
  );
}

function Appointments({ appointments = [], conversations = [], tenantSlug, onChanged, initialData, ready = true }) {
  const [schedule, setSchedule] = useState(null);
  const [unitId, setUnitId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [localDate, setLocalDate] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [availableTimes, setAvailableTimes] = useState([]);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [contactName, setContactName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    setSchedule(null); setUnitId(''); setServiceId(''); setLocalDate(''); setLocalTime('');
    requestId.current = crypto.randomUUID();
    loadAppointmentScheduling(tenantSlug).then(value => { if (active) setSchedule(value); })
      .catch(() => { if (active) setStatus('Nao foi possivel carregar a agenda. Atualize a pagina antes de reservar.'); });
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    let active = true;
    setAvailableTimes([]); setLocalTime('');
    if (!schedule?.enabled || !unitId || !serviceId || !localDate) { setChecking(false); return; }
    setChecking(true);
    loadAppointmentAvailability(schedule.tenantId, unitId, serviceId, localDate)
      .then(times => { if (active) { setAvailableTimes(times); setStatus(times.length ? '' : 'Nenhum horario disponivel nesta data.'); } })
      .catch(() => { if (active) setStatus('Nao foi possivel consultar a disponibilidade. Nenhuma reserva foi criada.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [schedule, unitId, serviceId, localDate]);

  useEffect(() => {
    if (!initialData) return;
    if (initialData.contactName) setContactName(initialData.contactName);
    if (initialData.title) setTitle(initialData.title);
    if (initialData.notes) setNotes(initialData.notes);
    if (initialData.selectedConversationId) setSelectedConversationId(initialData.selectedConversationId);
  }, [initialData]);

  const grouped = useMemo(() => groupAppointmentsByDay(appointments), [appointments]);

  function pickConversation(value) {
    setSelectedConversationId(value);
    const conversation = conversations.find((item) => item.externalConversationId === value);
    if (conversation) {
      setContactName(conversation.contact || '');
      if (!title) setTitle(`Atendimento - ${conversation.contact}`);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!schedule || (schedule.enabled ? !unitId || !serviceId || !localDate || !localTime || !contactName.trim() : !title.trim() || !startsAt)) return;
    setSaving(true);
    setStatus('');
    try {
      await saveAppointment(tenantSlug, {
        title: title.trim(),
        contactName: contactName.trim(),
        startsAt: schedule.enabled ? null : new Date(startsAt).toISOString(),
        unitId, serviceId, localDate, localTime, requestId: requestId.current,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        notes: notes.trim(),
        channelType: conversations.find(c => c.externalConversationId === selectedConversationId)?.channelType || 'manual',
        externalConversationId: selectedConversationId,
      });
      setTitle('');
      setContactName('');
      setStartsAt('');
      setEndsAt('');
      setNotes('');
      setSelectedConversationId('');
      setLocalTime(''); setLocalDate(''); requestId.current = crypto.randomUUID();
      setStatus('Agendamento criado e enviado para o Kanban.');
      await onChanged?.();
    } catch (error) {
      setStatus(/SLOT_UNAVAILABLE|LEGACY_BOOKING/.test(error.message || '')
        ? 'Horario indisponivel ou aguardando revisao da equipe. Consulte outra data.'
        : error.message || 'Nao foi possivel salvar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="appointments-page">
      <section className="panel appointment-form-panel">
        <PanelTitle className="appointment-panel-title" icon={CalendarDays} title="Novo agendamento" />
        <form className="form-grid" onSubmit={handleSubmit}>
          {schedule?.enabled ? <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Unidade</span><NoriaSelect value={unitId} onValueChange={setUnitId} options={Object.entries(schedule.units).map(([id, unit]) => ({ value: id, label: unit.name }))} placeholder="Selecione" icon={Building2} className="appointment-select" /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Serviço</span><NoriaSelect value={serviceId} onValueChange={setServiceId} options={schedule.services.map(service => ({ value: service.external_id, label: service.name, category: service.category || 'Geral' }))} placeholder="Selecione" icon={CalendarCheck} className="appointment-select" contentClassName="appointment-service-select-content" /></label>
          </div> : <label className="appointment-field-label"><span className="appointment-label-text">Título</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: Sessao de bronzeamento" required /></label>}
          <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Contato</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome da cliente" required={schedule?.enabled} /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Conversa recente</span><NoriaSelect value={selectedConversationId} onValueChange={(value) => pickConversation(value === '__none__' ? '' : value)} options={[{ value: '__none__', label: 'Sem vínculo' }, ...conversations.map((conversation) => {
              const channelType = conversation.channelType || conversation.channel || 'whatsapp';
              const channelLabel = conversation.channel || (channelType === 'whatsapp' ? 'WhatsApp' : channelType);
              return {
                value: conversation.externalConversationId,
                label: conversation.contact,
                icon: (
                  <span
                    className={`noria-select-channel-icon ${getChannelClass(channelType)}`}
                    title={channelLabel}
                    aria-label={channelLabel}
                  >
                    <ChannelIcon channel={channelType} size={14} />
                  </span>
                ),
              };
            })]} placeholder="Sem vínculo" icon={MessageCircle} className="appointment-select" contentClassName="appointment-conversation-select-content" /></label>
          </div>
          {schedule?.enabled ? <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Data</span><input type="date" required value={localDate} onChange={event => setLocalDate(event.target.value)} /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Horário</span><select required value={localTime} disabled={checking || !availableTimes.length} onChange={event => setLocalTime(event.target.value)}>
              <option value="">{checking ? 'Consultando...' : 'Selecione'}</option>{availableTimes.map(time => <option key={time}>{time}</option>)}
            </select></label>
          </div> : <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Início</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Fim</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          </div>}
          <label className="textarea-label appointment-field-label"><span className="appointment-label-text">Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes internos do atendimento." /></label>
          <div className="header-actions appointment-save-row">
            <button className="primary-button" type="submit" disabled={saving || !schedule || checking || (schedule.enabled ? !localTime || !contactName.trim() : !title.trim() || !startsAt)}><CalendarCheck size={16} /> Salvar agendamento</button>
            <small>{status}</small>
          </div>
        </form>
      </section>

      <section className="panel appointment-list-panel">
        <PanelTitle className="appointment-panel-title" icon={Clock3} title="Agenda" action={ready ? `${appointments.length} ${appointments.length === 1 ? 'agendamento' : 'agendamentos'}` : '— agendamentos'} />
        <div className="appointment-groups">
          {!ready ? (
            <div className="appointment-day appointment-day-skeleton">
              <SkeletonLine width="110px" height="14px" style={{ marginBottom: '12px', display: 'block' }} />
              {[1, 2, 3].map((i) => (
                <article className="appointment-card appointment-card-skeleton" key={i}>
                  <div className="appointment-time">
                    <SkeletonLine width="38px" height="14px" />
                    <SkeletonLine width="38px" height="11px" style={{ marginTop: '4px' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <SkeletonLine width="130px" height="14px" style={{ display: 'block' }} />
                    <SkeletonLine width="90px" height="12px" style={{ marginTop: '5px', display: 'block' }} />
                  </div>
                  <SkeletonBlock width="70px" height="18px" style={{ borderRadius: '4px' }} />
                </article>
              ))}
            </div>
          ) : (
            <>
              {grouped.map((group) => (
                <div className="appointment-day" key={group.day}>
                  <h3>{group.day}</h3>
                  {group.items.map((appointment) => (
                    <article className="appointment-card" key={appointment.id} data-status={appointment.status}>
                      <div className="appointment-card-content">
                        <div className="appointment-card-heading">
                          <div className="appointment-card-title-row">
                            <div className="appointment-time"><strong>{appointment.timeLabel}</strong><span>{appointment.endTimeLabel || '--:--'}</span></div>
                            <strong>{appointment.title}</strong>
                          </div>
                          <Badge value={appointment.statusLabel} status="channel" />
                        </div>
                        <div className="appointment-contact-row">
                          <UserRound size={14} />
                          <span>{appointment.contactName || 'Sem contato'}</span>
                          <span
                            className={`appointment-channel-meta ${getChannelClass(appointment.channelType)}`}
                            title={appointment.channelLabel || 'WhatsApp'}
                            aria-label={appointment.channelLabel || 'WhatsApp'}
                          >
                            <ChannelIcon channel={appointment.channelType} size={14} />
                          </span>
                        </div>
                        {appointment.unitName && (
                          <span className="appointment-location-meta"><MapPin size={14} />{appointment.unitName}</span>
                        )}
                        {appointment.notes && <p className="appointment-card-notes">{appointment.notes}</p>}
                      </div>
                    </article>
                  ))}
                </div>
              ))}
              {!appointments.length && <EmptyState title="Nenhum agendamento" text="Crie um agendamento para acompanhar seus próximos atendimentos." compact />}
            </>
          )}
        </div>
      </section>
    </section>
  );
}

function parseBusinessHours(bh) {
  if (!bh || typeof bh !== 'object') {
    if (typeof bh === 'string' && bh.trim()) {
      const parts = bh.trim().split('·').map((s) => s.trim());
      if (parts.length >= 2) {
        return { days: parts[0], time: parts[1], extra: parts.slice(2).join(' · ') || null };
      }
      return { days: null, time: bh.trim(), extra: null };
    }
    return null;
  }
  if (Object.keys(bh).length === 0) return null;

  if (bh.start && bh.end) {
    const days = Array.isArray(bh.days) ? bh.days : [];
    let daysLabel = 'Todos os dias';
    if (days.length === 7) {
      daysLabel = 'Todos os dias';
    } else if (days.length === 6 && days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sábado';
    } else if (days.length === 5 && !days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sexta';
    } else if (days.length > 0) {
      const mapDay = {
        segunda: 'Seg', terca: 'Ter', quarta: 'Qua', quinta: 'Qui',
        sexta: 'Sex', sabado: 'Sáb', domingo: 'Dom',
      };
      daysLabel = days.map((d) => mapDay[String(d).toLowerCase()] || d).join(', ');
    }
    return {
      days: daysLabel,
      time: `${bh.start} às ${bh.end}`,
      extra: null,
    };
  }

  if (bh.weekdays) {
    return {
      days: 'Segunda a Sexta',
      time: bh.weekdays,
      extra: bh.saturday ? `Sábado: ${bh.saturday}` : null,
    };
  }

  const values = Object.values(bh).filter((v) => typeof v === 'string');
  if (values.length > 0) {
    const parts = values[0].split('·').map((s) => s.trim());
    if (parts.length >= 2) {
      return { days: parts[0], time: parts[1], extra: values.length > 1 ? values.slice(1).join(' · ') : null };
    }
    return {
      days: null,
      time: values[0],
      extra: values.length > 1 ? values.slice(1).join(' · ') : null,
    };
  }

  return null;
}

function formatBusinessHoursSummary(bh) {
  if (!bh || typeof bh !== 'object') return null;
  if (typeof bh === 'string' && bh.trim()) return bh.trim();
  if (Object.keys(bh).length === 0) return null;

  if (bh.start && bh.end) {
    const days = Array.isArray(bh.days) ? bh.days : [];
    let daysLabel = 'Todos os dias';
    if (days.length === 7) {
      daysLabel = 'Todos os dias';
    } else if (days.length === 6 && days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sábado';
    } else if (days.length === 5 && !days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sexta';
    } else if (days.length > 0) {
      const mapDay = {
        segunda: 'Seg',
        terca: 'Ter',
        quarta: 'Qua',
        quinta: 'Qui',
        sexta: 'Sex',
        sabado: 'Sáb',
        domingo: 'Dom',
      };
      daysLabel = days.map((d) => mapDay[String(d).toLowerCase()] || d).join(', ');
    }
    return `${daysLabel} · ${bh.start} às ${bh.end}`;
  }

  if (bh.weekdays) {
    return `Seg a Sex: ${bh.weekdays}${bh.saturday ? ` · Sáb: ${bh.saturday}` : ''}`;
  }

  const values = Object.values(bh).filter((v) => typeof v === 'string');
  if (values.length > 0) return values.join(' · ');

  return null;
}

function SettingsPage({
  agents = [],
  agentsReady = true,
  onAddAgent,
  onToggleAgentStatus,
  onDeleteAgent,
  tenant,
  tenantName,
  tenantSettings,
  tenantSlug,
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [branch, setBranch] = useState('');
  const [shift, setShift] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Unidades reais de appointment_scheduling.units
  const rawUnits = tenantSettings?.settings?.appointment_scheduling?.units;
  const rawLocations = tenantSettings?.settings?.business_facts?.locations;

  const locationsList = useMemo(() => {
    if (Array.isArray(rawLocations)) return rawLocations;
    if (rawLocations && typeof rawLocations === 'object') {
      return Object.entries(rawLocations).map(([k, v]) => ({ id: v?.id || k, ...v }));
    }
    return [];
  }, [rawLocations]);

  const unitsList = useMemo(() => {
    if (!rawUnits) return [];
    let list = [];
    if (Array.isArray(rawUnits)) {
      list = rawUnits.map((u) => ({ id: u.id || u.slug || u.name, name: u.name || u.label || u.id, ...u }));
    } else if (typeof rawUnits === 'object') {
      list = Object.entries(rawUnits).map(([key, val]) => ({
        id: val?.id || val?.slug || key,
        name: val?.name || val?.label || key,
        ...val,
      }));
    }

    return list.map((unit) => {
      const matchedLoc = locationsList.find((loc) =>
        String(loc?.id || '').toLowerCase() === String(unit?.id || '').toLowerCase()
      );
      const address = matchedLoc?.address || unit?.address || null;
      const displayName = matchedLoc?.name || unit?.name || unit?.id;
      return {
        ...unit,
        displayName,
        address,
      };
    });
  }, [rawUnits, locationsList]);

  // KPIs dinâmicos derivados do tenant atual
  const activeCount = agents.filter((ag) => {
    const isOnline = (String(ag.status || '').toLowerCase() === 'online' || String(ag.status || '').toLowerCase() === 'ativo') && ag.is_active !== false;
    return isOnline;
  }).length;
  const pausedCount = Math.max(0, agents.length - activeCount);

  // Canais habilitados: SOMENTE os configurados em enabled_channels (sem fallback)
  const rawEnabledChannels = tenantSettings?.settings?.enabled_channels;
  const hasChannelsConfigured = Array.isArray(rawEnabledChannels);
  const enabledChannelsList = hasChannelsConfigured ? rawEnabledChannels : [];

  // Horários de atendimento condicional (se não existir/estiver vazio, card é omitido)
  const rawBusinessHours = tenantSettings?.business_hours || tenantSettings?.businessHours;
  const businessHoursSummary = formatBusinessHoursSummary(rawBusinessHours);
  const businessHoursData = parseBusinessHours(rawBusinessHours);

  // Popovers para +N outras unidades e +N outros canais
  const [showUnitsPopover, setShowUnitsPopover] = useState(false);
  const unitsPopoverRef = useRef(null);

  const [showChannelsPopover, setShowChannelsPopover] = useState(false);
  const channelsPopoverRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (unitsPopoverRef.current && !unitsPopoverRef.current.contains(e.target)) {
        setShowUnitsPopover(false);
      }
      if (channelsPopoverRef.current && !channelsPopoverRef.current.contains(e.target)) {
        setShowChannelsPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const maxVisibleChannels = 3;
  const visibleChannels = enabledChannelsList.slice(0, maxVisibleChannels);
  const otherChannels = enabledChannelsList.slice(maxVisibleChannels);

  function getChannelIcon(channel) {
    const c = String(channel || '').toLowerCase();
    if (c === 'whatsapp') return <SiWhatsapp size={14} />;
    if (c === 'telegram') return <SiTelegram size={14} />;
    if (c === 'instagram') return <SiInstagram size={14} />;
    return <Radio size={14} />;
  }

  function getChannelLabel(channel) {
    const c = String(channel || '').toLowerCase();
    if (c === 'whatsapp') return 'WhatsApp';
    if (c === 'telegram') return 'Telegram';
    if (c === 'instagram') return 'Instagram';
    return channel;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    try {
      await onAddAgent?.({
        id: `ag-${Date.now()}`,
        name: trimmedName,
        role: role.trim() || null,
        branch: branch.trim() || null, // branch enviado explicitamente como null quando vazio
        shift: shift.trim() || null,   // shift como texto livre, null se vazio
        status: 'online',
        is_active: true,
      });
      setName('');
      setRole('');
      setBranch('');
      setShift('');
    } finally {
      setSubmitting(false);
    }
  }

  const unitOptions = useMemo(() => [
    { value: '', label: 'Sem unidade vinculada' },
    ...unitsList.map((u) => ({ value: u.displayName || u.name, label: u.displayName || u.name })),
  ], [unitsList]);

  return (
    <section className="settings-page">
      {/* 1. KPIs Dinâmicos de Resumo */}
      <div className="settings-kpi-grid">
        {/* KPI 1: Atendentes Cadastrados */}
        <div className="settings-kpi-card kpi-team">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap team-icon">
              <UsersRound size={15} />
            </div>
            <span className="settings-kpi-title">Atendentes Cadastrados</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{agents.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-pill-group">
              <span className="settings-kpi-pill active">
                <span className="settings-kpi-dot active" />
                {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}
              </span>
              <span className="settings-kpi-pill paused">
                <span className="settings-kpi-dot paused" />
                {pausedCount} {pausedCount === 1 ? 'pausado' : 'pausados'}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Unidades Operacionais */}
        <div className="settings-kpi-card kpi-units">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap unit-icon">
              <Building2 size={15} />
            </div>
            <span className="settings-kpi-title">Unidades Operacionais</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{unitsList.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            {unitsList.length === 0 ? (
              <span className="settings-kpi-address-text empty">
                Nenhuma unidade cadastrada ainda
              </span>
            ) : (
              <div className="settings-kpi-unit-summary">
                <span className="settings-kpi-unit-name" title={unitsList[0].displayName}>
                  {unitsList[0].displayName}
                </span>
                <div className="settings-kpi-unit-address-row">
                  <MapPin size={10} className="settings-kpi-pin-icon" />
                  <span
                    className={`settings-kpi-address-text ${!unitsList[0].address ? 'empty' : ''}`}
                    title={unitsList[0].address || 'Sem endereço cadastrado ainda'}
                  >
                    {unitsList[0].address ? unitsList[0].address : 'Sem endereço cadastrado ainda'}
                  </span>
                </div>
                {unitsList.length > 1 && (
                  <div className="settings-kpi-more-wrap" ref={unitsPopoverRef}>
                    <button
                      type="button"
                      className="settings-kpi-more-btn"
                      onClick={() => setShowUnitsPopover((v) => !v)}
                      onMouseEnter={() => setShowUnitsPopover(true)}
                      onMouseLeave={() => setShowUnitsPopover(false)}
                      aria-haspopup="true"
                      aria-expanded={showUnitsPopover}
                    >
                      +{unitsList.length - 1} {unitsList.length - 1 === 1 ? 'outra unidade' : 'outras unidades'}
                    </button>
                    {showUnitsPopover && (
                      <div
                        className="settings-kpi-popover units-popover"
                        onMouseEnter={() => setShowUnitsPopover(true)}
                        onMouseLeave={() => setShowUnitsPopover(false)}
                      >
                        <div className="settings-kpi-popover-title">
                          Demais Unidades ({unitsList.length - 1})
                        </div>
                        <div className="settings-kpi-popover-list">
                          {unitsList.slice(1).map((u) => (
                            <div key={u.id} className="settings-kpi-popover-item">
                              <strong className="settings-kpi-popover-item-name">{u.displayName}</strong>
                              <span className="settings-kpi-popover-item-addr">
                                <MapPin size={10} className="settings-kpi-pin-icon" />
                                {u.address || 'Sem endereço cadastrado ainda'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: Canais Habilitados */}
        <div className="settings-kpi-card kpi-channels">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap channel-icon">
              <Radio size={15} />
            </div>
            <span className="settings-kpi-title">Canais Habilitados</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{enabledChannelsList.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-channels-row">
              {visibleChannels.map((ch) => (
                <span
                  key={ch}
                  className={`settings-channel-icon-badge channel-${ch}`}
                  title={getChannelLabel(ch)}
                  aria-label={getChannelLabel(ch)}
                  role="img"
                >
                  {getChannelIcon(ch)}
                </span>
              ))}
              {otherChannels.length > 0 && (
                <div className="settings-kpi-more-wrap" ref={channelsPopoverRef}>
                  <button
                    type="button"
                    className="settings-kpi-more-btn channel-more-btn"
                    onClick={() => setShowChannelsPopover((v) => !v)}
                    onMouseEnter={() => setShowChannelsPopover(true)}
                    onMouseLeave={() => setShowChannelsPopover(false)}
                    aria-label={`Ver mais ${otherChannels.length} canais`}
                  >
                    +{otherChannels.length}
                  </button>
                  {showChannelsPopover && (
                    <div
                      className="settings-kpi-popover channels-popover"
                      onMouseEnter={() => setShowChannelsPopover(true)}
                      onMouseLeave={() => setShowChannelsPopover(false)}
                    >
                      <div className="settings-kpi-popover-title">
                        Outros Canais ({otherChannels.length})
                      </div>
                      <div className="settings-kpi-popover-channels">
                        {otherChannels.map((ch) => (
                          <div key={ch} className="settings-kpi-popover-channel-row">
                            <span className={`settings-channel-icon-badge channel-${ch}`}>
                              {getChannelIcon(ch)}
                            </span>
                            <span className="settings-kpi-popover-channel-name">{getChannelLabel(ch)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {enabledChannelsList.length === 0 && (
                <span className="settings-kpi-empty-text">Nenhum canal habilitado</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI 4: Horário de Atendimento */}
        <div className="settings-kpi-card kpi-hours">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap hours-icon">
              <Clock3 size={15} />
            </div>
            <span className="settings-kpi-title">Horário de Atendimento</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-hours-center-block">
              {businessHoursData?.days && (
                <span className="settings-kpi-hours-days">{businessHoursData.days}</span>
              )}
              <span className="settings-kpi-hours-time" title={businessHoursSummary || ''}>
                {businessHoursData?.time || 'Sem horário configurado'}
              </span>
            </div>
            {businessHoursData?.extra ? (
              <span className="settings-kpi-hours-extra">{businessHoursData.extra}</span>
            ) : (
              <div className="settings-kpi-hours-spacer" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      {/* 2. Grid Principal: 40% Formulário / 60% Lista de Atendentes */}
      <div className="settings-main-grid">
        {/* Formulário (40%) */}
        <section className="panel settings-form-panel">
          <PanelTitle className="settings-panel-title" icon={UserCheck} title="Cadastrar Atendente" />
          <p className="settings-panel-desc">
            Cadastre os atendentes humanos do estabelecimento para receberem atendimentos transferidos no chat.
          </p>

          <form className="settings-agent-form" onSubmit={handleSubmit}>
            <div className="settings-form-row">
              <label className="settings-field-label">
                Nome Completo do Atendente *
                <input
                  className="settings-input"
                  placeholder="Ex: Camila Recepção, Dra. Mariana..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>

              <label className="settings-field-label">
                Cargo / Função
                <input
                  className="settings-input"
                  placeholder="Ex: Atendimento, Recepcionista, Dentista..."
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
            </div>

            <div className="settings-form-row">
              <label className="settings-field-label">
                Unidade / Filial
                {unitsList.length > 0 ? (
                  <NoriaSelect
                    value={branch}
                    onChange={setBranch}
                    options={unitOptions}
                    placeholder="Selecione a unidade"
                  />
                ) : (
                  <input
                    className="settings-input"
                    placeholder="Ex: Filial Centro (opcional)"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                )}
              </label>

              <label className="settings-field-label">
                Turno / Horário de Trabalho
                <input
                  className="settings-input"
                  placeholder="Ex: 08:00 às 18:00, Manhã, Plantão..."
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                />
              </label>
            </div>

            <button
              className="primary-button settings-submit-btn"
              type="submit"
              disabled={!name.trim() || submitting}
            >
              <UserCheck size={16} />
              <span>{submitting ? 'Salvando...' : 'Salvar Atendente'}</span>
            </button>
          </form>
        </section>

        {/* Lista de Equipe (60%) */}
        <section className="panel settings-team-panel">
          <PanelTitle className="settings-panel-title" icon={UsersRound} title="Equipe de Atendimento" />
          <p className="settings-panel-desc">
            Atendentes disponíveis para transferência manual na aba de conversas.
          </p>

          <div className="settings-team-list">
            {!agentsReady ? (
              [1, 2, 3].map((i) => (
                <article className="settings-agent-card agent-card-skeleton" key={i}>
                  <div className="settings-agent-avatar-col">
                    <div className="skeleton-block" style={{ width: '38px', height: '38px', borderRadius: '8px' }} />
                  </div>
                  <div className="settings-agent-info">
                    <div className="settings-agent-top-row">
                      <SkeletonLine width="120px" height="16px" />
                      <SkeletonBlock width="60px" height="20px" style={{ borderRadius: '999px' }} />
                    </div>
                    <SkeletonLine width="90px" height="14px" style={{ marginTop: '6px' }} />
                  </div>
                  <div className="settings-agent-actions">
                    <SkeletonBlock width="70px" height="32px" style={{ borderRadius: '6px' }} />
                    <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '6px' }} />
                  </div>
                </article>
              ))
            ) : (
              <>
                {agents.map((agent) => {
                  const isOnline = (String(agent.status || '').toLowerCase() === 'online' || String(agent.status || '').toLowerCase() === 'ativo') && agent.is_active !== false;
                  const statusLabel = isOnline ? 'Ativo' : 'Pausado';
                  const initials = getInitials(agent.name);

                  return (
                    <article className="settings-agent-card" key={agent.id}>
                      <div className="settings-agent-avatar-col">
                        <div className={`settings-agent-avatar ${isOnline ? 'online' : 'standby'}`}>
                          <span>{initials}</span>
                        </div>
                      </div>

                      <div className="settings-agent-info">
                        <div className="settings-agent-top-row">
                          <div className="settings-agent-identity">
                            <strong className="settings-agent-name">{agent.name}</strong>
                            {agent.role && (
                              <span className="settings-agent-role-badge">{agent.role}</span>
                            )}
                          </div>
                        </div>

                        {(agent.branch || agent.shift) && (
                          <div className="settings-agent-meta-chips">
                            {agent.branch && (
                              <span className="settings-meta-chip">
                                <Building2 size={12} />
                                <span>{agent.branch}</span>
                              </span>
                            )}
                            {agent.shift && (
                              <span className="settings-meta-chip">
                                <Clock3 size={12} />
                                <span>{agent.shift}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="settings-agent-actions">
                        <span className={`status-dot-badge ${isOnline ? 'online' : 'standby'}`}>
                          <span className="pulse-dot" />
                          {statusLabel}
                        </span>
                        <button
                          className="secondary-button compact-btn settings-agent-toggle-btn"
                          type="button"
                          title="Alternar status do atendente"
                          onClick={() => onToggleAgentStatus?.(agent.id)}
                        >
                          {isOnline ? 'Pausar' : 'Retomar'}
                        </button>
                        <button
                          className="icon-button compact-btn text-danger settings-agent-delete-btn"
                          type="button"
                          title="Excluir atendente"
                          onClick={() => onDeleteAgent?.(agent.id)}
                        >
                          <Trash2 size={14} />
                          <span className="btn-text-mobile">Excluir</span>
                        </button>
                      </div>
                    </article>
                  );
                })}

                {!agents.length && (
                  <EmptyState
                    title="Nenhum atendente cadastrado"
                    text="Cadastre os atendentes e operadores da equipe no formulário ao lado para poder transferir atendimentos a eles."
                    compact
                  />
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

async function parseContactFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xls')) {
    throw new Error('Arquivo .xls legado nao e suportado. Salve como .xlsx ou CSV.');
  }
  if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
    return parseDelimitedContacts(await file.text());
  }
  const rows = await readXlsxFile(file);
  return rowsToObjects(rows);
}

function parseDelimitedContacts(text) {
  const delimiter = text.includes(';') ? ';' : ',';
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  return rowsToObjects(rows);
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header || `coluna_${index + 1}`] = row[index] ?? '';
    });
    return item;
  });
}

function normalizeImportedContact(row, defaultChannel = 'telegram') {
  const lookup = (...keys) => {
    for (const key of keys) {
      const match = Object.keys(row).find((item) => normalizeKey(item) === normalizeKey(key));
      if (match && row[match] !== undefined && row[match] !== '') return String(row[match]).trim();
    }
    return '';
  };
  const externalConversationId = lookup(
    'chat_id',
    'telegram_id',
    'id_telegram',
    'external_conversation_id',
    'id_conversa',
    'conversation_id',
    'telefone',
    'phone',
  );
  return {
    name: lookup('nome', 'name', 'contato', 'cliente') || 'Contato',
    channelType: lookup('canal', 'channel', 'channel_type') || defaultChannel,
    externalConversationId,
    phone: lookup('telefone', 'phone', 'whatsapp'),
    email: lookup('email', 'e-mail'),
    source: 'import',
    key: contactKey({ channelType: lookup('canal', 'channel', 'channel_type') || defaultChannel, externalConversationId }),
  };
}

function conversationToBroadcastContact(conversation) {
  return {
    name: conversation.contact,
    channelType: conversation.channelType || 'telegram',
    externalConversationId: conversation.externalConversationId,
    source: 'conversation',
    avatarUrl: conversation.avatarUrl || null,
    metadata: { stage: conversation.stage, status: conversation.status },
    key: contactKey({ channelType: conversation.channelType || 'telegram', externalConversationId: conversation.externalConversationId }),
  };
}

function contactKey(contact) {
  return `${contact.channel_type || contact.channelType || 'telegram'}:${contact.external_conversation_id || contact.externalConversationId || contact.id || ''}`;
}

function mergeBroadcastContacts(...groups) {
  const byKey = new Map();
  groups.flat().filter(Boolean).forEach((contact) => {
    const normalized = {
      ...contact,
      channelType: contact.channelType || contact.channel_type || 'telegram',
      externalConversationId: contact.externalConversationId || contact.external_conversation_id || '',
      key: contact.key || contactKey(contact),
    };
    if (normalized.externalConversationId) byKey.set(normalized.key, normalized);
  });
  return Array.from(byKey.values());
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function groupAppointmentsByDay(appointments) {
  const groups = new Map();
  appointments
    .slice()
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .forEach((appointment) => {
      const day = appointment.startsAt
        ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(appointment.startsAt))
        : 'Sem data';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(appointment);
    });
  return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
}

function PanelTitle({ icon: Icon, title, action, className = '' }) {
  return (
    <div className={`panel-title ${className}`}>
      <div><Icon size={18} /><h2>{title}</h2></div>
      {action && <button type="button">{action}</button>}
    </div>
  );
}

function Badge({ value, status }) {
  return <span className={`badge ${status}`}>{value}</span>;
}

function Signal({ icon: Icon, label, value, tone }) {
  return (
    <div className={`signal ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Task({ title, meta }) {
  return (
    <div className="task">
      <CheckCircle2 size={18} />
      <div><strong>{title}</strong><span>{meta}</span></div>
    </div>
  );
}

function EmptyState({ title, text, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <Inbox size={compact ? 18 : 24} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function AuthShell({ title, children }) {
  return (
    <main className="auth-page auth-loading-page">
      <div className="auth-visual-ambient-aurora cyan auth-loading-aurora" />
      <div className="auth-visual-ambient-aurora violet auth-loading-aurora" />
      <section className="auth-loading-card">
        <div className="brand auth-loading-brand">
          <img src={noriaLogo} alt="NORIA" className="auth-loading-logo-img" />
          <span className="auth-loading-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
        </div>
        {!children && <div className="auth-loading-indicator">
          <RefreshCcw size={20} className="spin" />
        </div>}
        <h1 className="auth-loading-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithPassword(email.trim(), password);
    } catch (loginError) {
      setError(loginError.message || 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      {/* Lado Esquerdo: Área Visual e Marca NORIA (Hero Central Inspirado na Ref 1) */}
      <section className="auth-visual-side" aria-hidden="true">
        {/* Iluminação Ambiental & Efeitos Difusos */}
        <div className="auth-visual-ambient-aurora cyan" />
        <div className="auth-visual-ambient-aurora violet" />
        <div className="auth-visual-ambient-glow" />
        <div className="auth-visual-grid-overlay" />

        {/* Composição Hero Integrada: Logo Grande + Tagline + Rede de Fluxo */}
        <div className="auth-hero-composition">
          <div className="auth-hero-branding">
            <img src={noriaLogo} alt="NORIA" className="auth-hero-logo-img" />
            <span className="auth-hero-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
          </div>

          <div className="auth-visual-art">
            <svg
              className="auth-network-svg"
              viewBox="0 0 600 420"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.95" />
                  <stop offset="45%" stopColor="#00E0FF" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="flowGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#7861FF" stopOpacity="0.85" />
                  <stop offset="55%" stopColor="#00E0FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="flowGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.8" />
                  <stop offset="60%" stopColor="#7861FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0.1" />
                </linearGradient>
                <radialGradient id="nodeGlowCyan" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="1" />
                  <stop offset="35%" stopColor="#00E0FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="nodeGlowViolet" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#7861FF" stopOpacity="1" />
                  <stop offset="35%" stopColor="#7861FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="coreAuraGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.25" />
                  <stop offset="60%" stopColor="#7861FF" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Anéis orbitais sutis de fundo */}
              <ellipse cx="300" cy="210" rx="270" ry="180" stroke="rgba(0, 224, 255, 0.04)" strokeWidth="1" strokeDasharray="8 8" className="auth-orbital-ring-1 auth-secondary-orbital" />
              <circle cx="300" cy="210" r="140" stroke="rgba(120, 97, 255, 0.05)" strokeWidth="1" strokeDasharray="4 6" className="auth-orbital-ring-2 auth-secondary-orbital" />
              <circle cx="300" cy="210" r="48" stroke="rgba(0, 224, 255, 0.14)" strokeWidth="1" strokeDasharray="3 3" className="auth-core-ring" />

              {/* Malha de conexões secundárias (linhas estáticas finas) */}
              <line x1="80" y1="130" x2="190" y2="75" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="190" y1="75" x2="360" y2="85" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="360" y1="85" x2="510" y2="140" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="80" y1="130" x2="140" y2="280" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="140" y1="280" x2="290" y2="350" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="290" y1="350" x2="470" y2="310" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="470" y1="310" x2="510" y2="140" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="190" y1="75" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="140" y1="280" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="360" y1="85" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="470" y1="310" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />

              {/* Rotas de fluxo ativo (curvas bezier com traços e gradiente) */}
              <path
                id="flowRouteMain"
                className="auth-flow-line"
                d="M 80 130 Q 180 200 300 210 T 510 140"
                stroke="url(#flowGradient)"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
              <path
                id="flowRouteSecondary"
                className="auth-flow-line-secondary auth-secondary-route"
                d="M 190 75 Q 300 210 290 350 T 470 310"
                stroke="url(#flowGrad2)"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
              <path
                id="flowRouteTertiary"
                className="auth-flow-line-tertiary auth-secondary-route"
                d="M 140 280 Q 220 180 300 210 T 360 85"
                stroke="url(#flowGrad3)"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Pulsos luminosos viajando pelas rotas */}
              <circle className="auth-pulse-particle" r="4.5" fill="#00E0FF">
                <animateMotion
                  path="M 80 130 Q 180 200 300 210 T 510 140"
                  dur="7.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="auth-pulse-particle-violet auth-secondary-particle" r="4" fill="#7861FF">
                <animateMotion
                  path="M 190 75 Q 300 210 290 350 T 470 310"
                  dur="9.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="auth-pulse-particle-cyan-small auth-secondary-particle" r="3.2" fill="#00E0FF">
                <animateMotion
                  path="M 140 280 Q 220 180 300 210 T 360 85"
                  dur="11s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Nós da Rede Deliberados (hierarquia luminosa controlada) */}
              {/* 1. Origem Esquerda (Cyan - Primário) */}
              <circle cx="80" cy="130" r="18" fill="url(#nodeGlowCyan)" className="auth-node-pulse-1" />
              <circle cx="80" cy="130" r="5.5" fill="#00E0FF" />
              <circle cx="80" cy="130" r="2.5" fill="#FFFFFF" />

              {/* 2. Topo Esquerda (Secundário) */}
              <circle cx="190" cy="75" r="14" fill="url(#nodeGlowCyan)" className="auth-secondary-node" />
              <circle cx="190" cy="75" r="4.5" fill="#00E0FF" className="auth-secondary-node" />

              {/* 3. NÚCLEO CENTRAL NORIA (Primário com aura e anéis) */}
              <circle cx="300" cy="210" r="38" fill="url(#coreAuraGlow)" />
              <circle cx="300" cy="210" r="24" fill="url(#nodeGlowCyan)" className="auth-core-glow" />
              <circle cx="300" cy="210" r="8" fill="#0B1220" stroke="#00E0FF" strokeWidth="2.5" />
              <circle cx="300" cy="210" r="3.5" fill="#00E0FF" />

              {/* 4. Topo Direita (Secundário) */}
              <circle cx="360" cy="85" r="14" fill="url(#nodeGlowViolet)" className="auth-secondary-node" />
              <circle cx="360" cy="85" r="4.5" fill="#7861FF" className="auth-secondary-node" />

              {/* 5. Destino Direita (Primário com centro branco) */}
              <circle cx="510" cy="140" r="20" fill="url(#nodeGlowViolet)" className="auth-node-pulse-2" />
              <circle cx="510" cy="140" r="6" fill="#7861FF" />
              <circle cx="510" cy="140" r="2.5" fill="#FFFFFF" />

              {/* 6. Fundo Esquerda (Secundário) */}
              <circle cx="140" cy="280" r="13" fill="url(#nodeGlowCyan)" className="auth-secondary-node" />
              <circle cx="140" cy="280" r="4" fill="#00E0FF" className="auth-secondary-node" />

              {/* 7. Fundo Centro (Primário) */}
              <circle cx="290" cy="350" r="16" fill="url(#nodeGlowViolet)" />
              <circle cx="290" cy="350" r="5" fill="#7861FF" />
              <circle cx="290" cy="350" r="2" fill="#FFFFFF" />

              {/* 8. Fundo Direita (Secundário) */}
              <circle cx="470" cy="310" r="15" fill="url(#nodeGlowViolet)" className="auth-secondary-node" />
              <circle cx="470" cy="310" r="5" fill="#7861FF" className="auth-secondary-node" />
            </svg>
          </div>
        </div>
      </section>

      {/* Divisor Vertical Dinâmico com Highlight Móvel */}
      <div className="auth-dynamic-divider" aria-hidden="true">
        <div className="auth-divider-pulse" />
      </div>

      {/* Lado Direito: Formulário de Autenticação com Profundidade & Camadas Glass */}
      <section className="auth-form-side">
        {/* Iluminação Ambiental & Spotlight Atrás do Card */}
        <div className="auth-form-spotlight-cyan" />
        <div className="auth-form-spotlight-violet" />
        <div className="auth-form-ambient-glow" />
        <div className="auth-form-decor-orbit" aria-hidden="true" />

        <div className="auth-form-container">
          {/* Top Accent Line Sutil com Pulso Móvel Mobile */}
          <div className="auth-card-top-accent" aria-hidden="true">
            <div className="auth-card-top-pulse" />
          </div>

          <div className="auth-mobile-brand">
            <img src={noriaLogo} alt="NORIA" className="auth-mobile-logo-img" />
            <span className="auth-mobile-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
          </div>

          <h1 className="auth-title">Bem-vindo</h1>

          <form className="auth-form" onSubmit={handleSubmit} noValidate={false}>
            <label className="auth-label">
              <span>E-mail</span>
              <div className="auth-input-wrapper">
                <Mail size={17} className="auth-input-icon" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nome@empresa.com"
                  autoComplete="email"
                  required
                />
              </div>
            </label>

            <label className="auth-label">
              <span>Senha</span>
              <div className="auth-input-wrapper auth-password-input-wrapper">
                <Lock size={17} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {error && (
              <div className="inline-error auth-error-box" role="alert">
                {error}
              </div>
            )}

            <button className="primary-button auth-submit-btn" type="submit" disabled={loading}>
              <span className="auth-submit-shine" aria-hidden="true" />
              {loading ? (
                <>
                  <RefreshCcw size={16} className="spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar</span>
                  <ArrowRight size={17} className="auth-submit-arrow" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
