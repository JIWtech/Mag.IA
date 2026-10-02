import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConversationLifecycle, canCloseConversation } from './conversationLifecycle.js';

const inbound = { id: 'in-1', direction: 'inbound' };
const close = { id: 'close-1', direction: 'outbound', service: 'conversation_closed' };
function apply(conversation, event, stage = 'Qualificacao') {
  applyConversationLifecycle(conversation, event, stage);
  return conversation;
}

test('active attendance (AI or human) can be closed, but finalized cannot', () => {
  assert.equal(canCloseConversation(null), false);
  for (const status of ['finalizado', undefined, 'desconhecido']) {
    assert.equal(canCloseConversation({ status }), false);
  }
  assert.equal(canCloseConversation({ status: 'ia_ativa' }), true);
  assert.equal(canCloseConversation({ status: 'atendimento_humano' }), true);
  assert.equal(canCloseConversation({ status: 'atendimento_humano', stage: 'sales_human', ai_locked: true }), true);
});

test('closing persists final status and retains visible messages', () => {
  const conversation = { status: 'ia_ativa', messages: ['historico'] };
  apply(conversation, inbound);
  apply(conversation, close);
  assert.equal(conversation.status, 'finalizado');
  assert.equal(conversation.stage, 'Finalizado');
  assert.equal(conversation.closedEventId, 'close-1');
  assert.deepEqual(conversation.messages, ['historico']);
  assert.equal(canCloseConversation(conversation), false);
});

test('delayed AI, human and system outbounds do not reopen a closed attendance', () => {
  const conversation = apply({ status: 'ia_ativa' }, close);
  for (const sender_type of ['ai', 'agent', 'system']) {
    apply(conversation, { direction: 'outbound', sender_type, handoff: true });
    assert.equal(conversation.status, 'finalizado');
    assert.equal(conversation.stage, 'Finalizado');
  }
});

test('a new customer message reopens under AI and retains boundary', () => {
  const conversation = apply({ status: 'atendimento_humano' }, close);
  apply(conversation, { ...inbound, raw_payload: { conversation_session_id: 'close-1' } });
  assert.equal(conversation.status, 'ia_ativa');
  assert.equal(conversation.lastInboundId, 'in-1');
  assert.equal(conversation.closedEventId, 'close-1');
  assert.equal(canCloseConversation(conversation), true);
});

test('late events from an old session cannot reopen or change a new attendance', () => {
  for (const opened of [false, true]) {
    const conversation = apply({ status: 'ia_ativa' }, close);
    if (opened) apply(conversation, inbound);
    const expected = { ...conversation };
    for (const direction of ['inbound', 'outbound']) {
      apply(conversation, { direction, handoff: true, raw_payload: JSON.stringify({ conversation_session_id: 'initial' }) });
      assert.deepEqual(conversation, expected);
    }
  }
});

test('an inbound system record does not reopen attendance', () => {
  const conversation = apply({ status: 'ia_ativa' }, close);
  apply(conversation, { direction: 'inbound', sender_type: 'system' });
  assert.equal(conversation.status, 'finalizado');
});

test('legacy finalized stages are recognized even without service marker', () => {
  const conversation = apply({ status: 'ia_ativa' }, { id: 'legacy' }, 'Finalizado');
  assert.equal(conversation.closedEventId, 'legacy');
  assert.equal(conversation.status, 'finalizado');
});

test('pending successful close blocks duplicate submit on stale refresh', () => {
  const pending = { closedEventId: 'older', lastInboundId: 'in-1' };
  const conversation = { status: 'ia_ativa', ...pending };
  assert.equal(canCloseConversation(conversation, pending), false);
  conversation.lastInboundId = 'in-2';
  assert.equal(canCloseConversation(conversation, pending), false);
  conversation.closedEventId = 'close-1';
  assert.equal(canCloseConversation(conversation, pending), true);
  conversation.status = 'finalizado';
  assert.equal(canCloseConversation(conversation, pending), false);
});

test('close observed without a new inbound keeps the button blocked', () => {
  const pending = { lastInboundId: 'in-1' };
  assert.equal(canCloseConversation({ status: 'ia_ativa', closedEventId: 'close-1', lastInboundId: 'in-1' }, pending), false);
});

test('handoff keeps the close action available and closing finalizes attendance', () => {
  const conversation = apply({ status: 'ia_ativa' }, { ...inbound, handoff: true });
  assert.equal(conversation.status, 'atendimento_humano');
  assert.equal(canCloseConversation(conversation), true);

  apply(conversation, { ...inbound, id: 'in-2', handoff: false });
  assert.equal(conversation.status, 'atendimento_humano');
  assert.equal(canCloseConversation(conversation), true);

  apply(conversation, close);
  assert.equal(conversation.status, 'finalizado');
  assert.equal(canCloseConversation(conversation), false);

  apply(conversation, { ...inbound, id: 'in-3', handoff: false });
  assert.equal(conversation.status, 'ia_ativa');
  assert.equal(canCloseConversation(conversation), true);
});

test('ciclo completo: IA ativa -> humano assume -> operador envia mensagem -> encerrar -> nova sessao', () => {
  // 1. IA ativa -> Encerrar disponível
  const conversation = { status: 'ia_ativa' };
  assert.equal(canCloseConversation(conversation), true);

  // 2. Humano assume (handoff / sales_human / ai_locked) -> Encerrar continua disponível
  applyConversationLifecycle(conversation, { direction: 'inbound', handoff: true }, 'Atendimento humano');
  assert.equal(conversation.status, 'atendimento_humano');
  assert.equal(canCloseConversation(conversation), true);

  // 3. Operador envia mensagem (manual_reply / outbound) -> Encerrar continua disponível
  applyConversationLifecycle(conversation, { direction: 'outbound', sender_type: 'operator', service: 'manual_reply' }, 'Atendimento humano');
  assert.equal(conversation.status, 'atendimento_humano');
  assert.equal(canCloseConversation(conversation), true);

  // 4. Conversa encerrada -> Encerrar desabilitado
  applyConversationLifecycle(conversation, close, 'Finalizado');
  assert.equal(conversation.status, 'finalizado');
  assert.equal(canCloseConversation(conversation), false);

  // 5. Nova sessão posterior do cliente -> Encerrar volta a ficar disponível
  applyConversationLifecycle(conversation, { id: 'in-new', direction: 'inbound', raw_payload: { conversation_session_id: 'sess-nova-99' } }, 'Qualificacao');
  assert.equal(conversation.status, 'ia_ativa');
  assert.equal(canCloseConversation(conversation), true);
});
