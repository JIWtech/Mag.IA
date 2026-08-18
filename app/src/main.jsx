import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import readXlsxFile from 'read-excel-file/browser';
import {
  Activity,
  Bot,
  Brain,
  Building2,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  Filter,
  Gauge,
  GitBranch,
  Globe,
  Inbox,
  Instagram,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  PauseCircle,
  PlayCircle,
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
  Webhook,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  agents,
  aiConfig,
  automationRules,
  channelAccounts,
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
  hasSupabaseConfig,
  loadAvailableTenants,
  loadClientData,
  persistTenantSlug,
  saveAppointment,
  subscribeToClientEvents,
  updateBroadcastCampaign,
  updateBroadcastRecipient,
  upsertBroadcastContacts,
} from './dataService';
import './styles.css';

const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'conversas', label: 'Conversas', icon: MessageCircle },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'funil', label: 'Funil', icon: GitBranch },
  { id: 'disparos', label: 'Disparos', icon: Megaphone },
  { id: 'agendamentos', label: 'Agendamentos', icon: CalendarDays },
  { id: 'automacoes', label: 'Automações', icon: Workflow },
  { id: 'ia', label: 'IA', icon: Brain },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];

const statusLabels = {
  ia_ativa: 'Bot ativo',
  atendimento_humano: 'Atendimento humano',
  aguardando_cliente: 'Aguardando cliente',
  finalizada: 'Finalizada',
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

function App() {
  const [active, setActive] = useState('dashboard');
  const [availableTenants, setAvailableTenants] = useState(mockTenants);
  const [tenantSlug, setTenantSlug] = useState(getInitialTenantSlug);
  const [session, setSession] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(isAuthRequired());
  const [loading, setLoading] = useState(false);
  const [appData, setAppData] = useState(() => {
    if (hasSupabaseConfig()) {
      return {
        conversations: [],
        kanbanColumns: emptyKanban(),
        funnelStages: emptyFunnel(),
        source: 'supabase',
        status: {
          source: 'supabase',
          botUsername: '@clinica_nubia_bot',
          channel: 'Telegram',
          telegram: 'conectado',
          supabase: true,
          ai: 'Regras e automações',
          latestAt: 'Sincronizando...',
          humanQueue: 0,
        },
        appointments: [],
        broadcastContacts: [],
        broadcastCampaigns: [],
      };
    }
    return {
      conversations,
      kanbanColumns,
      funnelStages,
      source: 'mock',
      status: null,
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
    };
  });
  const AGENTS_STORAGE_KEY = 'magia:team-agents';
  const [agentsList, setAgentsList] = useState(() => {
    try {
      const stored = localStorage.getItem(AGENTS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agentsList));
    } catch (e) {}
  }, [agentsList]);

  const selectedTenant = availableTenants.find((tenant) => tenant.slug === tenantSlug) || availableTenants[0] || mockTenants[0];
  const activeTenantSlug = selectedTenant?.slug || tenantSlug || 'jiw';
  const integration = getIntegrationStatus(activeTenantSlug);

  function handleAddAgent(newAgent) {
    setAgentsList((prev) => [newAgent, ...prev]);
  }

  function handleToggleAgentStatus(agentId) {
    setAgentsList((prev) => prev.map((ag) => ag.id === agentId ? { ...ag, status: ag.status === 'online' ? 'standby' : 'online' } : ag));
  }

  function handleDeleteAgent(agentId) {
    setAgentsList((prev) => prev.filter((ag) => ag.id !== agentId));
  }

  function handleAssignAgent(conversationId, agent) {
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
  }

  useEffect(() => {
    if (!isAuthRequired()) return undefined;
    let mounted = true;
    getCurrentSession().then((currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
      setCheckingAuth(false);
    });
    const unsubscribe = subscribeToAuthState((nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function refreshData() {
    setLoading(true);
    const minWait = new Promise((resolve) => setTimeout(resolve, 550));
    try {
      const [data] = await Promise.all([
        loadClientData({
          conversations,
          kanbanColumns,
          funnelStages,
          appointments: appData.appointments || [],
          broadcastContacts: appData.broadcastContacts || [],
          broadcastCampaigns: appData.broadcastCampaigns || [],
        }, activeTenantSlug),
        minWait,
      ]);
      setAppData(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthRequired() && !session) return;
    loadAvailableTenants(mockTenants).then((tenantsFromDb) => {
      setAvailableTenants(tenantsFromDb);
      const exists = tenantsFromDb.some((tenant) => tenant.slug === activeTenantSlug);
      if (!exists && tenantsFromDb[0]) {
        setTenantSlug(tenantsFromDb[0].slug);
        persistTenantSlug(tenantsFromDb[0].slug);
      }
    });
  }, [activeTenantSlug, session]);

  useEffect(() => {
    persistTenantSlug(activeTenantSlug);
    refreshData();
    const unsubscribe = subscribeToClientEvents(() => {
      refreshData();
    }, activeTenantSlug);
    return () => {
      unsubscribe();
    };
  }, [activeTenantSlug]);

  if (checkingAuth) {
    return <AuthShell title="Carregando painel..." />;
  }

  if (isAuthRequired() && !session) {
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div>
            <strong>Mag.ia</strong>
            <span>Atendimento inteligente</span>
          </div>
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

        <div className="sidebar-footer">
          <div className="integration-pill">
            <span className={`dot ${integration.supabase ? '' : 'warn'}`} />
            <small>{integration.supabase ? 'Supabase conectado' : 'Modo local'}</small>
          </div>
          <small>Tenant: {integration.tenantSlug}</small>
        </div>
      </aside>

      <main className="main" style={{ position: 'relative' }}>
        <div className={`refresh-progress-bar ${loading ? 'active' : ''}`} />
        <header className="topbar">
          <div>
            <h1>{menu.find((item) => item.id === active)?.label}</h1>
            <p>{selectedTenant.name} · {selectedTenant.industry} · Plano {selectedTenant.plan}</p>
          </div>
          <div className="topbar-actions">
            <label className="select-label">
              <Building2 size={16} />
              <select value={activeTenantSlug} onChange={(event) => setTenantSlug(event.target.value)}>
                {availableTenants.map((tenant) => (
                  <option key={tenant.slug} value={tenant.slug}>{tenant.name}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <button className="icon-button" type="button" title="Atualizar" onClick={refreshData}>
              <RefreshCcw size={18} className={loading ? 'spin' : ''} />
            </button>
            {isAuthRequired() && (
              <button className="secondary-button" type="button" onClick={signOut}>
                <UserRound size={16} />
                Sair
              </button>
            )}
           
          </div>
        </header>

        {active === 'dashboard' && <Dashboard conversations={appData.conversations} dataSource={appData.source} status={appData.status} />}
        {active === 'conversas' && (
          <Conversations
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onSent={refreshData}
            agentsList={agentsList}
            onAssignAgent={handleAssignAgent}
          />
        )}
        {active === 'kanban' && <Kanban kanbanColumns={appData.kanbanColumns} tenantName={selectedTenant.name} />}
        {active === 'funil' && <Funnel funnelStages={appData.funnelStages} tenantName={selectedTenant.name} />}
        {active === 'disparos' && (
          <Broadcasts
            conversations={appData.conversations}
            contacts={appData.broadcastContacts || []}
            campaigns={appData.broadcastCampaigns || []}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
          />
        )}
        {active === 'agendamentos' && (
          <Appointments
            appointments={appData.appointments || []}
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
          />
        )}
        {active === 'automacoes' && <Automations />}
        {active === 'ia' && <AiSettings tenantName={selectedTenant.name} />}
        {active === 'configuracoes' && (
          <SettingsPage
            agents={agentsList}
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

function Dashboard({ conversations, dataSource, status }) {
  const [visibleCount, setVisibleCount] = useState(5);

  const stats = useMemo(() => {
    const activeBot = conversations.filter((item) => item.status === 'ia_ativa').length;
    const human = conversations.filter((item) => item.status === 'atendimento_humano').length;

    return [
      { label: 'Conversas', value: conversations.length.toString(), change: dataSource === 'supabase' ? 'Supabase' : dataSource, icon: Inbox },
      { label: 'Bot ativo', value: activeBot.toString(), change: status?.ai || 'Regras e automações', icon: Bot },
      { label: 'Humanas', value: human.toString(), change: 'Fila de espera', icon: UsersRound },
    ];
  }, [conversations, dataSource, status]);

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
            <article className="metric-card" key={stat.label}>
              <div className="metric-icon"><Icon size={20} /></div>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.change}</small>
            </article>
          );
        })}
      </div>

      <div className="content-grid two dashboard-middle">
        <section className="panel">
          <PanelTitle icon={Activity} title="Operação atual" action={status?.channel || 'Telegram'} />
          <div className="bar-list">
            {[
              ['Telegram conectado', status?.telegram === 'conectado' ? 100 : 0],
              ['Webhook n8n ativo', 100],
              [status?.ai === 'Gemini' ? 'Gemini ativo' : 'Regras e automações', 100],
              ['Supabase real', status?.supabase ? 100 : 0],
            ].map(([label, value]) => (
              <div className="bar-row" key={label}>
                <span>{label}</span>
                <div className="bar-track"><div style={{ width: `${value}%` }} /></div>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={Gauge} title="Sinais importantes" action="Tempo real" />
          <div className="signal-list">
            <Signal icon={CheckCircle2} label="Bot Telegram conectado" value={status?.botUsername || '@clinica_nubia_bot'} tone="ok" />
            <Signal icon={Clock3} label="Último evento" value={status?.latestAt || 'Sem eventos'} tone="info" />
            <Signal icon={PauseCircle} label="Conversas para humano" value={String(status?.humanQueue || 0)} tone="warn" />
            <Signal icon={Zap} label="IA" value={status?.ai || 'Regras e automações'} tone={status?.ai === 'Gemini' ? 'ok' : 'warn'} />
          </div>
        </section>
      </div>

      <section className="panel dashboard-table-panel">
        <PanelTitle icon={MessageCircle} title="Conversas recentes" action={`${displayedConversations.length} de ${conversations.length}`} />
        <div className="table scrollable-table">
          <div className="table-head">
            <span>Contato</span><span>Canal</span><span>Status</span><span>Etapa</span><span>Responsável</span><span>Última mensagem</span>
          </div>
          <div className="table-body" onScroll={handleTableScroll}>
            {displayedConversations.map((item) => (
              <div className="table-row" key={item.id}>
                <strong>{item.contact}</strong>
                <span>{item.channel}</span>
                <Badge value={statusLabels[item.status]} status={item.status} />
                <span>{item.stage}</span>
                <span>{item.owner}</span>
                <small>{item.lastMessage}</small>
              </div>
            ))}
            {!conversations.length && <EmptyState title="Nenhuma conversa real ainda" text="Assim que o bot Telegram receber mensagens, elas aparecerão aqui." />}
          </div>
        </div>
      </section>
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
        <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
        <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
      </svg>
    );
  }
  if (type.includes('telegram')) {
    return <Send size={size} />;
  }
  return <Globe size={size} />;
}

function getChannelClass(channel) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('whats') || type.includes('zap')) return 'channel-whatsapp';
  if (type.includes('insta')) return 'channel-instagram';
  if (type.includes('telegram')) return 'channel-telegram';
  return 'channel-webchat';
}

function Conversations({ conversations, tenantSlug, onSent, agentsList = [], onAssignAgent }) {
  const [selectedId, setSelectedId] = useState(conversations[0]?.id || null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('todas');
  const [channelFilter, setChannelFilter] = useState('todos');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignToast, setAssignToast] = useState('');
  const messagesEndRef = React.useRef(null);

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
    return conversations.filter((c) => c.unread > 0).length;
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesQuery = !normalizedQuery || [
        conversation.contact,
        conversation.company,
        conversation.lastMessage,
        conversation.stage,
        ...conversation.tags,
      ].join(' ').toLowerCase().includes(normalizedQuery);

      const matchesFilter =
        filter === 'todas' ||
        (filter === 'ia' && conversation.status === 'ia_ativa') ||
        (filter === 'humanas' && conversation.status === 'atendimento_humano') ||
        (filter === 'nao_lidas' && conversation.unread > 0);

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

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
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
        sent_by_user: 'Operador Mag.IA',
      }, tenantSlug);
      setDraft('');
      await onSent?.();
    } catch (error) {
      setSendError(error.message || 'Não foi possível enviar a resposta.');
    } finally {
      setSending(false);
    }
  }

  if (!conversations.length) {
    return (
      <section className="panel">
        <EmptyState title="Nenhuma conversa registrada" text="Envie uma mensagem pelo canal conectado e atualize para visualizar o atendimento em tempo real." />
      </section>
    );
  }

  return (
    <section className="conversation-layout">
      <aside className="conversation-list panel">
        <div className="toolbar" style={{ position: 'relative' }}>
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Buscar conversa..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="filter-dropdown-wrapper">
            <button
              className={`icon-button ${channelFilter !== 'todos' ? 'active-filter' : ''}`}
              title="Filtrar por canal"
              type="button"
              onClick={() => setShowFilterMenu((prev) => !prev)}
            >
              <Filter size={17} />
              {channelFilter !== 'todos' && <span className={`filter-indicator-dot ${getChannelClass(channelFilter)}`} />}
            </button>

            {showFilterMenu && (
              <>
                <div className="dropdown-overlay" onClick={() => setShowFilterMenu(false)} />
                <div className="filter-popover-menu">
                  <div className="filter-popover-header">
                    <span>Filtrar por canal</span>
                  </div>
                  <button
                    type="button"
                    className={`filter-menu-item ${channelFilter === 'todos' ? 'selected' : ''}`}
                    onClick={() => { setChannelFilter('todos'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      <span className="channel-indicator-icon channel-webchat"><Sparkles size={12} /></span>
                      <span>Todos os canais</span>
                    </div>
                    <span className="count-badge">{channelCounts.todos}</span>
                  </button>
                  <button
                    type="button"
                    className={`filter-menu-item ${channelFilter === 'telegram' ? 'selected' : ''}`}
                    onClick={() => { setChannelFilter('telegram'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      <span className="channel-indicator-icon channel-telegram"><ChannelIcon channel="telegram" size={12} /></span>
                      <span>Telegram</span>
                    </div>
                    <span className="count-badge telegram">{channelCounts.telegram}</span>
                  </button>
                  <button
                    type="button"
                    className={`filter-menu-item ${channelFilter === 'whatsapp' ? 'selected' : ''}`}
                    onClick={() => { setChannelFilter('whatsapp'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      <span className="channel-indicator-icon channel-whatsapp"><ChannelIcon channel="whatsapp" size={12} /></span>
                      <span>WhatsApp</span>
                    </div>
                    <span className="count-badge whatsapp">{channelCounts.whatsapp}</span>
                  </button>
                  <button
                    type="button"
                    className={`filter-menu-item ${channelFilter === 'instagram' ? 'selected' : ''}`}
                    onClick={() => { setChannelFilter('instagram'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      <span className="channel-indicator-icon channel-instagram"><ChannelIcon channel="instagram" size={12} /></span>
                      <span>Instagram</span>
                    </div>
                    <span className="count-badge instagram">{channelCounts.instagram}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="chips">
          <button className={`chip ${filter === 'todas' ? 'active' : ''}`} type="button" onClick={() => setFilter('todas')}>Todas</button>
          <button className={`chip ${filter === 'nao_lidas' ? 'active' : ''}`} type="button" onClick={() => setFilter('nao_lidas')}>
            Não lidas
            {unreadCount > 0 && <span className="chip-unread-count">{unreadCount}</span>}
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

        <div className="conversation-items-scroll">
          {filteredConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`conversation-item ${selected?.id === conversation.id ? 'active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <div className="conversation-item-main">
                <div className="conversation-item-top">
                  <div className="contact-channel-line">
                    <span className={`channel-indicator-icon ${getChannelClass(conversation.channelType || conversation.channel)}`}>
                      <ChannelIcon channel={conversation.channelType || conversation.channel} size={12} />
                    </span>
                    <strong>{conversation.contact}</strong>
                  </div>
                  <small>{conversation.lastAt}</small>
                </div>
                <span>{conversation.lastMessage}</span>
              </div>
              {conversation.unread > 0 && <em>{conversation.unread}</em>}
            </button>
          ))}
          {!filteredConversations.length && <EmptyState title="Nenhum resultado" text="Ajuste a busca ou os filtros para ver outras conversas." compact />}
        </div>
      </aside>

      <section className="chat-panel panel">
        {selected ? <>
          <div className="chat-header">
            <div>
              <div className="chat-header-name-row">
                <strong>{selected.contact}</strong>
                <span className={`channel-pill-tag ${getChannelClass(selected.channelType || selected.channel)}`}>
                  <ChannelIcon channel={selected.channelType || selected.channel} size={12} />
                  {selected.channel}
                </span>
              </div>
              <span>{selected.stage} · Responsável: <strong>{selected.owner || 'Não atribuído'}</strong></span>
            </div>
            <div className="header-actions">
              <button className="secondary-button" type="button" onClick={() => setShowAssignModal(true)}>
                <UserRound size={16} /> Atribuir
              </button>
            </div>
          </div>
          <div className="message-stream">
            {selected.messages.map((message, index) => (
              <div key={`${message.at}-${index}`} className={`bubble ${message.from}`}>
                <p>{message.text}</p>
                <span>{message.at}</span>
              </div>
            ))}
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
            <button className="primary-button" type="button" onClick={sendManualReply} disabled={!draft.trim() || sending}>
              <Send size={17} /> {sending ? 'Enviando...' : 'Enviar'}
            </button>
          </div>
        </> : <EmptyState title="Selecione uma conversa" text="Escolha um contato na lista para visualizar o histórico." />}
        {sendError && <div className="inline-error">{sendError}</div>}
      </section>

      {showAssignModal && selected && (
        <div className="modal-backdrop" onClick={() => setShowAssignModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Atribuir Atendimento</h3>
                <p>Selecione o funcionário da equipe para assumir a conversa com <strong>{selected.contact}</strong></p>
              </div>
              <button className="icon-button compact-btn" type="button" onClick={() => setShowAssignModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="agent-selection-list">
                {agentsList.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className={`agent-selection-item ${selected.owner === agent.name ? 'selected' : ''}`}
                    onClick={() => {
                      onAssignAgent?.(selected.id, agent);
                      setShowAssignModal(false);
                      setAssignToast(`Conversa atribuída a ${agent.name}!`);
                      setTimeout(() => setAssignToast(''), 4000);
                    }}
                  >
                    <div className="agent-avatar small">
                      <UserRound size={18} />
                    </div>
                    <div className="agent-selection-meta">
                      <div className="name-line">
                        <strong>{agent.name}</strong>
                        {agent.role && <span className="agent-badge-role">{agent.role}</span>}
                      </div>
                      <small>{agent.unit || 'Geral'} · {agent.shift || 'Horário comercial'} · {agent.status === 'online' ? 'Online' : 'Standby'}</small>
                    </div>
                    <div className="agent-selection-badge">
                      {selected.owner === agent.name ? (
                        <span className="current-owner-tag"><CheckCircle2 size={14} /> Atual</span>
                      ) : (
                        <span className="select-action-tag">Atribuir</span>
                      )}
                    </div>
                  </button>
                ))}
                {!agentsList.length && (
                  <EmptyState
                    title="Nenhum funcionário cadastrado"
                    text="Acesse o menu Configurações para cadastrar os funcionários da equipe."
                    compact
                  />
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

function Kanban({ kanbanColumns, tenantName }) {
  return (
    <section className="kanban-page">
      <div className="section-toolbar">
        <div className="chips">
          <button className="chip active" type="button">Atendimento {tenantName}</button>
          <button className="chip" type="button">Software</button>
          <button className="chip" type="button">Suporte TI</button>
          <button className="chip" type="button">Marketing digital</button>
        </div>
        <button className="secondary-button" type="button"><Sparkles size={16} /> Nova coluna</button>
      </div>
      <div className="kanban-board">
        {kanbanColumns.map((column) => (
          <div className="kanban-column" key={column.id}>
            <div className="column-header">
              <strong>{column.title}</strong>
              <span>{column.cards.length}</span>
            </div>
            {column.cards.map((card) => (
              <article className="kanban-card" key={card.id}>
                <strong>{card.title}</strong>
                <p>{card.subtitle}</p>
                <div>
                  <Badge value={card.channel} status="channel" />
                  <span>{card.value}</span>
                </div>
                <small>{card.owner}</small>
              </article>
            ))}
            {!column.cards.length && <div className="column-empty">Sem conversas nesta etapa</div>}
          </div>
        ))}
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

function Broadcasts({ conversations = [], contacts = [], campaigns = [], tenantSlug, onChanged }) {
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
      const normalized = parsed.map((row) => normalizeImportedContact(row)).filter((row) => row.externalConversationId);
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
        name: campaignName.trim() || `Disparo ${new Date().toLocaleString('pt-BR')}`,
        channelType: 'telegram',
        messageText: text,
      }, recipients);

      for (const contact of recipients) {
        try {
          await updateBroadcastRecipient(campaign.id, contact.external_conversation_id || contact.externalConversationId, { status: 'sending' });
          const result = await sendN8nCommand('manual_reply', {
            channel_type: contact.channel_type || contact.channelType || 'telegram',
            external_conversation_id: contact.external_conversation_id || contact.externalConversationId,
            contact_name: contact.name || contact.contact_name || 'Contato',
            message_text: text,
            sent_by_user: 'Disparo Mag.IA',
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
        <PanelTitle icon={Megaphone} title="Disparo de mensagens" action="Telegram agora" />
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
          <PanelTitle icon={UsersRound} title="Contatos selecionaveis" action={`${selectedContacts.length}/${allContacts.length}`} />
          <div className="contact-table">
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
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={Clock3} title="Historico de campanhas" />
          <div className="campaign-list">
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
          </div>
        </section>
      </section>
    </section>
  );
}

function Appointments({ appointments = [], conversations = [], tenantSlug, onChanged }) {
  const [title, setTitle] = useState('');
  const [contactName, setContactName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
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
    if (!title.trim() || !startsAt) return;
    setSaving(true);
    setStatus('');
    try {
      await saveAppointment(tenantSlug, {
        title: title.trim(),
        contactName: contactName.trim(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        notes: notes.trim(),
        channelType: selectedConversationId ? 'telegram' : 'manual',
        externalConversationId: selectedConversationId,
      });
      setTitle('');
      setContactName('');
      setStartsAt('');
      setEndsAt('');
      setNotes('');
      setSelectedConversationId('');
      setStatus('Agendamento criado e enviado para o Kanban.');
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Nao foi possivel salvar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="appointments-page">
      <section className="panel appointment-form-panel">
        <PanelTitle icon={CalendarDays} title="Novo agendamento" action="Manual" />
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>Titulo<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: Sessao de bronzeamento" required /></label>
          <div className="form-row-two">
            <label>Contato<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome da cliente" /></label>
            <label>Conversa recente<select value={selectedConversationId} onChange={(event) => pickConversation(event.target.value)}>
              <option value="">Sem vinculo</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.externalConversationId}>{conversation.contact} - {conversation.channel}</option>
              ))}
            </select></label>
          </div>
          <div className="form-row-two">
            <label>Inicio<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label>Fim<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          </div>
          <label className="textarea-label">Observacoes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes internos do atendimento." /></label>
          <div className="header-actions">
            <button className="primary-button" type="submit" disabled={saving || !title.trim() || !startsAt}><CalendarCheck size={16} /> Salvar agendamento</button>
            <small>{status}</small>
          </div>
        </form>
      </section>

      <section className="panel appointment-list-panel">
        <PanelTitle icon={Clock3} title="Calendario simples" action={`${appointments.length} registros`} />
        <div className="appointment-groups">
          {grouped.map((group) => (
            <div className="appointment-day" key={group.day}>
              <h3>{group.day}</h3>
              {group.items.map((appointment) => (
                <article className="appointment-card" key={appointment.id}>
                  <div className="appointment-time"><strong>{appointment.timeLabel}</strong><span>{appointment.endTimeLabel || '--:--'}</span></div>
                  <div>
                    <strong>{appointment.title}</strong>
                    <span>{appointment.contactName || 'Sem contato'} - {appointment.channelLabel}</span>
                    {appointment.notes && <p>{appointment.notes}</p>}
                  </div>
                  <Badge value={appointment.statusLabel} status="channel" />
                </article>
              ))}
            </div>
          ))}
          {!appointments.length && <EmptyState title="Nenhum agendamento" text="Crie um agendamento manual para ele aparecer aqui e no Kanban." />}
        </div>
      </section>
    </section>
  );
}

function Automations() {
  return (
    <section className="content-grid">
      <section className="panel">
        <PanelTitle icon={Workflow} title="Regras de automação" action="Criar regra" />
        <div className="rule-list">
          {automationRules.map((rule) => (
            <article className="rule-card" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <span>{rule.trigger} · {rule.condition}</span>
              </div>
              <div className="rule-actions">
                {rule.actions.map((action) => <Badge key={action} value={action} status="channel" />)}
              </div>
              <div className="rule-footer">
                <span>{rule.runs} execuções</span>
                <label className="switch">
                  <input type="checkbox" defaultChecked={rule.active} />
                  <span />
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Webhook} title="Builder rápido" />
        <div className="form-grid">
          <label>Gatilho<select><option>Mensagem contém palavra-chave</option><option>IA detectou intenção</option><option>Status alterado</option></select></label>
          <label>Condição<input defaultValue="agendar, consulta, horário" /></label>
          <label>Ação<select><option>Mover kanban</option><option>Transferir para humano</option><option>Criar oportunidade</option><option>Notificar equipe</option></select></label>
          <label>Destino<input defaultValue="Consulta solicitada" /></label>
          <button className="primary-button wide" type="button"><PlayCircle size={17} /> Simular regra</button>
        </div>
      </section>
    </section>
  );
}

function AiSettings({ tenantName }) {
  return (
    <section className="ai-layout">
      <section className="panel">
        <PanelTitle icon={Brain} title={`Assistente ${tenantName}`} action={aiConfig.provider} />
        <div className="form-grid two-cols">
          <label>Nome da IA<input defaultValue={aiConfig.name} /></label>
          <label>Provedor<select defaultValue={aiConfig.provider}><option>Regras de automação</option><option>Gemini</option><option>OpenAI</option><option>Anthropic</option><option>Local</option></select></label>
          <label>Modelo<input defaultValue={aiConfig.model} /></label>
          <label>Temperatura<input type="number" step="0.1" defaultValue={aiConfig.temperature} /></label>
        </div>
        <label className="textarea-label">Prompt principal<textarea defaultValue={aiConfig.prompt} /></label>
        <div className="header-actions">
          <button className="secondary-button" type="button"><RefreshCcw size={16} /> Testar regras</button>
          <button className="primary-button" type="button"><CheckCircle2 size={16} /> Preparar IA real</button>
        </div>
      </section>
      <aside className="panel">
        <PanelTitle icon={ShieldCheck} title="Regras e ferramentas" />
        <h3>Guardrails</h3>
        <ul className="event-list">
          {aiConfig.guardrails.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <h3>Ferramentas</h3>
        <div className="tag-list">
          {aiConfig.tools.map((tool) => <span key={tool}>{tool}</span>) }
        </div>
      </aside>
    </section>
  );
}

function SettingsPage({ agents = [], onAddAgent, onToggleAgentStatus, onDeleteAgent, tenantName }) {
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
      channel: channel.trim() || 'WhatsApp / Telegram',
      status: 'online',
      load: 0,
    });
    setName('');
    setRole('');
    setPhone('');
  }

  return (
    <section className="content-grid two">
      <section className="panel">
        <PanelTitle icon={UserCheck} title="Cadastrar Funcionário / Agente" />
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: '13px' }}>
          Cadastre os funcionários humanos do estabelecimento para receberem atendimentos transferidos.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
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
              <option value="WhatsApp">WhatsApp</option>
              <option value="Telegram">Telegram</option>
              <option value="Instagram">Instagram</option>
              <option value="Todos os canais">Todos os canais</option>
            </select>
          </label>

          <button className="primary-button wide" type="submit" disabled={!name.trim()}>
            <UserCheck size={17} /> Salvar Agente
          </button>
        </form>

        <div style={{ marginTop: '22px', borderTop: '1px solid var(--line)', paddingTop: '18px' }}>
          <PanelTitle icon={MessageCircle} title={`Canais Conectados (${tenantName})`} action="Omnichannel" />
          <div className="channel-list" style={{ marginTop: '10px' }}>
            {channelAccounts.map((ch) => (
              <article className="channel-card" key={ch.id}>
                <div>
                  <strong>{ch.name}</strong>
                  <span>{ch.type} · {ch.tenant}</span>
                </div>
                <Badge value={ch.status} status={ch.status === 'conectado' ? 'ia_ativa' : 'channel'} />
                <small>{ch.messages} msgs</small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={UsersRound} title="Equipe de Atendimento Cadastrada" />
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: '13px' }}>
          Funcionários ativos disponíveis para transferência no botão <strong>Atribuir</strong> do chat.
        </p>

        <div className="agents-list">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <div className="agent-avatar small">
                <UserRound size={20} />
              </div>
              <div className="agent-info">
                <div className="agent-name-row">
                  <strong>{agent.name}</strong>
                  {agent.role && <span className="agent-badge-role">{agent.role}</span>}
                  <span className={`status-dot-badge ${agent.status}`}>
                    <span className="pulse-dot" />
                    {agent.status === 'online' ? 'Online' : 'Standby'}
                  </span>
                </div>
                <span className="agent-role">
                  {agent.unit || 'Geral'} · {agent.shift || '08:00 às 18:00'} {agent.phone ? `· ${agent.phone}` : ''}
                </span>
              </div>
              <div className="agent-actions">
                <span className="agent-load-badge">{agent.load || 0} conversas</span>
                <button
                  className="secondary-button compact-btn"
                  type="button"
                  title="Alternar status de disponibilidade"
                  onClick={() => onToggleAgentStatus?.(agent.id)}
                >
                  {agent.status === 'online' ? 'Pausar' : 'Ativar'}
                </button>
                <button
                  className="icon-button compact-btn text-danger"
                  type="button"
                  title="Remover funcionário"
                  onClick={() => onDeleteAgent?.(agent.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
          {!agents.length && (
            <EmptyState
              title="Nenhum funcionário cadastrado"
              text="Cadastre os atendentes e operadores da equipe no formulário ao lado para poder atribuir conversas a eles."
              compact
            />
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

function normalizeImportedContact(row) {
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
    channelType: lookup('canal', 'channel', 'channel_type') || 'telegram',
    externalConversationId,
    phone: lookup('telefone', 'phone', 'whatsapp'),
    email: lookup('email', 'e-mail'),
    source: 'import',
    key: contactKey({ channelType: lookup('canal', 'channel', 'channel_type') || 'telegram', externalConversationId }),
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

function AuthShell({ title }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <strong>Mag.ia</strong>
            <span>Automação que parece magia</span>
          </div>
        </div>
        <h1>{title}</h1>
      </section>
    </main>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div className="brand auth-brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <strong>Mag.ia</strong>
            <span>Automação que parece magia</span>
          </div>
        </div>
        <h1>Acessar painel</h1>
        <label>
          E-mail
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <div className="inline-error">{error}</div>}
        <button className="primary-button wide" type="submit" disabled={loading}>
          <ShieldCheck size={16} />
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
