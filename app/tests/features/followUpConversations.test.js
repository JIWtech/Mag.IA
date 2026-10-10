import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToConversations,
  applyIncomingEventToConversations,
  isConversationWaitingForFollowUp,
  formatWaitingDuration,
  matchesResponsibleFilter,
  sortConversationsForTab,
  getConversationTabCounts,
  formatConversationCardOrigin,
  formatMediaPreviewWithIcon,
} from '../../src/dataService.js';

function makeEvent({
  id = 'evt-1',
  tenant_slug = 'wesley_automoveis',
  channel_type = 'whatsapp',
  external_conversation_id = '551199999999@s.whatsapp.net',
  contact_name = 'Marcia',
  direction = 'inbound',
  sender_type = 'contact',
  service = 'general',
  stage = 'Em atendimento',
  message_text = 'Olá',
  created_at = '2026-10-06T10:00:00.000Z',
  raw_payload = {},
  handoff = false,
  sent_by_user = null,
} = {}) {
  return {
    id,
    tenant_id: 'tenant-123',
    tenant_slug,
    channel_type,
    external_conversation_id,
    contact_name,
    direction,
    sender_type,
    service,
    stage,
    message_text,
    created_at,
    raw_payload,
    handoff,
    sent_by_user,
  };
}

test('TEST A: último inbound 10:00, follow-up outbound 13:00 -> waitingForFollowUp = true', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T13:00:00.000Z', message_text: 'Ainda tem interesse no Honda?' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, true, 'Deve estar aguardando resposta de follow-up');
  assert.equal(conv.latestFollowUpAt, '2026-10-06T13:00:00.000Z');
  assert.equal(conv.latestCustomerInboundAt, '2026-10-06T10:00:00.000Z');
});

test('TEST B: follow-up 13:00, cliente responde 13:15 -> waitingForFollowUp = false', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T13:00:00.000Z', message_text: 'Ainda tem interesse?' }),
    makeEvent({ id: 'in-2', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T13:15:00.000Z', message_text: 'Sim, tenho!' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, false, 'Deve sair de follow-up após resposta do cliente');
  assert.equal(conv.latestCustomerInboundAt, '2026-10-06T13:15:00.000Z');
});

test('TEST C: sales_qualification outbound 13:00 -> waitingForFollowUp = false (não é follow-up)', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Quero comprar um carro' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'sales_qualification', created_at: '2026-10-06T13:00:00.000Z', message_text: 'Qual modelo você busca?' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, false, 'Mensagens normais da IA como sales_qualification não contam como follow-up');
  assert.equal(conv.latestFollowUpAt, null);
});

test('TEST D: follow-up antigo, cliente respondeu depois -> waitingForFollowUp = false', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T09:00:00.000Z', message_text: 'Bom dia' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Podemos continuar?' }),
    makeEvent({ id: 'in-2', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T12:00:00.000Z', message_text: 'Opa, podemos sim' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, false);
});

test('TEST E: cliente respondeu, novo follow-up depois -> waitingForFollowUp = true', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T09:00:00.000Z', message_text: 'Bom dia' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Podemos continuar?' }),
    makeEvent({ id: 'in-2', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T12:00:00.000Z', message_text: 'Opa, podemos sim' }),
    makeEvent({ id: 'out-2', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T15:00:00.000Z', message_text: 'Te enviei a proposta, conseguiu ver?' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, true, 'Novo follow-up posterior ao último inbound deve marcar waitingForFollowUp');
  assert.equal(conv.latestFollowUpAt, '2026-10-06T15:00:00.000Z');
  assert.equal(conv.latestCustomerInboundAt, '2026-10-06T12:00:00.000Z');
});

test('TEST F: múltiplos follow-ups sem resposta -> waitingForFollowUp = true', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T09:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T12:00:00.000Z', message_text: 'Follow-up 3h' }),
    makeEvent({ id: 'out-2', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T15:00:00.000Z', message_text: 'Follow-up 24h' }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, true);
  assert.equal(conv.latestFollowUpAt, '2026-10-06T15:00:00.000Z');
});

test('TEST G: system event posterior ao follow-up -> continua waitingForFollowUp = true', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T09:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T12:00:00.000Z', message_text: 'Ainda tem interesse?' }),
    makeEvent({
      id: 'sys-1',
      direction: 'internal',
      sender_type: 'system',
      service: 'conversation_assigned',
      created_at: '2026-10-06T13:00:00.000Z',
      message_text: 'Conversa atribuída',
    }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.waitingForFollowUp, true, 'Eventos de sistema não devem anular o estado de follow-up');
});

test('TEST H: conversation_closed -> não deve aparecer como follow-up ativo', () => {
  const events = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T09:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T12:00:00.000Z', message_text: 'Ainda quer o carro?' }),
    makeEvent({
      id: 'close-1',
      direction: 'outbound',
      sender_type: 'system',
      service: 'conversation_closed',
      stage: 'Finalizado',
      created_at: '2026-10-06T14:00:00.000Z',
      message_text: 'Atendimento finalizado',
    }),
  ];

  const [conv] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conv.status, 'finalizado');
  assert.equal(conv.waitingForFollowUp, false, 'Conversa finalizada não pode aparecer em follow-up ativo');
});

test('TEST I: Realtime inbound após follow-up -> conversation sai imediatamente de Follow-up', () => {
  const initialEvents = [
    makeEvent({ id: 'in-1', direction: 'inbound', sender_type: 'contact', created_at: '2026-10-06T10:00:00.000Z', message_text: 'Olá' }),
    makeEvent({ id: 'out-1', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', created_at: '2026-10-06T13:00:00.000Z', message_text: 'Podemos continuar?' }),
  ];

  const convs = eventsToConversations(initialEvents, 'wesley_automoveis');
  assert.equal(convs[0].waitingForFollowUp, true, 'Inicialmente em follow-up');

  const realtimeInbound = makeEvent({
    id: 'in-realtime',
    direction: 'inbound',
    sender_type: 'contact',
    created_at: '2026-10-06T13:30:00.000Z',
    message_text: 'Sim, me passe mais detalhes',
  });

  const updatedConvs = applyIncomingEventToConversations(convs, realtimeInbound, 'wesley_automoveis');
  assert.equal(updatedConvs.length, 1);
  assert.equal(updatedConvs[0].waitingForFollowUp, false, 'Realtime remove conversa de follow-up atomicamente');
  assert.equal(updatedConvs[0].unread, 1, 'Conversa que recebeu resposta ganha unread se não estava com markIncomingAsRead');
});

test('TEST J: filtro IA + Follow-up -> somente follow-ups cujo atendimento atual é IA', () => {
  const convAi = {
    id: 'conv-ai',
    contact: 'Cliente IA',
    status: 'ia_ativa',
    owner: 'Assistente IA',
    ownerKind: 'ai',
    waitingForFollowUp: true,
  };
  const convHumano = {
    id: 'conv-humano',
    contact: 'Cliente Humano',
    status: 'atendimento_humano',
    owner: 'Carlos',
    ownerKind: 'agent',
    waitingForFollowUp: true,
  };

  assert.equal(matchesResponsibleFilter(convAi, 'ia'), true);
  assert.equal(matchesResponsibleFilter(convHumano, 'ia'), false);

  const followUpConvs = [convAi, convHumano].filter((c) => c.waitingForFollowUp && matchesResponsibleFilter(c, 'ia'));
  assert.deepEqual(followUpConvs, [convAi]);
});

test('TEST K: filtro Humano + Ativas -> funciona normalmente', () => {
  const convAiActive = {
    id: 'conv-ai-active',
    status: 'ia_ativa',
    owner: 'Assistente IA',
    ownerKind: 'ai',
    waitingForFollowUp: false,
  };
  const convHumanoActive = {
    id: 'conv-humano-active',
    status: 'atendimento_humano',
    owner: 'Wesley',
    ownerKind: 'agent',
    waitingForFollowUp: false,
  };

  assert.equal(matchesResponsibleFilter(convAiActive, 'humano'), false);
  assert.equal(matchesResponsibleFilter(convHumanoActive, 'humano'), true);

  const activeHumanConvs = [convAiActive, convHumanoActive].filter((c) => !c.waitingForFollowUp && matchesResponsibleFilter(c, 'humano'));
  assert.deepEqual(activeHumanConvs, [convHumanoActive]);
});

test('TEST L: contadores de abas (Ativas, Não lidas, Follow-up) derivados dinamicamente', () => {
  const conversations = [
    { id: '1', status: 'ia_ativa', waitingForFollowUp: false, unread: 0 },
    { id: '2', status: 'ia_ativa', waitingForFollowUp: false, unread: 2 },
    { id: '3', status: 'ia_ativa', waitingForFollowUp: true, unread: 0 },
    { id: '4', status: 'atendimento_humano', waitingForFollowUp: true, unread: 0 },
    { id: '5', status: 'finalizado', waitingForFollowUp: false, unread: 1 },
  ];

  const counts = getConversationTabCounts(conversations);
  assert.equal(counts.ativas, 2, 'Ativas: 2 abertas que não estão em follow-up');
  assert.equal(counts.naoLidas, 1, 'Não lidas: apenas abertas com unread > 0 (id 2)');
  assert.equal(counts.followUp, 2, 'Follow-up: 2 aguardando cliente');
});

test('TEST M: ordenação de abas (Ativas por atividade, Follow-up por follow-up mais recente)', () => {
  const convA = { id: 'a', lastActivityAt: '2026-10-06T10:00:00.000Z', waitingSince: '2026-10-06T09:00:00.000Z' };
  const convB = { id: 'b', lastActivityAt: '2026-10-06T08:00:00.000Z', waitingSince: '2026-10-06T11:00:00.000Z' };

  const sortedAtivas = sortConversationsForTab([convA, convB], 'ativas');
  assert.equal(sortedAtivas[0].id, 'a', 'Ativas ordena pela atividade mais recente');

  const sortedFollowUp = sortConversationsForTab([convA, convB], 'follow_up');
  assert.equal(sortedFollowUp[0].id, 'b', 'Follow-up ordena pelo follow-up mais recente (waitingSince)');
});

test('TEST N: formatWaitingDuration produz textos discretos e corretos', () => {
  const now = Date.parse('2026-10-06T15:00:00.000Z');
  assert.equal(formatWaitingDuration(null, now), 'Aguardando cliente');
  assert.equal(formatWaitingDuration('2026-10-06T14:45:00.000Z', now), 'Aguardando cliente há 15m');
  assert.equal(formatWaitingDuration('2026-10-06T12:00:00.000Z', now), 'Aguardando cliente há 3h');
  assert.equal(formatWaitingDuration('2026-10-04T15:00:00.000Z', now), 'Aguardando cliente há 2d');
});

test('TEST O: formatMediaPreviewWithIcon formata áudio, imagem, localização e preserva texto', () => {
  assert.deepEqual(formatMediaPreviewWithIcon('Áudio'), { icon: '🎤', text: 'Áudio' });
  assert.deepEqual(formatMediaPreviewWithIcon('[audio]'), { icon: '🎤', text: 'Áudio' });
  assert.deepEqual(formatMediaPreviewWithIcon('Imagem'), { icon: '📷', text: 'Imagem' });
  assert.deepEqual(formatMediaPreviewWithIcon('Localização'), { icon: '📍', text: 'Localização' });
  assert.deepEqual(formatMediaPreviewWithIcon('Tudo bem?'), { icon: null, text: 'Tudo bem?' });
});

test('TEST P: formatConversationCardOrigin identifica Cliente, IA, Você e Follow-up', () => {
  assert.equal(formatConversationCardOrigin({ lastMessageSender: 'Cliente', lastMessageSenderType: 'contact' }), 'Cliente');
  assert.equal(formatConversationCardOrigin({ lastMessageSender: 'IA', lastMessageSenderType: 'ai' }), 'IA');
  assert.equal(formatConversationCardOrigin({ lastMessageSender: 'Wesley', lastMessageSenderType: 'agent' }), 'Wesley');
  assert.equal(formatConversationCardOrigin({ waitingForFollowUp: true, lastMessageSenderType: 'ai' }), 'Follow-up');
});
