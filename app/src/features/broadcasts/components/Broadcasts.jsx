import React, { useState, useMemo } from 'react';
import {
  Clock3,
  Search,
  UsersRound,
  X,
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
