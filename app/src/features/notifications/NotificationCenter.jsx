import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Building2,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock,
  ExternalLink,
  Info,
  MessageSquare,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useNotifications } from './useNotifications.js';
import { incidentPresentation } from './notificationService.js';
import './notifications.css';

function timeLabel(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Horário indisponível';
}

export function NotificationCenter({ tenantId, userId, tenantName, conversations = [], onOpenConversation }) {
  const inbox = useNotifications(tenantId, userId);
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const bell = useRef(null);
  const closeButton = useRef(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    closeButton.current?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); bell.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="notification-center" ref={root} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={bell}
        className={`icon-button notification-bell ${open ? 'is-active' : ''}`}
        type="button"
        aria-label={`Notificações${inbox.unread === null ? '' : `, ${inbox.unread} não lidas`}${inbox.error ? ', sincronização indisponível' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        title="Notificações"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {inbox.unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {inbox.unread > 99 ? '99+' : inbox.unread}
          </span>
        )}
        {inbox.error && <span className="notification-connection-dot" aria-hidden="true" title="Sincronização indisponível" />}
      </button>

      {open && (
        <section id={panelId} role="dialog" aria-labelledby={titleId} className="notification-popover">
          <div className="notification-popover-glow" aria-hidden="true" />

          <header className="notification-heading">
            <div className="notification-heading-text">
              <div className="notification-title-wrap">
                <h2 id={titleId}>Notificações</h2>
                {inbox.unread !== null && inbox.unread > 0 && (
                  <span className="notification-unread-count-pill" aria-hidden="true">
                    {inbox.unread} nova{inbox.unread > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="notification-tenant-tag">
                <Building2 size={11} aria-hidden="true" />
                <span>{tenantName || 'Empresa atual'}</span>
              </p>
            </div>
            <button
              ref={closeButton}
              className="icon-button notification-close-btn"
              type="button"
              aria-label="Fechar notificações"
              onClick={() => { setOpen(false); bell.current?.focus(); }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          <div className="notification-toolbar">
            <span className="notification-toolbar-status" role="status">
              {inbox.unread === null
                ? 'Acompanhamento operacional'
                : inbox.unread === 0
                  ? 'Todas as mensagens lidas'
                  : `${inbox.unread} não lida${inbox.unread > 1 ? 's' : ''}`}
            </span>
            {inbox.unread > 0 && (
              <button
                type="button"
                className="notification-mark-all-btn"
                disabled={inbox.syncing || Boolean(inbox.error)}
                onClick={inbox.markAllRead}
              >
                <CheckCheck size={12} aria-hidden="true" />
                <span>Marcar todas como lidas</span>
              </button>
            )}
          </div>

          {(inbox.loading || inbox.syncing) && (
            <div className="notification-sync-progress" aria-hidden="true" />
          )}

          <div className="notification-scroll" aria-busy={inbox.loading || inbox.syncing}>
            {inbox.loading && (
              <div className="notification-message notification-loading" role="status">
                <RotateCw size={16} className="notification-spin" aria-hidden="true" />
                <p>Carregando notificações…</p>
              </div>
            )}

            {inbox.error && (
              <div className="notification-message notification-error" role="status">
                <div className="notification-error-content">
                  <AlertCircle size={16} className="notification-error-icon" aria-hidden="true" />
                  <div className="notification-error-text-wrap">
                    <p className="notification-error-title">{inbox.error}</p>
                    {inbox.items.length > 0 && (
                      <p className="notification-error-desc">
                        Exibindo a última sincronização. O contador pode estar desatualizado.
                      </p>
                    )}
                  </div>
                </div>
                <button
                  className="secondary-button notification-retry-btn"
                  type="button"
                  disabled={inbox.syncing}
                  onClick={inbox.refresh}
                >
                  <RotateCw size={12} className={inbox.syncing ? 'notification-spin' : ''} aria-hidden="true" />
                  <span>{inbox.syncing ? 'Reconectando…' : 'Tentar novamente'}</span>
                </button>
              </div>
            )}

            {!inbox.loading && !inbox.error && inbox.items.length === 0 && (
              <div className="notification-empty">
                <div className="notification-empty-icon-wrap" aria-hidden="true">
                  <Bell size={20} strokeWidth={1.5} />
                </div>
                <p>Nenhuma notificação por enquanto</p>
                <span>Os avisos de atendimento e incidentes operacionais aparecerão aqui.</span>
              </div>
            )}

            <ul className="notification-list">
              {inbox.items.map((item) => {
                const info = incidentPresentation(item);
                const Icon = info.kind === 'closed' ? CircleCheck : info.kind === 'uncertain' ? CircleHelp : ShieldAlert;
                const conversation = conversations.find(
                  (entry) => entry.channelType === item.channel_type && entry.externalConversationId === item.chat_id
                );
                const occurredAt = item.revision === 1 ? item.created_at : item.updated_at;

                return (
                  <li key={item.id} className={`notification-item ${item.unread ? 'is-unread' : 'is-read'}`}>
                    <span className={`notification-type ${info.kind}`}>
                      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                    </span>

                    <div className="notification-content">
                      <div className="notification-title">
                        <h3>{info.title}</h3>
                        {item.unread && <span className="notification-unread-dot" aria-label="Não lida" />}
                      </div>

                      <p className="notification-desc">{info.description}</p>

                      {conversation?.contact && (conversation.contactNameIsTrusted || conversation.contactNameIsCanonical) && (
                        <div className="notification-contact">
                          <MessageSquare size={11} aria-hidden="true" />
                          <span>{conversation.contact}</span>
                        </div>
                      )}

                      <div className="notification-meta">
                        <span className={`notification-status-badge ${info.kind}`}>{info.status}</span>
                        <time className="notification-time" dateTime={occurredAt}>
                          <Clock size={10} aria-hidden="true" />
                          <span>{timeLabel(occurredAt)}</span>
                        </time>
                      </div>

                      {item.acknowledged_at && !item.resolved_at && (
                        <div className="notification-ack">
                          <Info size={11} aria-hidden="true" />
                          <span>Reconhecido pela operação · aguardando resolução</span>
                        </div>
                      )}

                      <div className="notification-item-actions">
                        {conversation && (
                          <button
                            type="button"
                            className="notification-action-btn primary"
                            onClick={() => {
                              onOpenConversation(conversation.id);
                              setOpen(false);
                            }}
                          >
                            <ExternalLink size={11} aria-hidden="true" />
                            <span>Abrir conversa</span>
                          </button>
                        )}
                        {item.unread && (
                          <button
                            type="button"
                            className="notification-action-btn secondary"
                            disabled={inbox.syncing || Boolean(inbox.error)}
                            onClick={() => inbox.markRead(item)}
                          >
                            <Check size={11} aria-hidden="true" />
                            <span>Marcar como lida</span>
                          </button>
                        )}
                      </div>

                      <details className="notification-details">
                        <summary className="notification-details-summary">
                          <ChevronRight size={12} className="notification-details-chevron" aria-hidden="true" />
                          <span>Detalhes técnicos</span>
                        </summary>
                        <div className="notification-details-body">
                          <dl className="notification-dl">
                            <dt>Ticket</dt>
                            <dd>{item.id}</dd>
                            <dt>Revisão do ticket</dt>
                            <dd>{item.ticket_revision}</dd>
                            <dt>Estado registrado</dt>
                            <dd>{item.phase}</dd>
                            {item.error_code && (
                              <>
                                <dt>Código</dt>
                                <dd>{item.error_code}</dd>
                              </>
                            )}
                            {item.resolution && (
                              <>
                                <dt>Resolução</dt>
                                <dd>{item.resolution}</dd>
                              </>
                            )}
                            <dt>Ocorrência inicial</dt>
                            <dd>{timeLabel(item.created_at)}</dd>
                          </dl>
                          <p className="notification-details-disclaimer">
                            <Info size={10} aria-hidden="true" />
                            <span>A leitura deste aviso não altera o atendimento nem autoriza novos envios.</span>
                          </p>
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>

            {inbox.hasMore && (
              <button
                className="notification-more secondary-button"
                type="button"
                disabled={inbox.loading || inbox.syncing}
                onClick={inbox.loadMore}
              >
                Ver anteriores
              </button>
            )}

            {inbox.isOlderPage && (
              <button
                className="notification-more secondary-button"
                type="button"
                disabled={inbox.loading || inbox.syncing}
                onClick={inbox.showLatest}
              >
                Voltar às recentes
              </button>
            )}
          </div>

          <footer className="notification-footer">
            <Info size={12} aria-hidden="true" />
            <span>Ler um aviso não resolve o incidente.</span>
          </footer>
        </section>
      )}
    </div>
  );
}

