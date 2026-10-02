function payloadOf(event) {
  if (typeof event.raw_payload !== 'string') return event.raw_payload || {};
  try { return JSON.parse(event.raw_payload); } catch { return {}; }
}

// Events arrive oldest first. A delayed outbound must not reopen a closed session.
export function applyConversationLifecycle(conversation, event, stage) {
  const closed = stage === 'Finalizado' || event.service === 'conversation_closed'
    || event.ai_provider === 'conversation_closed';
  const session = payloadOf(event).conversation_session_id;

  if (closed) {
    conversation.status = 'finalizado';
    conversation.stage = 'Finalizado';
    conversation.closedEventId = event.id || event.external_message_id;
    conversation.closedSessionId = session || conversation.currentSessionId || 'initial';
    return;
  }

  // Eventos atrasados da sessão que já foi encerrada não podem reabrir nem alterar o atendimento.
  if (session && conversation.closedSessionId && session === conversation.closedSessionId) return;

  const inbound = event.direction === 'inbound' && event.sender_type !== 'system';
  if (conversation.status === 'finalizado' && !inbound) return;
  if (inbound) {
    conversation.lastInboundId = event.id || event.external_message_id || event.created_at;
    if (conversation.status === 'finalizado') conversation.status = 'ia_ativa';
  }
  if (session) conversation.currentSessionId = session;
  if (event.handoff) conversation.status = 'atendimento_humano';
  conversation.stage = stage;
}

export function canCloseConversation(conversation, pendingClose) {
  if (!conversation) return false;
  const isFinalized = conversation.status === 'finalizado'
    || conversation.stage === 'Finalizado'
    || conversation.stage === 'finalizado'
    || conversation.service === 'conversation_closed';
  if (isFinalized) return false;

  const isActive = conversation.status === 'ia_ativa'
    || conversation.status === 'atendimento_humano'
    || Boolean(conversation.handoff)
    || conversation.stage === 'Atendimento humano'
    || conversation.stage === 'sales_human';

  if (!isActive) return false;
  if (!pendingClose) return true;
  // Wait for both the persisted boundary and a new inbound, not just a refresh.
  return Boolean(conversation.closedEventId
    && conversation.closedEventId !== pendingClose.closedEventId
    && conversation.lastInboundId
    && conversation.lastInboundId !== pendingClose.lastInboundId);
}
