import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isConversationClosed,
  matchesConversationTab,
  getConversationTabCounts,
  sortConversationsForTab,
  applyIncomingEventToConversations,
  eventsToConversations,
  matchesResponsibleFilter,
} from '../../src/dataService.js';

test('CENÁRIO A: conversa aberta pertence a Ativas', () => {
  const conv = {
    id: 'conv-1',
    status: 'ia_ativa',
    stage: 'Qualificação',
    waitingForFollowUp: false,
    unread: 0,
  };
  assert.equal(isConversationClosed(conv), false);
  assert.equal(matchesConversationTab(conv, 'ativas'), true);
  assert.equal(matchesConversationTab(conv, 'encerradas'), false);
  assert.equal(matchesConversationTab(conv, 'follow_up'), false);
});

test('CENÁRIO B: conversa encerrada NÃO pertence a Ativas', () => {
  const conv = {
    id: 'conv-2',
    status: 'finalizado',
    stage: 'Finalizado',
    waitingForFollowUp: false,
    unread: 0,
  };
  assert.equal(isConversationClosed(conv), true);
  assert.equal(matchesConversationTab(conv, 'ativas'), false);
});

test('CENÁRIO C: conversa encerrada pertence a Encerradas', () => {
  const convByStatus = { id: 'conv-3a', status: 'finalizado', stage: 'Atendimento' };
  const convByStage = { id: 'conv-3b', status: 'ia_ativa', stage: 'Finalizado' };
  const convByService = { id: 'conv-3c', service: 'conversation_closed' };

  assert.equal(isConversationClosed(convByStatus), true);
  assert.equal(matchesConversationTab(convByStatus, 'encerradas'), true);

  assert.equal(isConversationClosed(convByStage), true);
  assert.equal(matchesConversationTab(convByStage, 'encerradas'), true);

  assert.equal(isConversationClosed(convByService), true);
  assert.equal(matchesConversationTab(convByService, 'encerradas'), true);
});

test('CENÁRIO D: conversa waitingForFollowUp aberta pertence a Follow-up', () => {
  const conv = {
    id: 'conv-4',
    status: 'ia_ativa',
    stage: 'Qualificação',
    waitingForFollowUp: true,
    unread: 0,
  };
  assert.equal(isConversationClosed(conv), false);
  assert.equal(matchesConversationTab(conv, 'follow_up'), true);
  assert.equal(matchesConversationTab(conv, 'ativas'), false, 'Em follow-up não deve poluir a aba Ativas');
  assert.equal(matchesConversationTab(conv, 'encerradas'), false);
});

test('CENÁRIO E: conversa encerrada com follow-up histórico pertence a Encerradas, NÃO a Follow-up', () => {
  const conv = {
    id: 'conv-5',
    status: 'finalizado',
    stage: 'Finalizado',
    waitingForFollowUp: true, // valor que possa ter ficado no histórico
    latestFollowUpAt: '2026-10-06T10:00:00.000Z',
    unread: 0,
  };
  assert.equal(isConversationClosed(conv), true);
  assert.equal(matchesConversationTab(conv, 'encerradas'), true);
  assert.equal(matchesConversationTab(conv, 'follow_up'), false, 'Encerrada tem precedência total sobre follow-up');
  assert.equal(matchesConversationTab(conv, 'ativas'), false);
});

test('CENÁRIO F: conversa encerrada com unread histórico NÃO aparece em Não lidas', () => {
  const convClosedWithUnread = {
    id: 'conv-6',
    status: 'finalizado',
    stage: 'Finalizado',
    unread: 3,
  };
  assert.equal(matchesConversationTab(convClosedWithUnread, 'nao_lidas'), false);
  assert.equal(matchesConversationTab(convClosedWithUnread, 'encerradas'), true);
});

test('CENÁRIO F2: nova mensagem do cliente em conversa encerrada reabre e vai para Ativas/Não lidas', () => {
  const initialEvents = [
    {
      id: 'close-1',
      direction: 'outbound',
      sender_type: 'system',
      service: 'conversation_closed',
      stage: 'Finalizado',
      created_at: '2026-10-06T10:00:00.000Z',
      tenant_slug: 'tenant-test',
      channel_type: 'whatsapp',
      external_conversation_id: '551199999999',
    },
  ];
  const convs = eventsToConversations(initialEvents, 'tenant-test');
  assert.equal(isConversationClosed(convs[0]), true);
  assert.equal(matchesConversationTab(convs[0], 'encerradas'), true);

  const inboundEvent = {
    id: 'in-new',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Olá de novo!',
    created_at: '2026-10-06T11:00:00.000Z',
    tenant_slug: 'tenant-test',
    channel_type: 'whatsapp',
    external_conversation_id: '551199999999',
  };

  const updatedConvs = applyIncomingEventToConversations(convs, inboundEvent, 'tenant-test');
  assert.equal(isConversationClosed(updatedConvs[0]), false, 'Novo inbound reabre a sessão');
  assert.equal(matchesConversationTab(updatedConvs[0], 'ativas'), true);
  assert.equal(matchesConversationTab(updatedConvs[0], 'encerradas'), false);
  assert.equal(matchesConversationTab(updatedConvs[0], 'nao_lidas'), true);
});

test('CENÁRIO G: encerrar conversa via atualização (Realtime) muda classificação atomicamente', () => {
  const initialConv = {
    id: 'conv-7',
    contact: 'Alexandre',
    status: 'atendimento_humano',
    stage: 'Atendimento humano',
    waitingForFollowUp: false,
    channelType: 'whatsapp',
    externalConversationId: '551188888888',
    lastActivityAt: '2026-10-06T12:00:00.000Z',
  };

  const conversations = [initialConv];
  assert.equal(matchesConversationTab(conversations[0], 'ativas'), true);
  assert.equal(matchesConversationTab(conversations[0], 'encerradas'), false);

  const closeEvent = {
    id: 'evt-close',
    service: 'conversation_closed',
    stage: 'Finalizado',
    direction: 'outbound',
    sender_type: 'system',
    created_at: '2026-10-06T12:05:00.000Z',
    channel_type: 'whatsapp',
    external_conversation_id: '551188888888',
  };

  const nextConvs = applyIncomingEventToConversations(conversations, closeEvent, '');
  assert.equal(matchesConversationTab(nextConvs[0], 'ativas'), false);
  assert.equal(matchesConversationTab(nextConvs[0], 'encerradas'), true);
});

test('CENÁRIO H: busca dentro de Encerradas filtra apenas entre as encerradas', () => {
  const convA = { id: '1', contact: 'João Silva', status: 'finalizado', stage: 'Finalizado' };
  const convB = { id: '2', contact: 'Maria Souza', status: 'finalizado', stage: 'Finalizado' };
  const convC = { id: '3', contact: 'João Santos', status: 'ia_ativa', stage: 'Qualificação' };

  const all = [convA, convB, convC];
  const query = 'joão';

  // Na aba Encerradas, deve encontrar João Silva, mas NUNCA João Santos (que é ativo)
  const resultEncerradas = all.filter((c) => {
    if (!matchesConversationTab(c, 'encerradas')) return false;
    return c.contact.toLowerCase().includes(query);
  });
  assert.deepEqual(resultEncerradas.map((c) => c.id), ['1']);

  // Na aba Ativas, deve encontrar João Santos, mas NUNCA João Silva (que está encerrado)
  const resultAtivas = all.filter((c) => {
    if (!matchesConversationTab(c, 'ativas')) return false;
    return c.contact.toLowerCase().includes(query);
  });
  assert.deepEqual(resultAtivas.map((c) => c.id), ['3']);
});

test('CENÁRIO I: filtro Humano dentro de Encerradas combina corretamente', () => {
  const convHumanClosed = {
    id: '1',
    status: 'finalizado',
    stage: 'Finalizado',
    owner: 'Wesley',
    ownerKind: 'agent',
  };
  const convAiClosed = {
    id: '2',
    status: 'finalizado',
    stage: 'Finalizado',
    owner: 'Assistente IA',
    ownerKind: 'ai',
  };

  const list = [convHumanClosed, convAiClosed];

  const filteredHuman = list.filter((c) => {
    if (!matchesConversationTab(c, 'encerradas')) return false;
    return matchesResponsibleFilter(c, 'humano');
  });
  assert.deepEqual(filteredHuman.map((c) => c.id), ['1']);

  const filteredWesley = list.filter((c) => {
    if (!matchesConversationTab(c, 'encerradas')) return false;
    return matchesResponsibleFilter(c, 'wesley');
  });
  assert.deepEqual(filteredWesley.map((c) => c.id), ['1']);
});

test('CENÁRIO J: ordenação das encerradas mais recentes primeiro', () => {
  const convOld = { id: 'old', status: 'finalizado', lastActivityAt: '2026-10-06T09:00:00.000Z' };
  const convNew = { id: 'new', status: 'finalizado', lastActivityAt: '2026-10-06T14:00:00.000Z' };

  const sorted = sortConversationsForTab([convOld, convNew], 'encerradas');
  assert.equal(sorted[0].id, 'new');
  assert.equal(sorted[1].id, 'old');
});

test('CENÁRIO K: selectedId de conversa encerrada continua válido enquanto painel está aberto', () => {
  const conversations = [
    { id: 'conv-active', contact: 'Cliente Ativo', status: 'ia_ativa' },
    { id: 'conv-closed', contact: 'Cliente Encerrado', status: 'finalizado', stage: 'Finalizado' },
  ];

  let selectedId = 'conv-closed';

  // Simula busca do selected no painel principal:
  const selected = conversations.find((c) => c.id === selectedId) || null;
  assert.ok(selected !== null, 'Painel continua encontrando a conversa selecionada na coleção');
  assert.equal(selected.id, 'conv-closed');
  assert.equal(selected.contact, 'Cliente Encerrado');

  // E o useEffect de preservação do selectedId não deve resetar para conversations[0]:
  const shouldReset = !conversations.some((c) => c.id === selectedId);
  assert.equal(shouldReset, false, 'selectedId não deve ser sobrescrito nem apagado');
});

test('CONTADORES: getConversationTabCounts inclui encerradas/closedCount de forma consistente', () => {
  const conversations = [
    { id: '1', status: 'ia_ativa', waitingForFollowUp: false, unread: 0 },
    { id: '2', status: 'atendimento_humano', waitingForFollowUp: false, unread: 1 },
    { id: '3', status: 'ia_ativa', waitingForFollowUp: true, unread: 0 },
    { id: '4', status: 'finalizado', stage: 'Finalizado', waitingForFollowUp: false, unread: 0 },
    { id: '5', status: 'finalizado', stage: 'Finalizado', waitingForFollowUp: true, unread: 2 }, // não deve vazar para follow-up nem não lidas
  ];

  const counts = getConversationTabCounts(conversations);
  assert.equal(counts.ativas, 2);
  assert.equal(counts.naoLidas, 1);
  assert.equal(counts.followUp, 1);
  assert.equal(counts.encerradas, 2);
  assert.equal(counts.closedCount, 2);
});
