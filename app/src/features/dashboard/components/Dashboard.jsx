import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Inbox,
  Bot,
  UsersRound,
  MessageCircle,
  ExternalLink,
  UserRound,
} from 'lucide-react';
import { PanelTitle } from '../../../components/ui/PanelTitle';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ContactAvatar } from '../../../components/ui/ContactAvatar';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon';
import { SkeletonLine, SkeletonBlock } from '../../../components/ui/Skeletons';
import { sortConversationsByRecentActivity, getStageLabel } from '../../../dataService';
import { formatConversationPreview } from '../../../utils/audioUtils';
import {
  statusLabels,
  getConversationLastMessageOrigin,
  getConversationLastMessageMeta,
} from '../utils/dashboardHelpers';

export function Dashboard({
  conversations = [],
  dataSource,
  status,
  ready = true,
  onOpenConversation,
  kanbanColumns = [],
  tenantSettings = null,
  tenantSlug = '',
}) {
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
              <span className="th-cell th-contact">Contato</span>
              <span className="th-cell th-channel">Canal</span>
              <span className="th-cell th-status">Status</span>
              <span className="th-cell th-stage">Etapa</span>
              <span className="th-cell th-owner">Responsável</span>
              <span className="th-cell th-message">Última mensagem</span>
              <span className="th-cell th-time">Horário</span>
              <span className="th-cell th-action">Ação</span>
            </div>
            <div className="table-body" ref={recentConversationsListRef} onScroll={isMobileRecentList ? undefined : handleTableScroll}>
              {!ready ? (
                [1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div className="table-row table-row-skeleton" key={i}>
                    <div className="table-cell table-contact-cell">
                      <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%', flexShrink: 0 }} />
                      <div className="table-contact-info">
                        <SkeletonLine width="95px" />
                        <SkeletonLine width="60px" style={{ marginTop: '4px' }} />
                      </div>
                    </div>
                    <div className="table-cell table-channel-cell">
                      <SkeletonLine width="65px" />
                    </div>
                    <div className="table-cell table-status-cell">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <SkeletonBlock width="7px" height="7px" style={{ borderRadius: '50%' }} />
                        <SkeletonLine width="75px" />
                      </div>
                    </div>
                    <div className="table-cell table-stage-cell">
                      <SkeletonLine width="80px" />
                    </div>
                    <div className="table-cell table-owner-cell">
                      <SkeletonLine width="90px" />
                    </div>
                    <div className="table-cell table-message-cell dashboard-message-cell">
                      <SkeletonLine width="50px" height="10px" style={{ marginBottom: '3px' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                        <SkeletonBlock width="18px" height="18px" style={{ borderRadius: '4px', flexShrink: 0 }} />
                        <SkeletonLine width="140px" />
                      </div>
                    </div>
                    <div className="table-cell table-time-cell">
                      <SkeletonLine width="55px" style={{ justifySelf: 'end' }} />
                    </div>
                    <div className="table-cell table-action-cell">
                      <SkeletonBlock width="54px" height="26px" style={{ borderRadius: '6px' }} />
                    </div>
                  </div>
                ))
              ) : (
                <>
                  {displayedConversations.map((item) => {
                    const messageOrigin = getConversationLastMessageOrigin(item);
                    const channel = item.channelType || item.channel;
                    const meta = getConversationLastMessageMeta(item);
                    const formattedText = formatConversationPreview(item.lastMessage);
                    const previewText = formattedText || meta.label || 'Mensagem';
                    const originKey = String(messageOrigin || '').toLowerCase().includes('ia')
                      ? 'ia'
                      : String(messageOrigin || '').toLowerCase().includes('cliente')
                        ? 'cliente'
                        : String(messageOrigin || '').toLowerCase().includes('sistema')
                          ? 'sistema'
                          : 'atendente';

                    return (
                      <div className="table-row" key={item.id}>
                        {/* 1. Contato */}
                        <div className="table-cell table-contact-cell">
                          <div className="conversation-avatar-wrapper compact">
                            <ContactAvatar name={item.contact} avatarUrl={item.avatarUrl} />
                          </div>
                          <div className="table-contact-info">
                            <strong className="contact-name" title={item.contact}>{item.contact}</strong>
                            {item.company && item.company.startsWith('@') && (
                              <small className="contact-handle" title={item.company}>{item.company}</small>
                            )}
                          </div>
                        </div>

                        {/* 2. Canal */}
                        <div className="table-cell table-channel-cell">
                          <div className={`channel-indicator ${getChannelClass(channel)}`}>
                            <ChannelIcon channel={channel} size={15} />
                            <span className="channel-name">{item.channel}</span>
                          </div>
                        </div>

                        {/* 3. Status */}
                        <div className="table-cell table-status-cell">
                          <div className={`dashboard-status-indicator status-${item.status}`}>
                            <span className="status-dot" aria-hidden="true" />
                            <span className="status-label">{statusLabels[item.status] || item.status}</span>
                          </div>
                        </div>

                        {/* 4. Etapa */}
                        <div className="table-cell table-stage-cell">
                          <span className="stage-pill-badge" title={getStageLabel(item.stage || item.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug })}>{getStageLabel(item.stage || item.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug })}</span>
                        </div>

                        {/* 5. Responsável */}
                        <div className="table-cell table-owner-cell">
                          <div className="owner-badge" title={item.owner}>
                            {item.owner === 'Assistente IA' ? (
                              <Bot size={13} className="owner-icon ai" />
                            ) : (
                              <UserRound size={13} className="owner-icon human" />
                            )}
                            <span className="owner-name">{item.owner}</span>
                          </div>
                        </div>

                        {/* 6. Última mensagem (Alinhada à esquerda com ícone e origem) */}
                        <div className="table-cell table-message-cell dashboard-message-cell">
                          {messageOrigin && (
                            <span className={`message-origin-badge origin-${originKey}`}>
                              {messageOrigin}
                            </span>
                          )}
                          <div className="message-preview-row">
                            <span className={`message-type-icon-wrap icon-${meta.type}`} aria-hidden="true" title={meta.label}>
                              {meta.icon}
                            </span>
                            <span className="message-preview-text" title={item.lastMessage || previewText}>
                              {previewText}
                            </span>
                          </div>
                        </div>

                        {/* 7. Horário */}
                        <div className="table-cell table-time-cell">
                          <small className="timestamp-text">{item.lastAt}</small>
                        </div>

                        {/* 8. Ação */}
                        <div className="table-cell table-action-cell">
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
