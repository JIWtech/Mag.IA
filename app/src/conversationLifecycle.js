function payloadOf(event) {
  if (typeof event.raw_payload !== 'string') return event.raw_payload || {};
  try { return JSON.parse(event.raw_payload); } catch { return {}; }
}

// Events arrive oldest first. A delayed outbound must not reopen a closed session.
export function applyConversationLifecycle(conversation, event, stage) {
  const closed = stage === 'Finalizado' || event.service === 'conversation_closed'
    || event.ai_provider === 'conversation_closed';
  if (closed) {
    conversation.status = 'finalizado';
    conversation.stage = 'Finalizado';
    conversation.closedEventId = event.id || event.external_message_id;
    return;
  }
  const session = payloadOf(event).conversation_session_id;
  if (session && conversation.closedEventId && session !== conversation.closedEventId) return;

  const inbound = event.direction === 'inbound' && event.sender_type !== 'system';
  if (conversation.status === 'finalizado' && !inbound) return;
  if (inbound) {
    conversation.lastInboundId = event.id || event.external_message_id || event.created_at;
    if (conversation.status === 'finalizado') conversation.status = 'ia_ativa';
  }
  if (event.handoff) conversation.status = 'atendimento_humano';
  conversation.stage = stage;
}

export function canCloseConversation(conversation, pendingClose) {
  if (!conversation || !['ia_ativa', 'atendimento_humano'].includes(conversation.status)) return false;
  if (!pendingClose) return true;
  // Wait for both the persisted boundary and a new inbound, not just a refresh.
  return Boolean(conversation.closedEventId
    && conversation.closedEventId !== pendingClose.closedEventId
    && conversation.lastInboundId
    && conversation.lastInboundId !== pendingClose.lastInboundId);
}
export function requirePersistedClosure(result) {
  const closed = result?.saved?.find?.(event => event.id && event.service === 'conversation_closed');
  if (result?.ok !== true || !closed) {
    throw new Error('O encerramento nao foi confirmado pelo servidor. Atualize a conversa e tente novamente.');
  }
  return closed;
}
