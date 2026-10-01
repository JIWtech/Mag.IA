import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToConversations,
  eventsToKanban,
  buildContactAvatarIndex,
  getConversationActivityEpoch,
  sortConversationsByRecentActivity,
  isEligibleForExternalOutbound,
  moveKanbanCard,
  normalizeAvatarUrl,
  validateKanbanOrderProposal,
} from './dataService.js';

function event(overrides = {}) {
  return {
    id: 'event-1',
    channel_type: 'whatsapp',
    external_conversation_id: 'chat-1',
    contact_name: 'Cliente',
    direction: 'inbound',
    stage: 'Qualificacao',
    created_at: '2026-09-28T10:00:00.000Z',
    raw_payload: {},
    ...overrides,
  };
}

function appointment(overrides = {}) {
  return {
    id: 'appointment-1',
    title: 'Avaliação',
    contactName: 'Cliente',
    when: '28/09, 15:00',
    startsAt: '2026-09-28T15:00:00.000Z',
    channelLabel: 'WhatsApp',
    channelType: 'whatsapp',
    externalConversationId: 'chat-1',
    status: 'scheduled',
    statusLabel: 'Agendado',
    raw: { updated_at: '2026-09-28T12:00:00.000Z' },
    ...overrides,
  };
}

function cardsFor(columns, conversationId = 'chat-1') {
  return columns.flatMap((column) => column.cards)
    .filter((card) => card.externalConversationId === conversationId);
}

test('normalizes WhatsApp and whatsapp into one Kanban conversation', () => {
  const cards = cardsFor(eventsToKanban([
    event({ id: 'older', channel_type: 'WhatsApp', created_at: '2026-09-28T10:00:00.000Z' }),
    event({ id: 'newer', channel_type: 'whatsapp', stage: 'Finalizada', created_at: '2026-09-28T11:00:00.000Z' }),
  ]));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'card-newer');
  assert.equal(cards[0].stage, 'Finalizado');
});

test('normalizes WHATSAPP and whatsapp into one Kanban conversation', () => {
  const cards = cardsFor(eventsToKanban([
    event({ id: 'older', channel_type: 'WHATSAPP', created_at: '2026-09-28T10:00:00.000Z' }),
    event({ id: 'newer', channel_type: 'whatsapp', created_at: '2026-09-28T11:00:00.000Z' }),
  ]));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'card-newer');
});

test('keeps a historical handoff in the human Kanban column after a later normalized-channel event', () => {
  const conversationId = '5524998770247@s.whatsapp.net';
  const columns = eventsToKanban([
    event({
      id: 'human-latest',
      channel_type: 'whatsapp',
      external_conversation_id: conversationId,
      stage: 'Atendimento humano',
      handoff: false,
      created_at: '2026-09-28T12:00:00.000Z',
    }),
    event({
      id: 'human-handoff',
      channel_type: 'WhatsApp',
      external_conversation_id: conversationId,
      stage: 'Atendimento humano',
      handoff: true,
      created_at: '2026-09-28T11:00:00.000Z',
    }),
    event({
      id: 'human-ia',
      channel_type: 'WHATSAPP',
      external_conversation_id: conversationId,
      stage: 'Conversas IA',
      handoff: false,
      created_at: '2026-09-28T10:00:00.000Z',
    }),
  ], 'clinica_nubia_oficial', [], {
    columns: [
      { id: 'conversas_ia', name: 'Conversas IA', position: 1 },
      { id: 'com_humano', name: 'Em atendimento humano', position: 2 },
    ],
  });

  const cards = cardsFor(columns, conversationId);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'card-human-latest');
  assert.equal(cards[0].targetColumnId, 'com_humano');
});

test('keeps only the newest event stage for one conversation', () => {
  const cards = cardsFor(eventsToKanban([
    event({ id: 'stage-a', stage: 'Qualificacao', created_at: '2026-09-28T10:00:00.000Z' }),
    event({ id: 'stage-b', stage: 'Finalizada', created_at: '2026-09-28T11:00:00.000Z' }),
  ]));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'card-stage-b');
  assert.equal(cards[0].stage, 'Finalizado');
});

test('keeps a manually moved conversation only in its persisted target stage', () => {
  const columns = eventsToKanban([
    event({
      id: 'manual-move',
      raw_payload: { kanban_transition: { to_column: 'produtos_apresentados' } },
    }),
  ], 'loja', [], {
    columns: [
      { id: 'conversas_ia', name: 'Conversas IA', position: 1 },
      { id: 'produtos_apresentados', name: 'Produtos apresentados', position: 2 },
    ],
  });

  const cards = cardsFor(columns);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].targetColumnId, 'produtos_apresentados');
});

test('preserves the stable assignee ID and owner kind on human Kanban cards', () => {
  const cards = cardsFor(eventsToKanban([
    event({
      id: 'assigned-card',
      raw_payload: { assignee: { id: 'agent-a', name: 'Ana' } },
      service: 'conversation_assigned',
    }),
  ]));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Ana');
  assert.equal(cards[0].ownerId, 'agent-a');
  assert.equal(cards[0].ownerKind, 'agent');
});

test('merges a newer appointment into its conversation instead of rendering a duplicate card', () => {
  const cards = cardsFor(eventsToKanban(
    [event({ id: 'event-before-appointment', created_at: '2026-09-28T10:00:00.000Z' })],
    'loja',
    [appointment()],
  ));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'appointment-appointment-1');
  assert.equal(cards[0].targetColumnId, 'agendamentos');
  assert.equal(cards[0].appointmentStatus, 'scheduled');
  assert.equal(cards[0].title, 'Cliente');
});

test('does not merge conversations from different normalized channels', () => {
  const cards = cardsFor(eventsToKanban([
    event({ id: 'whatsapp-event', channel_type: 'whatsapp' }),
    event({ id: 'telegram-event', channel_type: 'telegram' }),
  ]));

  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.channelType).sort(), ['telegram', 'whatsapp']);
});

test('materializes customer, AI, and agent messages in the conversation timeline', () => {
  const conversations = eventsToConversations([
    event({ id: 'customer', direction: 'inbound', message_text: 'Olá' }),
    event({ id: 'ai', direction: 'outbound', sender_type: 'assistant', message_text: 'Como posso ajudar?' }),
    event({ id: 'agent', direction: 'outbound', sender_type: 'agent', message_text: 'Vou verificar para você.' }),
  ]);

  assert.equal(conversations.length, 1);
  assert.deepEqual(
    conversations[0].messages.map((message) => message.text).sort(),
    ['Como posso ajudar?', 'Olá', 'Vou verificar para você.'].sort(),
  );
});

test('keeps internal Kanban stage changes out of conversation messages and outbound eligibility', () => {
  const internalEvent = event({
    id: 'kanban-internal',
    direction: 'internal',
    sender_type: 'system',
    message_text: '[Kanban] Etapa alterada para: Qualificacao',
    raw_payload: {
      event_type: 'kanban_stage_changed',
      event_category: 'kanban',
      is_internal: true,
    },
  });

  assert.equal(eventsToConversations([internalEvent]).length, 0);
  assert.equal(isEligibleForExternalOutbound(internalEvent), false);
});

test('creates one internal audit event for a real Kanban stage transition', async () => {
  const events = await moveKanbanCard('loja', {
    id: 'card-1',
    externalConversationId: 'chat-1',
    channelType: 'whatsapp',
    targetColumnId: 'conversas_ia',
    stage: 'Qualificacao',
  }, 'aguardando_humano');

  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 'internal');
  assert.equal(events[0].raw_payload.event_type, 'kanban_stage_changed');
  assert.equal(events[0].raw_payload.is_internal, true);
});

test('does not create an audit event when the Kanban target is already the current stage', async () => {
  const events = await moveKanbanCard('loja', {
    id: 'card-1',
    externalConversationId: 'chat-1',
    channelType: 'whatsapp',
    targetColumnId: 'aguardando_humano',
    stage: 'Atendimento humano',
  }, 'aguardando_humano');

  assert.deepEqual(events, []);
});

test('normalizes a persisted contact avatar URL for the frontend', () => {
  const avatars = buildContactAvatarIndex([{
    tenant_id: 'tenant-a',
    source_channel: 'whatsapp',
    external_handle: '5511999999999@s.whatsapp.net',
    avatar_url: 'https://cdn.example/avatar.jpg',
  }], 'tenant-a');

  assert.equal(avatars.get('whatsapp:5511999999999@s.whatsapp.net'), 'https://cdn.example/avatar.jpg');
  assert.equal(normalizeAvatarUrl('http://unsafe.example/avatar.jpg'), null);
  assert.equal(normalizeAvatarUrl(null), null);
});

test('never indexes an avatar belonging to another tenant', () => {
  const avatars = buildContactAvatarIndex([
    { tenant_id: 'tenant-a', source_channel: 'whatsapp', external_handle: 'same@s.whatsapp.net', avatar_url: 'https://a.example/avatar.jpg' },
    { tenant_id: 'tenant-b', source_channel: 'whatsapp', external_handle: 'same@s.whatsapp.net', avatar_url: 'https://b.example/avatar.jpg' },
  ], 'tenant-a');

  assert.equal(avatars.get('whatsapp:same@s.whatsapp.net'), 'https://a.example/avatar.jpg');
});

test('a missing or invalid avatar keeps the initials fallback available', () => {
  const avatars = buildContactAvatarIndex([{
    tenant_id: 'tenant-a', source_channel: 'whatsapp', external_handle: 'chat-1', avatar_url: null,
  }], 'tenant-a');

  assert.equal(avatars.has('whatsapp:chat-1'), false);
});

test('accepts only a permutation of the existing Kanban automation keys', () => {
  const columns = [
    { automationKey: 'conversas_ia' },
    { automationKey: 'aguardando_humano' },
    { automationKey: 'agendamentos' },
  ];
  const proposal = validateKanbanOrderProposal(columns, {
    orderedAutomationKeys: ['agendamentos', 'conversas_ia', 'aguardando_humano'],
    reasoning: 'Fluxo operacional antes da agenda.',
  });

  assert.equal(proposal.valid, true);
  assert.deepEqual(proposal.orderedAutomationKeys, ['agendamentos', 'conversas_ia', 'aguardando_humano']);
});

test('rejects Kanban proposals that add, remove, or duplicate columns', () => {
  const columns = [{ automationKey: 'conversas_ia' }, { automationKey: 'agendamentos' }];
  for (const orderedAutomationKeys of [
    ['conversas_ia'],
    ['conversas_ia', 'agendamentos', 'unknown'],
    ['conversas_ia', 'conversas_ia'],
  ]) {
    assert.equal(validateKanbanOrderProposal(columns, { orderedAutomationKeys }).valid, false);
  }
});

test('sorts conversations by lastActivityAt descending (C -> B -> A)', () => {
  const events = [
    event({
      id: 'msg-a',
      external_conversation_id: 'chat-a',
      contact_name: 'Janete Maria Da Silva',
      created_at: '2026-09-30T17:31:00.000Z',
      message_text: 'Mensagem A',
    }),
    event({
      id: 'msg-b',
      external_conversation_id: 'chat-b',
      contact_name: 'negra rara',
      created_at: '2026-09-30T18:04:00.000Z',
      message_text: 'Mensagem B',
    }),
    event({
      id: 'msg-c',
      external_conversation_id: 'chat-c',
      contact_name: 'Elizabeth',
      created_at: '2026-09-30T20:26:00.000Z',
      message_text: 'Mensagem C',
    }),
  ];

  const conversations = eventsToConversations(events);
  assert.equal(conversations.length, 3);
  assert.deepEqual(
    conversations.map((c) => c.externalConversationId),
    ['chat-c', 'chat-b', 'chat-a'],
  );
  assert.equal(conversations[0].contact, 'Elizabeth');
  assert.equal(conversations[1].contact, 'negra rara');
  assert.equal(conversations[2].contact, 'Janete Maria Da Silva');
  assert.equal(conversations[0].lastActivityAt, '2026-09-30T20:26:00.000Z');
  assert.equal(conversations[1].lastActivityAt, '2026-09-30T18:04:00.000Z');
  assert.equal(conversations[2].lastActivityAt, '2026-09-30T17:31:00.000Z');
});

test('realtime: reorders existing conversation to top when a new message arrives', () => {
  const initialEvents = [
    event({
      id: 'msg-a-1',
      external_conversation_id: 'chat-a',
      contact_name: 'Conversa A',
      created_at: '2026-09-30T17:00:00.000Z',
      message_text: 'Primeira de A',
    }),
    event({
      id: 'msg-b-1',
      external_conversation_id: 'chat-b',
      contact_name: 'Conversa B',
      created_at: '2026-09-30T18:00:00.000Z',
      message_text: 'Primeira de B',
    }),
  ];

  const initialConversations = eventsToConversations(initialEvents);
  assert.deepEqual(
    initialConversations.map((c) => c.externalConversationId),
    ['chat-b', 'chat-a'],
  );

  // Chega nova mensagem para a Conversa A às 19:00
  const updatedEvents = [
    ...initialEvents,
    event({
      id: 'msg-a-2',
      external_conversation_id: 'chat-a',
      contact_name: 'Conversa A',
      created_at: '2026-09-30T19:00:00.000Z',
      message_text: 'Nova mensagem de A',
    }),
  ];

  const updatedConversations = eventsToConversations(updatedEvents);
  assert.deepEqual(
    updatedConversations.map((c) => c.externalConversationId),
    ['chat-a', 'chat-b'],
  );
  assert.equal(updatedConversations[0].lastActivityAt, '2026-09-30T19:00:00.000Z');
  assert.equal(updatedConversations[0].lastMessage, 'Nova mensagem de A');
});

test('multiple events per conversation use only the most recent timestamp to determine position', () => {
  const events = [
    // Conversa A com múltiplos eventos antigos e mais recente às 17:31
    event({ id: 'a1', external_conversation_id: 'chat-a', created_at: '2026-09-30T08:00:00.000Z', message_text: 'A 08:00' }),
    event({ id: 'a2', external_conversation_id: 'chat-a', created_at: '2026-09-30T12:00:00.000Z', message_text: 'A 12:00' }),
    event({ id: 'a3', external_conversation_id: 'chat-a', created_at: '2026-09-30T17:31:00.000Z', message_text: 'A 17:31' }),
    // Conversa B com evento às 18:04
    event({ id: 'b1', external_conversation_id: 'chat-b', created_at: '2026-09-30T15:00:00.000Z', message_text: 'B 15:00' }),
    event({ id: 'b2', external_conversation_id: 'chat-b', created_at: '2026-09-30T18:04:00.000Z', message_text: 'B 18:04' }),
    // Conversa C com evento único às 20:26
    event({ id: 'c1', external_conversation_id: 'chat-c', created_at: '2026-09-30T20:26:00.000Z', message_text: 'C 20:26' }),
  ];

  const conversations = eventsToConversations(events);
  assert.deepEqual(
    conversations.map((c) => c.externalConversationId),
    ['chat-c', 'chat-b', 'chat-a'],
  );
  assert.equal(conversations[0].messages.length, 1);
  assert.equal(conversations[1].messages.length, 2);
  assert.equal(conversations[2].messages.length, 3);
});

test('internal operational events do not update lastActivityAt or reorder conversations', () => {
  const events = [
    event({ id: 'a1', external_conversation_id: 'chat-a', created_at: '2026-09-30T17:31:00.000Z', message_text: 'A 17:31' }),
    event({ id: 'b1', external_conversation_id: 'chat-b', created_at: '2026-09-30T18:04:00.000Z', message_text: 'B 18:04' }),
    event({
      id: 'a-internal',
      external_conversation_id: 'chat-a',
      created_at: '2026-09-30T19:00:00.000Z',
      direction: 'internal',
      sender_type: 'system',
      message_text: '[Kanban] Etapa alterada',
      raw_payload: { event_type: 'kanban_stage_changed', is_internal: true },
    }),
  ];

  const conversations = eventsToConversations(events);
  assert.deepEqual(
    conversations.map((c) => c.externalConversationId),
    ['chat-b', 'chat-a'],
  );
  assert.equal(conversations[1].lastActivityAt, '2026-09-30T17:31:00.000Z');
});

test('sortConversationsByRecentActivity sorts objects by real temporal value descending', () => {
  const list = [
    { id: '1', contact: 'Janete', lastActivityAt: '2026-09-30T17:31:00.000Z' },
    { id: '2', contact: 'negra rara', lastActivityAt: '2026-09-30T18:04:00.000Z' },
    { id: '3', contact: 'Elizabeth', lastActivityAt: '2026-09-30T20:26:00.000Z' },
    { id: '4', contact: 'Iudy', lastActivityAt: '2026-10-01T08:40:00.000Z' },
  ];

  const sorted = sortConversationsByRecentActivity(list);
  assert.deepEqual(
    sorted.map((c) => c.contact),
    ['Iudy', 'Elizabeth', 'negra rara', 'Janete'],
  );
});
