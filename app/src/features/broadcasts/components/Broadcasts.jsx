import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Clock3,
  Search,
  UsersRound,
  X,
  Play,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { PanelTitle } from '../../../components/ui/PanelTitle';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ContactAvatar } from '../../../components/ui/ContactAvatar';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons';
import {
  createBroadcastCampaign,
  updateBroadcastCampaign,
  updateBroadcastRecipient,
  upsertBroadcastContacts,
} from '../../../dataService';
import { createBroadcastOperations } from '../../../services/broadcasts/broadcastOperations.js';
import { executeBroadcastCampaign } from '../../../services/broadcasts/broadcastWorker.js';
import {
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
  calculateCampaignCounters,
} from '../../../services/broadcasts/broadcastStateMachine.js';
import { getAuthClient, getCurrentSession } from '../../../services/auth/authService.js';
import { sendN8nCommand } from '../../../services/integration.js';
import { CHANNEL_OPTIONS } from '../../../services/tenants/tenantAccess.js';
import {
  parseContactFile,
  normalizeImportedContact,
  conversationToBroadcastContact,
  contactKey,
  mergeBroadcastContacts,
  displayContactName,
  displayContactPhone,
} from '../utils/broadcastImport';

export function Broadcasts({ conversations = [], contacts = [], campaigns = [], tenantSlug, onChanged, ready = true, allowedChannels = CHANNEL_OPTIONS.map(c => c.id) }) {
  const defaultChannel = allowedChannels.includes('telegram') ? 'telegram' : allowedChannels[0] || 'whatsapp';
  const [draftContacts, setDraftContacts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [messageText, setMessageText] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const abortControllerRef = useRef(null);

  const broadcastOps = useMemo(() => {
    return createBroadcastOperations({
      getClient: getAuthClient,
      loadTenant: async (slug) => {
        const supabase = getAuthClient();
        if (!supabase) return null;
        const { data } = await supabase.from('tenants').select('id, slug, status').eq('slug', slug).single();
        return data || null;
      },
      currentUserId: async () => {
        const session = await getCurrentSession();
        return session?.user?.id || null;
      },
    });
  }, []);

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

  // Detecta qualquer campanha em andamento, pausada ou com envios incertos a reconciliar
  const recoverableCampaign = useMemo(() => {
    return (campaigns || []).find((c) =>
      c.status === CAMPAIGN_STATUS.SENDING ||
      c.status === CAMPAIGN_STATUS.PAUSED ||
      c.status === CAMPAIGN_STATUS.QUEUED ||
      (c.status === CAMPAIGN_STATUS.PARTIAL_ERROR && (c.unknown_count > 0 || (c.sent_count || 0) < (c.total_recipients || 0)))
    );
  }, [campaigns]);

  useEffect(() => {
    if (!busy) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = 'Um disparo de mensagens está em processamento persistido. Fechar a aba pausará o envio local sem risco de duplicatas, e a campanha poderá ser retomada.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [busy]);

  async function resumeCampaign(campaignToResume) {
    if (busy || !campaignToResume) return;
    setBusy(true);
    setStatus(`Retomando campanha "${campaignToResume.name}" de forma segura...`);

    const abortController = typeof window !== 'undefined' && window.AbortController ? new window.AbortController() : null;
    abortControllerRef.current = abortController;

    try {
      // 1. Recupera leases órfãs ('claimed' -> 'queued'; 'sending' -> 'unknown')
      await broadcastOps.recoverStaleLeases(campaignToResume.id);

      // 2. Dispara sinalização ao backend/n8n se disponível
      sendN8nCommand('broadcast_resume', {
        campaign_id: campaignToResume.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      // 3. Executa o worker via leases atômicas estritas
      const message = campaignToResume.message_text || campaignToResume.message_template || messageText;
      await executeBroadcastCampaign({
        campaignId: campaignToResume.id,
        tenantSlug,
        messageText: message,
        defaultChannel: campaignToResume.channel_type || defaultChannel,
        sendCommand: sendN8nCommand,
        operations: broadcastOps,
        abortSignal: abortController?.signal,
        delayMs: 1200,
        onProgress: ({ message: stepMessage }) => {
          setStatus(stepMessage || 'Aguardando próximo envio...');
        },
      });

      const finalRecipients = await broadcastOps.getBroadcastCampaignRecipients(campaignToResume.id);
      const counters = calculateCampaignCounters(finalRecipients);

      setStatus(`Retomada concluída: ${counters.sent} enviados, ${counters.failed} falhas${counters.unknown ? `, ${counters.unknown} incertos` : ''}.`);
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Falha ao retomar campanha.');
    } finally {
      setBusy(false);
      abortControllerRef.current = null;
    }
  }

  async function cancelCampaign(campaignToCancel) {
    if (!campaignToCancel || busy) return;
    setBusy(true);
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const res = await broadcastOps.cancelBroadcastCampaign(campaignToCancel.id);

      sendN8nCommand('broadcast_cancel', {
        campaign_id: campaignToCancel.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      setStatus(`Campanha "${campaignToCancel.name}" cancelada (${res.cancelled_recipients || 0} pendentes cancelados).`);
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Erro ao cancelar campanha.');
    } finally {
      setBusy(false);
    }
  }

  async function reconcileUnknownRecipients(campaignToReconcile, targetStatus = RECIPIENT_STATUS.FAILED) {
    if (!campaignToReconcile || busy) return;
    setBusy(true);
    try {
      const recipients = await broadcastOps.getBroadcastCampaignRecipients(campaignToReconcile.id);
      const unknownList = recipients.filter((r) => r.status === RECIPIENT_STATUS.UNKNOWN);
      for (const rec of unknownList) {
        await broadcastOps.reconcileUnknownRecipient(
          campaignToReconcile.id,
          rec.id,
          targetStatus,
          'Reconciliado manualmente pelo operador no painel'
        );
      }
      setStatus(`${unknownList.length} envio(s) incertos reconciliados como ${targetStatus === RECIPIENT_STATUS.SENT ? 'enviados' : 'falha'}.`);
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Falha ao reconciliar envios incertos.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCampaign() {
    const text = messageText.trim();
    if (!text || !selectedContacts.length || busy) return;
    setBusy(true);
    setStatus('Persistindo campanha e destinatários no servidor...');

    let campaign = null;
    const abortController = typeof window !== 'undefined' && window.AbortController ? new window.AbortController() : null;
    abortControllerRef.current = abortController;

    try {
      const savedContacts = await upsertBroadcastContacts(tenantSlug, selectedContacts);
      const recipients = mergeBroadcastContacts(savedContacts, selectedContacts);

      campaign = await createBroadcastCampaign(tenantSlug, {
        name: campaignName.trim() || `Disparo ${new Date().toLocaleDateString('pt-BR')}`,
        message_template: text,
        messageText: text,
        channelType: defaultChannel,
        total_recipients: recipients.length,
        status: CAMPAIGN_STATUS.SENDING,
      }, recipients);

      setStatus('Campanha persistida. Despachando lote com chave de idempotência...');

      // Dispara sinalização ao backend/n8n se disponível
      sendN8nCommand('broadcast_start', {
        campaign_id: campaign.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      // Executa o processador durável via leases atômicas
      await executeBroadcastCampaign({
        campaignId: campaign.id,
        tenantSlug,
        messageText: text,
        defaultChannel,
        sendCommand: sendN8nCommand,
        operations: broadcastOps,
        abortSignal: abortController.signal,
        delayMs: 1200,
        onProgress: ({ phase, message: stepMessage }) => {
          if (phase === 'pacing' || phase === 'sending') {
            setStatus(stepMessage || 'Aguardando próximo envio...');
          } else if (phase === 'item_completed') {
            setStatus('Processando destinatários persistidos...');
          }
        },
      });

      const finalRecipients = await broadcastOps.getBroadcastCampaignRecipients(campaign.id);
      const finalCounters = calculateCampaignCounters(finalRecipients);

      setStatus(`Disparo concluído: ${finalCounters.sent} enviados, ${finalCounters.failed} falhas${finalCounters.unknown ? `, ${finalCounters.unknown} incertos` : ''}.`);
      setMessageText('');
      setCampaignName('');
      setSelected(new Set());
      await onChanged?.();
    } catch (error) {
      if (campaign?.id) {
        await broadcastOps.updateBroadcastCampaign(campaign.id, {
          status: CAMPAIGN_STATUS.PARTIAL_ERROR,
        }).catch(() => {});
      }
      setStatus(error.message || 'Falha ao executar disparo.');
    } finally {
      setBusy(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <section className="broadcast-page">
      <section className="panel broadcast-campaign-panel">
        {recoverableCampaign && (
          <div className="broadcast-interrupted-banner" style={{
            margin: '0 0 1.25rem 0',
            padding: '1rem 1.25rem',
            borderRadius: '10px',
            background: recoverableCampaign.unknown_count > 0 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(59, 130, 246, 0.08)',
            border: recoverableCampaign.unknown_count > 0 ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(59, 130, 246, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {recoverableCampaign.unknown_count > 0 ? (
                  <AlertTriangle size={16} color="#f59e0b" />
                ) : (
                  <Clock3 size={16} color="#3b82f6" />
                )}
                <span>
                  {recoverableCampaign.unknown_count > 0
                    ? `Campanha com envios incertos: ${recoverableCampaign.name}`
                    : `Campanha em andamento / recuperável: ${recoverableCampaign.name}`}
                </span>
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                {recoverableCampaign.sent_count || 0} de {recoverableCampaign.total_recipients || 0} enviados
                {recoverableCampaign.failed_count ? `, ${recoverableCampaign.failed_count} falhas` : ''}
                {recoverableCampaign.unknown_count ? `, ${recoverableCampaign.unknown_count} incertos` : ''}.
                Destinatários já processados são preservados e nunca serão duplicados.
              </p>
              {recoverableCampaign.unknown_count > 0 && (
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#fbbf24' }}>
                  Aviso: {recoverableCampaign.unknown_count} destinatário(s) tiveram envio incerto. Para prevenir mensagens repetidas no WhatsApp, eles não serão reenviados automaticamente.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {(recoverableCampaign.sent_count || 0) < (recoverableCampaign.total_recipients || 0) && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => resumeCampaign(recoverableCampaign)}
                  disabled={busy}
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
                >
                  <Play size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Retomar envio
                </button>
              )}
              {recoverableCampaign.unknown_count > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => reconcileUnknownRecipients(recoverableCampaign, RECIPIENT_STATUS.FAILED)}
                  disabled={busy}
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem', borderColor: 'rgba(245, 158, 11, 0.4)' }}
                  title="Conclui os envios incertos marcando-os como falha para não reenviar"
                >
                  <RotateCcw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Concluir incertos
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => cancelCampaign(recoverableCampaign)}
                disabled={busy}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
              >
                Cancelar campanha
              </button>
            </div>
          </div>
        )}
        <div className="broadcast-campaign-heading">
          <h2>Nova campanha</h2>
          <p>Defina o público, escreva sua mensagem e prepare o envio persistido.</p>
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
                const statusLabel =
                  campaign.status === 'sent' ? 'Concluída' :
                  campaign.status === 'partial_error' ? 'Parcial' :
                  campaign.status === 'failed' ? 'Falhou' :
                  campaign.status === 'cancelled' ? 'Cancelada' :
                  campaign.status === 'paused' ? 'Pausada' : 'Enviando';
                const statusTone =
                  campaign.status === 'sent' ? 'ia_ativa' :
                  campaign.status === 'failed' || campaign.status === 'cancelled' ? 'humano' :
                  campaign.status === 'partial_error' ? 'qualificacao' : 'channel';
                return (
                  <article className="campaign-card" key={campaign.id}>
                    <div>
                      <strong>{campaign.name}</strong>
                      <span>{metadata} · {campaign.total_recipients || 0} destinatários{campaign.unknown_count ? ` (${campaign.unknown_count} incertos)` : ''}</span>
                    </div>
                    <Badge value={statusLabel} status={statusTone} />
                  </article>
                );
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
