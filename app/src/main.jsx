import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canCloseConversation } from './conversationLifecycle';
import { CHANNEL_OPTIONS, isTenantAuthorized } from './tenantAccess';
import { createRoot } from 'react-dom/client';
import readXlsxFile from 'read-excel-file/browser';
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
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
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
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Music2,
  RefreshCcw,
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
import { getIntegrationStatus, integrationTargets, sendN8nCommand } from './integration';
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
  persistTenantSlug,
  saveAppointment,
  loadAppointmentScheduling,
  loadAppointmentAvailability,
  subscribeToClientEvents,
  updateBroadcastCampaign,
  updateBroadcastRecipient,
  upsertBroadcastContacts,
  removeTeamAgent,
  saveTeamAgent,
  updateTeamAgentStatus,
} from './dataService';
import noriaLogo from './assets/noria_logo.png';
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
  currentScope.current = hasTenantAccess ? scopeKey : '';
  const allowedChannels = appData.enabledChannels || [];

  const [agentsList, setAgentsList] = useState([]);
  const [initialConversationId, setInitialConversationId] = useState(null);
  const [prefilledAppointment, setPrefilledAppointment] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const handleMoveKanbanCard = async (card, targetColumnKey) => {
    // Atualização otimista no estado local
    setAppData((prev) => {
      if (!prev?.kanbanColumns) return prev;
      const nextColumns = prev.kanbanColumns.map((col) => {
        const filteredCards = (col.cards || []).filter((c) => c.id !== card.id);
        const colKey = col.automationKey || col.id;
        if (colKey === targetColumnKey || col.id === targetColumnKey) {
          return {
            ...col,
            cards: [{ ...card, stage: targetColumnKey }, ...filteredCards],
          };
        }
        return { ...col, cards: filteredCards };
      });
      return { ...prev, kanbanColumns: nextColumns };
    });

    try {
      await moveKanbanCard(activeTenantSlug, card, targetColumnKey);
    } catch (err) {
      console.warn('Falha ao salvar movimentação de card no banco:', err);
      refreshData({ showLoading: false });
    }
  };

  const handleFinishConversationFromKanban = (card) => {
    handleMoveKanbanCard(card, 'finalizadas');
  };

  useEffect(() => {
    document.title = 'NORIA — Inteligência em movimento';
    try {
      localStorage.removeItem('magia:team-agents');
    } catch (e) { }
  }, []);

  useEffect(() => {
    let active = true;
    if (!hasTenantAccess) return undefined;
    setAgentsReady(false);
    setAgentsList([]);
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
            status: 'atendimento_humano',
            messages: newMessages,
          };
        }
        return conv;
      });
      return {
        ...prev,
        conversations: nextConversations,
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
      }, activeTenantSlug);
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

    let lastRealtimeRefresh = 0;
    const refreshFromRealtime = () => {
      const now = Date.now();
      if (now - lastRealtimeRefresh < 800) return;
      lastRealtimeRefresh = now;
      refreshData({ showLoading: false });
    };

    const unsubscribe = subscribeToClientEvents(() => {
      refreshFromRealtime();
    }, activeTenantSlug);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshData({ showLoading: false });
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const fallbackPolling = window.setInterval(() => {
      refreshData({ showLoading: false });
    }, 10000);

    return () => {
      unsubscribe();
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
          <div className="topbar-brand-block">
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
              <h1>{menu.find((item) => item.id === active)?.label}</h1>
            </div>
            <p className="topbar-subtitle">{[selectedTenant.name, selectedTenant.industry].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="topbar-actions">
            <label className="select-label" title={selectedTenant.name}>
              <Building2 size={15} />
              <select value={activeTenantSlug} onChange={(event) => setTenantSlug(event.target.value)} aria-label="Selecionar empresa">
                {availableTenants.map((tenant) => (
                  <option key={tenant.slug} value={tenant.slug}>{tenant.name}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
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

        {active === 'dashboard' && <Dashboard conversations={appData.conversations} dataSource={appData.source} status={appData.status} ready={appDataReady} />}
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
            ready={appDataReady}
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
            tenantName={selectedTenant.name}
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

function Dashboard({ conversations, dataSource, status, ready = true }) {
  const [visibleCount, setVisibleCount] = useState(10);

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
      setVisibleCount((prev) => Math.min(prev + 5, conversations.length));
    }
  }

  const displayedConversations = useMemo(() => {
    return conversations.slice(0, visibleCount);
  }, [conversations, visibleCount]);

  return (
    <section className="dashboard-page">
      <div className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`metric-card metric-card-${stat.id}`} key={stat.id || stat.label}>
              <div className="metric-icon">
                <Icon size={18} />
              </div>
              <span className="metric-label">{stat.label}</span>
              <div className="metric-value-wrap">
                {ready ? (
                  <strong className="metric-value">{stat.value}</strong>
                ) : (
                  <div className="metric-skeleton-value skeleton-block" />
                )}
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
            action={ready ? `${displayedConversations.length} de ${conversations.length}` : '—'}
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
            </div>
            <div className="table-body" onScroll={handleTableScroll}>
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
                    <SkeletonBlock width="76px" height="22px" style={{ borderRadius: '999px' }} />
                    <SkeletonLine width="80px" />
                    <SkeletonLine width="90px" />
                    <SkeletonLine width="160px" />
                    <SkeletonLine width="55px" style={{ justifySelf: 'end' }} />
                  </div>
                ))
              ) : (
                <>
                  {displayedConversations.map((item) => (
                    <div className="table-row" key={item.id}>
                      <div className="table-contact-cell">
                        <div className="conversation-avatar-wrapper compact">
                          <div className="conversation-avatar">
                            {getInitials(item.contact)}
                          </div>
                        </div>
                        <div className="table-contact-info">
                          <strong className="contact-name">{item.contact}</strong>
                          {item.company && item.company.startsWith('@') && (
                            <small className="contact-handle">{item.company}</small>
                          )}
                        </div>
                      </div>

                      <div className="table-channel-cell">
                        <div className={`channel-indicator ${getChannelClass(item.channelType || item.channel)}`}>
                          <ChannelIcon channel={item.channelType || item.channel} size={15} />
                          <span className="channel-name">{item.channel}</span>
                        </div>
                      </div>

                      <Badge value={statusLabels[item.status] || item.status} status={item.status} />

                      <span className="stage-pill-text">{item.stage}</span>

                      <span className="owner-text">{item.owner}</span>

                      <span className="message-preview-text" title={item.lastMessage}>
                        {formatConversationPreview(item.lastMessage)}
                      </span>

                      <small className="timestamp-text">{item.lastAt}</small>
                    </div>
                  ))}
                  {!conversations.length && (
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
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        <path d="M9.5 9a.5.5 0 0 0-.5.5v.2a4.8 4.8 0 0 0 4.8 4.8h.2a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5l-1.2-.2a.5.5 0 0 0-.4.1l-.6.6a3.8 3.8 0 0 1-1.8-1.8l.6-.6a.5.5 0 0 0 .1-.4l-.2-1.2A.5.5 0 0 0 10.5 9h-1z" />
      </svg>
    );
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

function getChannelClass(channel) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('whats') || type.includes('zap')) return 'channel-whatsapp';
  if (type.includes('insta')) return 'channel-instagram';
  if (type.includes('telegram')) return 'channel-telegram';
  return 'channel-webchat';
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
  ready = true,
}) {
  const [selectedId, setSelectedId] = useState(conversations[0]?.id || null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

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
    if (!filteredConversations.length) return null;
    return filteredConversations.find((c) => c.id === selectedId) || filteredConversations[0];
  }, [filteredConversations, selectedId]);

  const selectedCloseKey = JSON.stringify([tenantSlug, selected?.id]);
  const canEndSelected = canCloseConversation(selected, closedLocally[selectedCloseKey]);

  useEffect(() => {
    setShowCloseModal(false);
  }, [selectedCloseKey]);

  useEffect(() => {
    if (!initialConversationId) return;
    const conversation = conversations.find((item) => (
      item.id === initialConversationId || item.externalConversationId === initialConversationId
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
                    <div className="conversation-avatar">
                      {getInitials(conversation.contact)}
                    </div>
                    <span className={`channel-avatar-badge ${getChannelClass(conversation.channelType || conversation.channel)}`}>
                      <ChannelIcon channel={conversation.channelType || conversation.channel} size={10} />
                    </span>
                  </div>

                  <div className="conversation-item-main">
                    <div className="conversation-item-top">
                      <strong className="contact-name">{conversation.contact}</strong>
                      <small className="timestamp">{conversation.lastAt}</small>
                    </div>
                    <div className="conversation-item-bottom">
                      <span className="last-message">{formatConversationPreview(conversation.lastMessage)}</span>
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
                <div className="conversation-avatar">
                  {getInitials(selected.contact)}
                </div>
                <span className={`channel-avatar-badge ${getChannelClass(selected.channelType || selected.channel)}`}>
                  <ChannelIcon channel={selected.channelType || selected.channel} size={10} />
                </span>
              </div>
              <div className="chat-header-main-info">
                <div className="chat-header-name-row">
                  <strong className="chat-header-name">{selected.contact}</strong>
                </div>
                <div className="chat-header-sub">
                  <span className="chat-header-channel">
                    <ChannelIcon channel={selected.channelType || selected.channel} size={11} />
                    {selected.channel}
                  </span>
                  <span className="chat-header-dot">·</span>
                  <span className="chat-header-stage">{selected.stage}</span>
                  {selected.owner && (
                    <>
                      <span className="chat-header-dot chat-header-owner-dot">·</span>
                      <span className="chat-header-owner" title={`Responsável: ${selected.owner}`}>
                        {selected.owner}
                      </span>
                    </>
                  )}
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
                title={canEndSelected ? 'Encerrar atendimento' : 'Disponível durante um atendimento da IA'}
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
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-top">
                <div className="modal-header-brand">
                  <img src={noriaLogo} alt="NORIA" className="modal-logo-img" />
                  <h3 id="assign-modal-title" className="modal-title">Atribuir conversa</h3>
                </div>
                <button
                  ref={assignModalCloseBtnRef}
                  className="icon-button modal-close-btn"
                  type="button"
                  onClick={handleCloseAssignModal}
                  aria-label="Fechar"
                  title="Fechar"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="modal-subtitle">
                Selecione um funcionário da equipe para assumir a continuidade deste atendimento.
              </p>
              <div className="modal-target-contact">
                <MessageCircle size={14} />
                <span>Atendimento: <strong>{selected.contact || 'Cliente'}</strong></span>
                {selected.channelLabel && <span className="modal-target-channel">· {selected.channelLabel}</span>}
              </div>
            </div>

            <div className="modal-body">
              <div className="agent-selection-list">
                {!agentsReady ? (
                  [1, 2, 3].map((i) => (
                    <div className="agent-selection-card agent-selection-card-skeleton" key={i}>
                      <div className="agent-card-header">
                        <div className="agent-avatar-circle skeleton-block" />
                        <div className="agent-identity">
                          <SkeletonLine width="100px" />
                          <SkeletonBlock width="60px" height="16px" style={{ borderRadius: '4px' }} />
                        </div>
                      </div>
                      <div className="agent-card-meta">
                        <SkeletonLine width="130px" />
                      </div>
                      <div className="agent-card-footer">
                        <SkeletonLine width="90px" />
                        <SkeletonBlock width="70px" height="28px" style={{ borderRadius: '6px' }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {agentsList.map((agent) => {
                      const isCurrent = selected.owner === agent.name;
                      const hasStatus = Boolean(agent.status);
                      const statusNormalized = String(agent.status || '').toLowerCase();
                      const isOnline = statusNormalized === 'online' || statusNormalized === 'ativo';
                      const statusLabel = (() => {
                        if (!agent.status) return null;
                        if (statusNormalized === 'online') return 'Online';
                        if (statusNormalized === 'ativo') return 'Ativo';
                        if (statusNormalized === 'standby' || statusNormalized === 'pausado') return 'Pausado';
                        if (statusNormalized === 'offline') return 'Offline';
                        return agent.status;
                      })();
                      const hasRealLoad = typeof agent.load === 'number' && !Number.isNaN(agent.load);
                      const metaText = [agent.unit || agent.branch, agent.shift].filter(Boolean).join(' · ');

                      return (
                        <div
                          key={agent.id}
                          className={`agent-selection-card ${isCurrent ? 'selected' : ''}`}
                          onClick={() => {
                            if (!isCurrent) {
                              onAssignAgent?.(selected, agent);
                              handleCloseAssignModal();
                              setAssignToast(`Conversa atribuída a ${agent.name}`);
                              setTimeout(() => setAssignToast(''), 3000);
                            }
                          }}
                        >
                          <div className="agent-card-header">
                            <div className="agent-avatar-circle">
                              {getInitials(agent.name)}
                              {hasStatus && statusLabel && (
                                <span
                                  className={`agent-avatar-status ${isOnline ? 'online' : 'standby'}`}
                                  title={statusLabel}
                                />
                              )}
                            </div>

                            <div className="agent-identity">
                              <strong className="agent-name">{agent.name}</strong>
                              {agent.role && <span className="agent-badge-role">{agent.role}</span>}
                            </div>

                            {hasStatus && statusLabel && (
                              <span className={`agent-status-pill ${isOnline ? 'online' : 'standby'}`}>
                                <span className="status-dot" />
                                {statusLabel}
                              </span>
                            )}
                          </div>

                          {metaText && (
                            <div className="agent-card-meta">
                              <span className="agent-meta-text">{metaText}</span>
                            </div>
                          )}

                          <div className="agent-card-bottom">
                            <div className="agent-workload-info">
                              {hasRealLoad && (
                                <span className="agent-load-tag">
                                  <MessageSquare size={13} />
                                  <span>{agent.load} {agent.load === 1 ? 'conversa ativa' : 'conversas ativas'}</span>
                                </span>
                              )}
                            </div>

                            <div className="agent-action-wrap">
                              {isCurrent ? (
                                <span className="current-owner-tag">
                                  <CheckCircle2 size={13} /> Atual
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="assign-action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAssignAgent?.(selected, agent);
                                    handleCloseAssignModal();
                                    setAssignToast(`Conversa atribuída a ${agent.name}`);
                                    setTimeout(() => setAssignToast(''), 3000);
                                  }}
                                >
                                  <UserCheck size={14} />
                                  <span>Atribuir</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!agentsList.length && (
                      <EmptyState
                        title="Nenhum funcionário cadastrado"
                        text="Acesse o menu Configurações para cadastrar os funcionários da equipe."
                        compact
                      />
                    )}
                  </>
                )}
              </div>
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
  onFinishConversation,
  ready = true,
}) {
  const [agentFilter, setAgentFilter] = useState('todos');
  const [channelFilter, setChannelFilter] = useState('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCardId, setCopiedCardId] = useState(null);
  const [confirmingCardId, setConfirmingCardId] = useState('');
  const [kanbanActionStatus, setKanbanActionStatus] = useState('');
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);

  const schedulingUrl = getTenantSchedulingLink(tenantSlug);

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

  const filteredColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (kanbanColumns || []).map((col) => {
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
        const matchesAgent =
          agentFilter === 'todos' ||
          card?.owner === agentFilter ||
          (agentFilter === 'ia' && ownerStr.includes('IA')) ||
          (agentFilter === 'humano' && !ownerStr.includes('IA'));
        const matchesChannel =
          channelFilter === 'todos' || channelStr.includes(channelFilter);
        return matchesQuery && matchesAgent && matchesChannel;
      });
      return { ...col, cards };
    });
  }, [kanbanColumns, agentFilter, channelFilter, searchQuery]);

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
        onMoveCard(data.card, targetColumn.automationKey || targetColumn.id);
      }
    } catch (err) {
      console.warn('Erro ao processar drop no Kanban:', err);
    }
  };

  return (
    <section className="kanban-page">
      <div className="kanban-toolbar">
        <div className="kanban-toolbar-search-row">
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Buscar por contato, serviço ou mensagem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="chips">
            <button
              type="button"
              className={`chip ${channelFilter === 'todos' ? 'active' : ''}`}
              onClick={() => setChannelFilter('todos')}
            >
              Todos os canais
            </button>
            {allowedChannels.includes('whatsapp') && <button
              type="button"
              className={`chip ${channelFilter === 'whatsapp' ? 'active channel-whatsapp' : ''}`}
              onClick={() => setChannelFilter(channelFilter === 'whatsapp' ? 'todos' : 'whatsapp')}
            >
              <ChannelIcon channel="whatsapp" size={13} /> WhatsApp
            </button>}
            {allowedChannels.includes('telegram') && <button
              type="button"
              className={`chip ${channelFilter === 'telegram' ? 'active channel-telegram' : ''}`}
              onClick={() => setChannelFilter(channelFilter === 'telegram' ? 'todos' : 'telegram')}
            >
              <ChannelIcon channel="telegram" size={13} /> Telegram
            </button>}
            {allowedChannels.includes('instagram') && <button
              type="button"
              className={`chip ${channelFilter === 'instagram' ? 'active channel-instagram' : ''}`}
              onClick={() => setChannelFilter(channelFilter === 'instagram' ? 'todos' : 'instagram')}
            >
              <ChannelIcon channel="instagram" size={13} /> Instagram
            </button>}
          </div>
        </div>

        <div className="kanban-toolbar-agents-row">
          <span className="filter-label">Responsável:</span>
          <div className="chips">
            <button
              type="button"
              className={`chip ${agentFilter === 'todos' ? 'active' : ''}`}
              onClick={() => setAgentFilter('todos')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`chip ${agentFilter === 'ia' ? 'active' : ''}`}
              onClick={() => setAgentFilter('ia')}
            >
              <Bot size={13} /> Assistente IA
            </button>
            {agentsList.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`chip ${agentFilter === agent.name ? 'active' : ''}`}
                onClick={() => setAgentFilter(agent.name)}
              >
                <UserRound size={13} /> {agent.name}
              </button>
            ))}
          </div>
        </div>
        {kanbanActionStatus && <small className="kanban-action-status">{kanbanActionStatus}</small>}
      </div>

      <div className="kanban-board">
        {filteredColumns.map((column) => {
          const isWaitingColumn = column.automationKey === 'aguardando_humano' || column.id === 'aguardando_humano';
          const isFinishedColumn = column.automationKey === 'finalizadas' || column.id === 'finalizadas';
          const isDragOver = dragOverColumnId === column.id;

          return (
            <div
              className={`kanban-column ${isDragOver ? 'is-dragover' : ''}`}
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column)}
              onDragLeave={(e) => handleDragLeave(e, column)}
              onDrop={(e) => handleDrop(e, column)}
            >
              <div className="column-header">
                <strong className="column-title">{column.title}</strong>
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
                          className={`kanban-card ${channelClass} ${isDragging ? 'is-dragging' : ''}`}
                          key={card.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, card, column)}
                          onDragEnd={handleDragEnd}
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

                          <p className="card-subtitle">{formatConversationPreview(card.subtitle)}</p>

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

                          <div className="kanban-card-footer">
                            <div className="card-owner-info">
                              <UserRound size={12} />
                              <span>{card.owner}</span>
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
  const [stageFilter, setStageFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const allContacts = useMemo(() => mergeBroadcastContacts(contacts, draftContacts), [contacts, draftContacts]);
  const stages = useMemo(() => Array.from(new Set(conversations.map((item) => item.stage).filter(Boolean))), [conversations]);
  const selectedContacts = allContacts.filter((contact) => selected.has(contact.key));

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
      <section className="panel">
        <PanelTitle icon={Megaphone} title="Disparo de mensagens" />
        <div className="broadcast-grid">
          <div className="broadcast-import">
            <label className="file-drop">
              <FileSpreadsheet size={22} />
              <strong>Importar contatos</strong>
              <span>XLSX ou CSV com nome e chat_id/telegram_id.</span>
              <input type="file" accept=".xlsx,.csv,.txt" onChange={handleFile} />
            </label>
            <div className="header-actions">
              <button className="secondary-button" type="button" onClick={addRecentContacts}><UsersRound size={16} /> Recentes</button>
              <label className="select-label compact-select">
                <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
                  <option value="">Quadro Kanban</option>
                  {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
              </label>
              <button className="secondary-button" type="button" onClick={addStageContacts} disabled={!stageFilter}>Adicionar</button>
            </div>
          </div>

          <div className="broadcast-composer">
            <label>Nome da campanha<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex: Confirmacao de horarios" /></label>
            <label className="textarea-label">Mensagem<textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Digite a mensagem que sera enviada aos contatos selecionados." /></label>
            <div className="header-actions">
              <button className="primary-button" type="button" onClick={sendCampaign} disabled={busy || !messageText.trim() || !selectedContacts.length}>
                <Send size={16} /> Enviar para {selectedContacts.length}
              </button>
              <small>{status}</small>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid two">
        <section className="panel">
          <PanelTitle icon={UsersRound} title="Contatos selecionaveis" action={ready ? `${selectedContacts.length}/${allContacts.length}` : '—'} />
          <div className="contact-table">
            {!ready ? (
              [1, 2, 3].map((i) => (
                <div className="contact-row" key={i} style={{ pointerEvents: 'none' }}>
                  <SkeletonBlock width="16px" height="16px" style={{ borderRadius: '3px' }} />
                  <div style={{ flex: 1 }}>
                    <SkeletonLine width="110px" style={{ display: 'block' }} />
                    <SkeletonLine width="140px" style={{ marginTop: '4px', display: 'block' }} />
                  </div>
                </div>
              ))
            ) : (
              <>
                {allContacts.map((contact) => {
                  const key = contact.key || contactKey(contact);
                  return (
                    <label className="contact-row" key={key}>
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggleContact(key)} />
                      <div>
                        <strong>{contact.name || contact.contact_name || 'Contato'}</strong>
                        <span>{contact.external_conversation_id || contact.externalConversationId} - {contact.channel_type || contact.channelType || 'telegram'}</span>
                      </div>
                    </label>
                  );
                })}
                {!allContacts.length && <EmptyState title="Nenhum contato preparado" text="Importe uma planilha ou adicione contatos recentes." compact />}
              </>
            )}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={Clock3} title="Historico de campanhas" />
          <div className="campaign-list">
            {!ready ? (
              [1, 2].map((i) => (
                <article className="campaign-card" key={i} style={{ pointerEvents: 'none' }}>
                  <div style={{ flex: 1 }}>
                    <SkeletonLine width="120px" style={{ display: 'block' }} />
                    <SkeletonLine width="160px" style={{ marginTop: '5px', display: 'block' }} />
                  </div>
                  <SkeletonBlock width="60px" height="18px" style={{ borderRadius: '4px' }} />
                </article>
              ))
            ) : (
              <>
                {campaigns.map((campaign) => (
                  <article className="campaign-card" key={campaign.id}>
                    <div>
                      <strong>{campaign.name}</strong>
                      <span>{campaign.total_recipients || 0} contatos - {campaign.sent_count || 0} enviados - {campaign.failed_count || 0} falhas</span>
                    </div>
                    <Badge value={campaign.status} status={campaign.status === 'sent' ? 'ia_ativa' : 'channel'} />
                  </article>
                ))}
                {!campaigns.length && <EmptyState title="Sem campanhas" text="Os disparos realizados ficarao registrados aqui." compact />}
              </>
            )}
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
        <PanelTitle icon={CalendarDays} title="Novo agendamento" action="Manual" />
        <form className="form-grid" onSubmit={handleSubmit}>
          {schedule?.enabled ? <div className="form-row-two">
            <label>Unidade<select required value={unitId} onChange={event => setUnitId(event.target.value)}>
              <option value="">Selecione</option>{Object.entries(schedule.units).map(([id, unit]) => <option key={id} value={id}>{unit.name}</option>)}
            </select></label>
            <label>Servico<select required value={serviceId} onChange={event => setServiceId(event.target.value)}>
              <option value="">Selecione</option>{schedule.services.map(service => <option key={service.external_id} value={service.external_id}>{service.name}</option>)}
            </select></label>
          </div> : <label>Titulo<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: Sessao de bronzeamento" required /></label>}
          <div className="form-row-two">
            <label>Contato<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome da cliente" required={schedule?.enabled} /></label>
            <label>Conversa recente<select value={selectedConversationId} onChange={(event) => pickConversation(event.target.value)}>
              <option value="">Sem vinculo</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.externalConversationId}>{conversation.contact} - {conversation.channel}</option>
              ))}
            </select></label>
          </div>
          {schedule?.enabled ? <div className="form-row-two">
            <label>Data<input type="date" required value={localDate} onChange={event => setLocalDate(event.target.value)} /></label>
            <label>Horario ({schedule.timezone})<select required value={localTime} disabled={checking || !availableTimes.length} onChange={event => setLocalTime(event.target.value)}>
              <option value="">{checking ? 'Consultando...' : 'Selecione'}</option>{availableTimes.map(time => <option key={time}>{time}</option>)}
            </select></label>
          </div> : <div className="form-row-two">
            <label>Inicio<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label>Fim<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          </div>}
          <label className="textarea-label">Observacoes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes internos do atendimento." /></label>
          <div className="header-actions">
            <button className="primary-button" type="submit" disabled={saving || !schedule || checking || (schedule.enabled ? !localTime || !contactName.trim() : !title.trim() || !startsAt)}><CalendarCheck size={16} /> Salvar agendamento</button>
            <small>{status}</small>
          </div>
        </form>
      </section>

      <section className="panel appointment-list-panel">
        <PanelTitle icon={Clock3} title="Calendario simples" action={ready ? `${appointments.length} registros` : '— registros'} />
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
                      <div className="appointment-time"><strong>{appointment.timeLabel}</strong><span>{appointment.endTimeLabel || '--:--'}</span></div>
                      <div>
                        <strong>{appointment.title}</strong>
                        <span>{appointment.contactName || 'Sem contato'} - {appointment.channelLabel}</span>
                        {appointment.unitName && <span>{appointment.unitName}</span>}
                        {appointment.notes && <p>{appointment.notes}</p>}
                      </div>
                      <Badge value={appointment.statusLabel} status="channel" />
                    </article>
                  ))}
                </div>
              ))}
              {!appointments.length && <EmptyState title="Nenhum agendamento" text="Crie um agendamento manual para ele aparecer aqui e no Kanban." />}
            </>
          )}
        </div>
      </section>
    </section>
  );
}

function SettingsPage({ agents = [], agentsReady = true, onAddAgent, onToggleAgentStatus, onDeleteAgent, tenantName, integration, allowedChannels = CHANNEL_OPTIONS.map(c => c.id) }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [unit, setUnit] = useState('Unidade 1');
  const [shift, setShift] = useState('Integral (08:00 às 18:00)');
  const [channel, setChannel] = useState('WhatsApp');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAddAgent?.({
      id: `ag-${Date.now()}`,
      name: name.trim(),
      role: role.trim() || 'Atendimento / Operador',
      phone: phone.trim(),
      unit: unit.trim() || 'Unidade Geral',
      shift: shift.trim() || '08:00 às 18:00',
      channel: channel.trim() || 'WhatsApp',
      status: 'online',
      load: 0,
    });
    setName('');
    setRole('');
    setPhone('');
  }

  return (
    <section className="content-grid two settings-page">
      <section className="panel settings-form-panel">
        <PanelTitle icon={UserCheck} title="Cadastrar Funcionário / Agente" />
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: '13px' }}>
          Cadastre os funcionários humanos do estabelecimento para receberem atendimentos transferidos.
        </p>

        <form className="form-grid settings-agent-form" onSubmit={handleSubmit}>
          <label>
            Nome Completo do Funcionário *
            <input
              placeholder="Ex: Núbia Santos, Camila Recepção..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <div className="form-row-two">
            <label>
              Cargo / Função
              <input
                placeholder="Ex: Responsável Geral, Recepcionista..."
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </label>
            <label>
              WhatsApp / Telefone
              <input
                placeholder="Ex: (11) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </div>

          <div className="form-row-two">
            <label>
              Unidade / Filial
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="Unidade 1">Unidade 1</option>
                <option value="Unidade 2">Unidade 2</option>
                <option value="Todas as Unidades">Todas as Unidades (Geral)</option>
              </select>
            </label>
            <label>
              Turno / Horário de Trabalho
              <select value={shift} onChange={(e) => setShift(e.target.value)}>
                <option value="Integral (08:00 às 18:00)">Integral (08:00 às 18:00)</option>
                <option value="Manhã (08:00 às 13:00)">Manhã (08:00 às 13:00)</option>
                <option value="Tarde (13:00 às 18:00)">Tarde (13:00 às 18:00)</option>
                <option value="Flexível / Plantão">Flexível / Plantão</option>
              </select>
            </label>
          </div>

          <label>
            Canal de Atuação Principal
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.filter(c => allowedChannels.includes(c.id)).map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
              {allowedChannels.length > 1 && <option value="Todos os canais">Todos os canais</option>}
            </select>
          </label>

          <button className="primary-button wide" type="submit" disabled={!name.trim()}>
            <UserCheck size={17} /> Salvar Agente
          </button>
        </form>
      </section>

      <section className="panel settings-team-panel">
        <PanelTitle icon={UsersRound} title="Equipe de Atendimento Cadastrada" />
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: '13px' }}>
          Funcionários ativos disponíveis para transferência no botão <strong>Atribuir</strong> do chat.
        </p>

        <div className="agents-list">
          {!agentsReady ? (
            [1, 2, 3].map((i) => (
              <article className="agent-card agent-card-skeleton" key={i}>
                <div className="agent-avatar-col">
                  <div className="agent-avatar small skeleton-block" style={{ width: '36px', height: '36px', borderRadius: '8px' }} />
                </div>
                <div className="agent-info">
                  <div className="agent-top-row">
                    <SkeletonLine width="110px" height="16px" />
                    <SkeletonBlock width="54px" height="18px" style={{ borderRadius: '999px' }} />
                  </div>
                  <SkeletonLine width="80px" height="18px" style={{ borderRadius: '4px', marginTop: '4px' }} />
                  <SkeletonLine width="150px" height="14px" style={{ marginTop: '4px' }} />
                </div>
                <div className="agent-actions">
                  <SkeletonBlock width="70px" height="32px" style={{ borderRadius: '6px' }} />
                  <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '6px' }} />
                </div>
              </article>
            ))
          ) : (
            <>
              {agents.map((agent) => {
                const isOnline = String(agent.status || '').toLowerCase() === 'online' || String(agent.status || '').toLowerCase() === 'ativo';
                const statusLabel = isOnline ? 'Ativo' : 'Pausado';
                const hasRealLoad = typeof agent.load === 'number' && !Number.isNaN(agent.load);
                const metaText = [agent.unit || agent.branch, agent.shift].filter(Boolean).join(' · ');

                return (
                  <article className="agent-card" key={agent.id}>
                    <div className="agent-avatar-col">
                      <div className="agent-avatar small">
                        <UserRound size={18} />
                      </div>
                    </div>
                    <div className="agent-info">
                      <div className="agent-top-row">
                        <div className="agent-identity">
                          <strong className="agent-name">{agent.name}</strong>
                          {agent.role && <span className="agent-badge-role">{agent.role}</span>}
                        </div>
                        <span className={`status-dot-badge ${isOnline ? 'online' : 'standby'}`}>
                          <span className="pulse-dot" />
                          {statusLabel}
                        </span>
                      </div>
                      {metaText && (
                        <div className="agent-meta-row">
                          <span className="agent-meta-text">{metaText}</span>
                        </div>
                      )}
                      {agent.phone && (
                        <div className="agent-phone-row">
                          <span className="agent-phone-text">{agent.phone}</span>
                        </div>
                      )}
                      {hasRealLoad && (
                        <div className="agent-workload-row">
                          <span className="agent-load-badge">
                            {agent.load} {agent.load === 1 ? 'conversa ativa' : 'conversas ativas'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="agent-actions">
                      <button
                        className="secondary-button compact-btn agent-toggle-btn"
                        type="button"
                        title="Alternar status de disponibilidade"
                        onClick={() => onToggleAgentStatus?.(agent.id)}
                      >
                        {isOnline ? 'Pausar' : 'Retomar'}
                      </button>
                      <button
                        className="icon-button compact-btn text-danger agent-delete-btn"
                        type="button"
                        title="Remover funcionário"
                        onClick={() => onDeleteAgent?.(agent.id)}
                      >
                        <Trash2 size={15} />
                        <span className="btn-text-mobile">Excluir</span>
                      </button>
                    </div>
                  </article>
                );
              })}
              {!agents.length && (
                <EmptyState
                  title="Nenhum funcionário cadastrado"
                  text="Cadastre os atendentes e operadores da equipe no formulário ao lado para poder atribuir conversas a eles."
                  compact
                />
              )}
            </>
          )}
        </div>
      </section>
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

function PanelTitle({ icon: Icon, title, action }) {
  return (
    <div className="panel-title">
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

          <h1 className="auth-title">Bem-vindo de volta</h1>

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
