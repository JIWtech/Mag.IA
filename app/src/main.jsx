import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bot,
  Brain,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Filter,
  Gauge,
  GitBranch,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  UsersRound,
  Webhook,
  Workflow,
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
  getInitialTenantSlug,
  loadAvailableTenants,
  loadClientData,
  persistTenantSlug,
  subscribeToClientEvents,
} from './dataService';
import './styles.css';

const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'conversas', label: 'Conversas', icon: MessageCircle },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'funil', label: 'Funil', icon: GitBranch },
  { id: 'automacoes', label: 'Automacoes', icon: Workflow },
  { id: 'ia', label: 'IA', icon: Brain },
  { id: 'configuracoes', label: 'Configuracoes', icon: Settings },
];

const statusLabels = {
  ia_ativa: 'Bot ativo',
  atendimento_humano: 'Atendimento humano',
  aguardando_cliente: 'Aguardando cliente',
  finalizada: 'Finalizada',
  erro: 'Atencao',
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
  const [appData, setAppData] = useState({
    conversations,
    kanbanColumns,
    funnelStages,
    source: 'mock',
    status: null,
  });
  const selectedTenant = availableTenants.find((tenant) => tenant.slug === tenantSlug) || availableTenants[0] || mockTenants[0];
  const activeTenantSlug = selectedTenant?.slug || tenantSlug || 'jiw';
  const integration = getIntegrationStatus(activeTenantSlug);

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
    try {
      const data = await loadClientData({ conversations, kanbanColumns, funnelStages }, activeTenantSlug);
      setAppData(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthRequired() && !session) return;
    loadAvailableTenants(mockTenants).then((tenantsFromDb) => {
      setAvailableTenants(tenantsFromDb);
      if (!tenantsFromDb.some((tenant) => tenant.slug === tenantSlug)) {
        const nextSlug = tenantsFromDb[0]?.slug || tenantSlug;
        setTenantSlug(nextSlug);
        persistTenantSlug(nextSlug);
      }
    });
  }, [session]);

  useEffect(() => {
    if (isAuthRequired() && !session) return;
    persistTenantSlug(activeTenantSlug);
    refreshData();
  }, [activeTenantSlug, session]);

  useEffect(() => {
    if (isAuthRequired() && !session) return undefined;
    let timer = null;
    const poller = setInterval(() => {
      refreshData();
    }, 5000);
    const unsubscribe = subscribeToClientEvents(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshData();
      }, 350);
    });

    return () => {
      clearTimeout(timer);
      clearInterval(poller);
      unsubscribe();
    };
  }, [activeTenantSlug, session]);

  if (checkingAuth) {
    return <AuthShell title="Carregando acesso" />;
  }

  if (isAuthRequired() && !session) {
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>Mag.ia</strong>
            <span>Automacao que parece magia</span>
          </div>
        </div>

        <nav className="nav-list">
          {menu.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="integration-pill">
            <span className={`dot ${integration.mode === 'mock' ? 'warn' : 'ok'}`} />
            <span>{integration.mode === 'mock' ? 'Modo mock' : 'Integravel'}</span>
          </div>
          <small>Tenant: {integration.tenantSlug}</small>
        </div>
      </aside>

      <main className="main">
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
            <button className="primary-button" type="button">
              <Plus size={17} />
              Novo item
            </button>
          </div>
        </header>

        {active === 'dashboard' && <Dashboard conversations={appData.conversations} dataSource={appData.source} status={appData.status} />}
        {active === 'conversas' && <Conversations conversations={appData.conversations} tenantSlug={activeTenantSlug} onSent={refreshData} />}
        {active === 'kanban' && <Kanban kanbanColumns={appData.kanbanColumns} tenantName={selectedTenant.name} />}
        {active === 'funil' && <Funnel funnelStages={appData.funnelStages} tenantName={selectedTenant.name} />}
        {active === 'automacoes' && <Automations />}
        {active === 'ia' && <AiSettings tenantName={selectedTenant.name} />}
        {active === 'configuracoes' && <SettingsPage integration={integration} tenantName={selectedTenant.name} />}
      </main>
    </div>
  );
}

function Dashboard({ conversations, dataSource, status }) {
  const stats = useMemo(() => {
    const activeBot = conversations.filter((item) => item.status === 'ia_ativa').length;
    const human = conversations.filter((item) => item.status === 'atendimento_humano').length;
    const totalValue = conversations.reduce((sum, item) => sum + item.value, 0);

    return [
      { label: 'Conversas', value: conversations.length.toString(), change: dataSource === 'supabase' ? 'Supabase' : dataSource, icon: Inbox },
      { label: 'Bot ativo', value: activeBot.toString(), change: status?.ai || 'Regras/fallback', icon: Bot },
      { label: 'Humanas', value: human.toString(), change: 'fila', icon: UsersRound },
      { label: 'Valor em funil', value: formatCurrency(totalValue), change: 'estimado', icon: CircleDollarSign },
    ];
  }, [conversations, dataSource, status]);

  return (
    <section className="page-grid">
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

      <div className="content-grid two">
        <section className="panel">
          <PanelTitle icon={Activity} title="Operacao atual" action={clientStatus.channel} />
          <div className="bar-list">
            {[
              ['Telegram conectado', 100],
              ['Webhook n8n ativo', 100],
              [status?.ai === 'Gemini' ? 'Gemini ativo' : 'Regras/fallback', 100],
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
            <Signal icon={CheckCircle2} label="Bot Telegram conectado" value={clientStatus.botUsername} tone="ok" />
            <Signal icon={Clock3} label="Ultimo evento" value={status?.latestAt || 'Sem eventos'} tone="info" />
            <Signal icon={PauseCircle} label="Conversas para humano" value={String(status?.humanQueue || 0)} tone="warn" />
            <Signal icon={Zap} label="IA" value={status?.ai || 'Regras/fallback'} tone={status?.ai === 'Gemini' ? 'ok' : 'warn'} />
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelTitle icon={MessageCircle} title="Conversas recentes" action="Ver todas" />
        <div className="table">
          <div className="table-head">
            <span>Contato</span><span>Canal</span><span>Status</span><span>Etapa</span><span>Responsavel</span><span>Ultima mensagem</span>
          </div>
          {conversations.map((item) => (
            <div className="table-row" key={item.id}>
              <strong>{item.contact}</strong>
              <span>{item.channel}</span>
              <Badge value={statusLabels[item.status]} status={item.status} />
              <span>{item.stage}</span>
              <span>{item.owner}</span>
              <small>{item.lastMessage}</small>
            </div>
          ))}
          {!conversations.length && <EmptyState title="Nenhuma conversa real ainda" text="Assim que o bot Telegram receber mensagens, elas aparecem aqui." />}
        </div>
      </section>
    </section>
  );
}

function Conversations({ conversations, tenantSlug, onSent }) {
  const [selectedId, setSelectedId] = useState(conversations[0]?.id || null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('todas');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const messagesEndRef = React.useRef(null);

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

      return matchesQuery && matchesFilter;
    });
  }, [conversations, filter, query]);

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
      setSendError(error.message || 'Nao foi possivel enviar a resposta.');
    } finally {
      setSending(false);
    }
  }

  if (!conversations.length) {
    return (
      <section className="panel">
        <EmptyState title="Nenhuma conversa no Telegram" text="Envie uma mensagem para o bot da JIW e clique em atualizar para carregar o atendimento real." />
      </section>
    );
  }

  return (
    <section className="conversation-layout">
      <aside className="conversation-list panel">
        <div className="toolbar">
          <div className="search-box"><Search size={16} /><input placeholder="Buscar conversa" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <button className="icon-button" title="Filtros" type="button"><Filter size={17} /></button>
        </div>
        <div className="chips">
          <button className={`chip ${filter === 'todas' ? 'active' : ''}`} type="button" onClick={() => setFilter('todas')}>Todas</button>
          <button className={`chip ${filter === 'ia' ? 'active' : ''}`} type="button" onClick={() => setFilter('ia')}>IA</button>
          <button className={`chip ${filter === 'humanas' ? 'active' : ''}`} type="button" onClick={() => setFilter('humanas')}>Humanas</button>
          <button className={`chip ${filter === 'nao_lidas' ? 'active' : ''}`} type="button" onClick={() => setFilter('nao_lidas')}>Nao lidas</button>
        </div>
        <div className="conversation-items-scroll">
          {filteredConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`conversation-item ${selected?.id === conversation.id ? 'active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <div>
                <strong>{conversation.contact}</strong>
                <span>{conversation.lastMessage}</span>
              </div>
              <small>{conversation.lastAt}</small>
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
              <strong>{selected.contact}</strong>
              <span>{selected.channel} · {selected.stage}</span>
            </div>
            <div className="header-actions">
              <button className="secondary-button" type="button"><UserRound size={16} /> Atribuir</button>
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
              placeholder="Responder manualmente pelo canal conectado"
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
              <Send size={17} /> {sending ? 'Enviando' : 'Enviar'}
            </button>
          </div>
        </> : <EmptyState title="Selecione uma conversa" text="Escolha um contato na lista para visualizar o histórico." />}
        {sendError && <div className="inline-error">{sendError}</div>}
      </section>
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
        <button className="secondary-button" type="button"><Plus size={16} /> Nova coluna</button>
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
        <PanelTitle icon={GitBranch} title="Funil comercial" action="Mes atual" />
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
        <PanelTitle icon={CalendarCheck} title="Proximas acoes" />
        <div className="task-list">
          <Task title="Testar conversa real no Telegram" meta={`${tenantName} · webhook multi-tenant`} />
          <Task title="Confirmar tenant no Supabase" meta="Banco multi-tenant" />
          <Task title="Acompanhar mensagens reais" meta="channel_events + tempo real" />
          <Task title="Monitorar IA paga" meta="Gemini com limite por dia" />
        </div>
      </section>
    </section>
  );
}

function Automations() {
  return (
    <section className="content-grid">
      <section className="panel">
        <PanelTitle icon={Workflow} title="Regras de automacao" action="Criar regra" />
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
                <span>{rule.runs} execucoes</span>
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
        <PanelTitle icon={Webhook} title="Builder rapido" />
        <div className="form-grid">
          <label>Gatilho<select><option>Mensagem contem palavra-chave</option><option>IA detectou intencao</option><option>Status alterado</option></select></label>
          <label>Condicao<input defaultValue="agendar, consulta, horario" /></label>
          <label>Acao<select><option>Mover kanban</option><option>Transferir para humano</option><option>Criar oportunidade</option><option>Notificar equipe</option></select></label>
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
          <label>Provedor<select defaultValue={aiConfig.provider}><option>Regras MOCK</option><option>Gemini</option><option>OpenAI</option><option>Anthropic</option><option>Local</option></select></label>
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
          {aiConfig.tools.map((tool) => <span key={tool}>{tool}</span>)}
        </div>
      </aside>
    </section>
  );
}

function SettingsPage({ integration, tenantName }) {
  return (
    <section className="content-grid two">
      <section className="panel">
        <PanelTitle icon={MessageCircle} title={`Canais ${tenantName}`} action="Omnichannel" />
        <div className="channel-list">
          {channelAccounts.map((channel) => (
            <article className="channel-card" key={channel.id}>
              <div>
                <strong>{channel.name}</strong>
                <span>{channel.type} · {channel.tenant}</span>
              </div>
              <Badge value={channel.status} status={channel.status === 'conectado' ? 'ia_ativa' : 'channel'} />
              <small>{channel.messages} mensagens</small>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Webhook} title="Mapa de integracao" />
        <div className="integration-status">
          <Signal icon={ShieldCheck} label="Telegram" value="conectado" tone="ok" />
          <Signal icon={ShieldCheck} label="Instagram" value="preparado" tone="warn" />
          <Signal icon={Webhook} label="n8n webhook" value="ativo" tone="ok" />
          <Signal icon={Brain} label="IA paga" value="desativada" tone="warn" />
          <Signal icon={ShieldCheck} label="Supabase" value={integration.supabase ? 'configurado' : 'pendente'} tone={integration.supabase ? 'ok' : 'warn'} />
        </div>
        <div className="table compact">
          <div className="table-head"><span>Area</span><span>Tabelas</span><span>Webhook</span></div>
          {integrationTargets.map((target) => (
            <div className="table-row" key={target.area}>
              <strong>{target.area}</strong>
              <small>{target.table}</small>
              <small>{target.webhook}</small>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
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

function Detail({ label, value }) {
  return (
    <div className="detail">
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
            <span>Automacao que parece magia</span>
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
      setError(loginError.message || 'Nao foi possivel entrar.');
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
            <span>Automacao que parece magia</span>
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
          {loading ? 'Entrando' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
