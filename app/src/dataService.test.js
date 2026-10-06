import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStageLabel,
  normalizeStage,
  GENESIS_SALES_STAGE_DEFAULT_NAMES,
  eventsToConversations,
  eventsToKanban,
  buildContactAvatarIndex,
  buildContactDirectory,
  buildGenesisSalesMovePayload,
  getConversationActivityEpoch,
  sortConversationsByRecentActivity,
  isEligibleForExternalOutbound,
  moveKanbanCard,
  normalizeAvatarUrl,
  orderKanbanColumnsForTenant,
  resolveTenantKanbanStage,
  sortKanbanCardsByConversationActivity,
  validateKanbanOrderProposal,
  applyIncomingEventToConversations,
  applyIncomingEventToKanban,
  applyConversationReadState,
  canonicalConversationKey,
  conversationReadKey,
  getLatestReadableEvent,
  isUnreadInboundEvent,
  normalizeExternalConversationId,
  shouldAdvanceConversationRead,
  upsertConversationReadMarker,
  applyContactAvatars,
  applyContactDirectory,
  applyContactUpdateToConversations,
  formatWhatsAppPhone,
  isUsefulContactName,
  extractPayloadAvatar,
  extractAvatarUrlFromEvent,
  resolveContactAvatarState,
  cleanAgentName,
  resolveConversationOwner,
  resolveConversationOwnerDetails,
  resolveSalesControlMode,
  resolveConversationHeaderOwner,
  shouldRefreshConversationState,
  createDebouncedRealtimeRefresh,
  resolveMessageSender,
  resolveEventMessagePreview,
} from './dataService.js';

function event(overrides = {}) {
  return {
    id: 'event-1',
    channel_type: 'whatsapp',
    external_conversation_id: 'chat-1',
    contact_name: 'Cliente',
    direction: 'inbound',
    sender_type: 'contact',
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

const genesisColumns = {
  columns: [
    { id: 'sales_new', name: 'Patio - Novos contatos', position: 1, automation_key: 'sales_new' },
    { id: 'sales_qualifying', name: 'IA - Qualificacao automotiva', position: 2, automation_key: 'sales_qualifying' },
    { id: 'sales_hot', name: 'Leads quentes - Venda', position: 3, automation_key: 'sales_hot' },
    { id: 'sales_human', name: 'Atendimento humano', position: 7, automation_key: 'sales_human' },
    { id: 'sales_appraisal', name: 'Avaliacao de retoma - Compra', position: 4, automation_key: 'sales_appraisal' },
    { id: 'sales_financing', name: 'Fila de financiamento', position: 5, automation_key: 'sales_financing' },
    { id: 'sales_closed', name: 'Negocio fechado', position: 8, automation_key: 'sales_closed' },
    { id: 'sales_after_sales', name: 'Pos-venda - Manutencao', position: 6, automation_key: 'sales_after_sales' },
  ],
};

function genesisLead(stageKey, overrides = {}) {
  return {
    id: `lead-${stageKey}`,
    channel_type: 'whatsapp',
    chat_id: 'chat-1',
    stage_key: stageKey,
    revision: 6,
    ai_locked: false,
    hot: false,
    interest_registered: false,
    state: { intent: 'buy' },
    updated_at: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
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

test('excludes only the known Test kanban move artifact from Kanban cards', () => {
  const columns = eventsToKanban([
    event({
      id: 'known-test-artifact',
      external_conversation_id: 'test-artifact-chat',
      contact_name: 'Test',
      message_text: 'Test kanban move',
    }),
    event({
      id: 'legitimate-test-contact',
      external_conversation_id: 'legitimate-test-chat',
      contact_name: 'Test',
      message_text: 'Olá, preciso de ajuda com meu pedido.',
    }),
  ]);

  const cards = columns.flatMap((column) => column.cards);
  assert.equal(cards.some((card) => card.externalConversationId === 'test-artifact-chat'), false);
  assert.equal(cards.some((card) => card.externalConversationId === 'legitimate-test-chat'), true);
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
  assert.equal(cards[0].aiReason, '');
});

test('does not render an AI badge when an AI response immediately hands the conversation to a human', () => {
  const cards = cardsFor(eventsToKanban([
    event({
      id: 'ai-response-with-handoff',
      stage: 'Qualificacao',
      handoff: true,
      response_text: 'Vou encaminhar para a equipe continuar com você.',
      created_at: '2026-09-28T12:00:00.000Z',
    }),
  ], 'loja', [], {
    columns: [
      { id: 'conversas_ia', name: 'Conversas IA', position: 1 },
      { id: 'com_humano', name: 'Em atendimento humano', position: 2 },
    ],
  }));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].targetColumnId, 'com_humano');
  assert.equal(cards[0].aiReason, '');
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

test('routes Genesis commercial leads by the persisted sales_leads stage_key', () => {
  for (const stageKey of [
    'sales_new',
    'sales_qualifying',
    'sales_hot',
    'sales_human',
    'sales_appraisal',
    'sales_financing',
    'sales_after_sales',
    'sales_closed',
  ]) {
    const cards = cardsFor(eventsToKanban(
      [event({ stage: 'Finalizada', service: 'conversation_closed' })],
      'wesley_automoveis', [], genesisColumns, [], [genesisLead(stageKey)],
    ));
    assert.equal(cards.length, 1, stageKey);
    assert.equal(cards[0].targetColumnId, stageKey, stageKey);
    assert.equal(cards[0].salesLeadId, `lead-${stageKey}`, stageKey);
    assert.equal(cards[0].salesRevision, 6, stageKey);
  }
});

test('keeps Genesis human leads in sales_human even when the latest conversation is closed', () => {
  const cards = cardsFor(eventsToKanban(
    [event({ stage: 'Finalizada', service: 'conversation_closed', handoff: false })],
    'wesley_automoveis', [], genesisColumns, [], [genesisLead('sales_human', { ai_locked: true })],
  ));

  assert.equal(cards[0].targetColumnId, 'sales_human');
});

test('keeps the latest known contact name when a newer Genesis operational event has no name', () => {
  const cards = cardsFor(eventsToKanban(
    [
      event({
        id: 'ian-message',
        contact_name: 'Ian',
        message_text: 'Quero saber sobre o veículo.',
        created_at: '2026-09-28T10:00:00.000Z',
      }),
      event({
        id: 'handoff-operation',
        contact_name: null,
        message_text: 'Etapa comercial alterada.',
        service: 'conversation_assigned',
        direction: 'outbound',
        created_at: '2026-09-28T11:00:00.000Z',
      }),
    ],
    'wesley_automoveis', [], genesisColumns, [], [genesisLead('sales_human', { ai_locked: true })],
  ));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'card-handoff-operation');
  assert.equal(cards[0].title, 'Ian');
  assert.equal(cards[0].subtitle, 'Quero saber sobre o veículo.');
  assert.equal(cards[0].lastActivityAt, '2026-09-28T10:00:00.000Z');
  assert.equal(cards[0].targetColumnId, 'sales_human');
});

test('does not let Genesis operational events change card activity order, but a new message does', () => {
  const baseEvents = [
    event({ id: 'a-message', external_conversation_id: 'chat-a', contact_name: 'A', created_at: '2026-09-28T10:00:00.000Z' }),
    event({ id: 'b-message', external_conversation_id: 'chat-b', contact_name: 'B', created_at: '2026-09-28T10:30:00.000Z' }),
    event({
      id: 'a-resume-ai',
      external_conversation_id: 'chat-a',
      contact_name: null,
      service: 'resume_ai',
      direction: 'outbound',
      created_at: '2026-09-28T11:00:00.000Z',
    }),
  ];
  const leads = [
    genesisLead('sales_qualifying', { id: 'lead-a', chat_id: 'chat-a' }),
    genesisLead('sales_qualifying', { id: 'lead-b', chat_id: 'chat-b' }),
  ];

  const initial = eventsToKanban(baseEvents, 'wesley_automoveis', [], genesisColumns, [], leads);
  const initialCards = initial.find((column) => column.automationKey === 'sales_qualifying').cards;
  assert.deepEqual(initialCards.map((card) => card.externalConversationId), ['chat-b', 'chat-a']);
  assert.equal(initialCards[1].lastActivityAt, '2026-09-28T10:00:00.000Z');

  const updated = eventsToKanban([
    ...baseEvents,
    event({ id: 'a-new-message', external_conversation_id: 'chat-a', contact_name: 'A', created_at: '2026-09-28T11:30:00.000Z' }),
  ], 'wesley_automoveis', [], genesisColumns, [], leads);
  const updatedCards = updated.find((column) => column.automationKey === 'sales_qualifying').cards;
  assert.deepEqual(updatedCards.map((card) => card.externalConversationId), ['chat-a', 'chat-b']);
  assert.equal(updatedCards[0].lastActivityAt, '2026-09-28T11:30:00.000Z');
});

test('falls back to the channel contact label only when the conversation has no name', () => {
  const cards = cardsFor(eventsToKanban([
    event({ id: 'unnamed-message', contact_name: null, message_text: 'Olá', created_at: '2026-09-28T10:00:00.000Z' }),
    event({ id: 'unnamed-operation', contact_name: null, service: 'conversation_assigned', direction: 'outbound', created_at: '2026-09-28T11:00:00.000Z' }),
  ], 'outro_tenant'));

  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Contato WhatsApp');
});

test('sorts optimistic Kanban cards by their preserved conversation activity', () => {
  const cards = sortKanbanCardsByConversationActivity([
    { id: 'older', lastActivityAt: '2026-09-28T10:00:00.000Z' },
    { id: 'newer', lastActivityAt: '2026-09-28T11:00:00.000Z' },
  ]);

  assert.deepEqual(cards.map((card) => card.id), ['newer', 'older']);
});

test('does not turn a Genesis conversation_closed event into sales_closed without a commercial lead stage', () => {
  const cards = cardsFor(eventsToKanban(
    [event({ stage: 'Finalizada', service: 'conversation_closed' })],
    'wesley_automoveis', [], genesisColumns,
  ));

  assert.equal(cards[0].targetColumnId, 'sales_new');
});

test('uses Genesis lead intent only as a fallback when no commercial stage is persisted', () => {
  const resolved = resolveTenantKanbanStage({
    tenantSlug: 'wesley_automoveis',
    salesLead: genesisLead('', { state: { intent: 'sell' }, stage_key: '' }),
    event: event({ stage: 'Qualificacao' }),
    conversationState: { status: 'ia_ativa' },
    context: { isFirstContact: false, direction: 'inbound' },
  });
  assert.deepEqual(resolved, ['sales_appraisal']);
});

test('keeps the configured order for other tenants and applies Genesis operational order to columns and navigation', () => {
  const columns = genesisColumns.columns.map((column) => ({ ...column }));
  assert.deepEqual(
    orderKanbanColumnsForTenant(columns, 'wesley_automoveis').map((column) => column.automation_key),
    ['sales_new', 'sales_qualifying', 'sales_hot', 'sales_human', 'sales_appraisal', 'sales_financing', 'sales_closed', 'sales_after_sales'],
  );
  assert.deepEqual(
    orderKanbanColumnsForTenant(columns, 'outro_tenant').map((column) => column.automation_key),
    ['sales_new', 'sales_qualifying', 'sales_hot', 'sales_appraisal', 'sales_financing', 'sales_after_sales', 'sales_human', 'sales_closed'],
  );
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

test('contact presence defaults to null when no real presence provider exists', () => {
  const conversations = eventsToConversations([
    event({ id: 'msg-1', direction: 'inbound', message_text: 'Olá' }),
  ]);
  assert.equal(conversations.length, 1);
  assert.strictEqual(conversations[0].presence, null);
});

test('materializes human operator messages sent from WhatsApp (fromMe) in conversation timeline', () => {
  const conversations = eventsToConversations([
    event({ id: 'customer', direction: 'inbound', message_text: 'Olá, preciso de um orçamento' }),
    event({ id: 'ai', direction: 'outbound', sender_type: 'assistant', message_text: 'Um especialista já vai te responder.' }),
    event({
      id: 'operator-fromme',
      direction: 'outbound',
      sender_type: 'agent',
      message_text: 'Olá! Sou o atendente humano e estou respondendo diretamente pelo WhatsApp.',
      sent_by_user: 'Operador WhatsApp',
      raw_payload: {
        fromMe: true,
        key: { fromMe: true, id: 'WA_MSG_12345' },
        source: 'whatsapp_from_me',
      },
    }),
  ]);

  assert.equal(conversations.length, 1);
  const conv = conversations[0];
  assert.equal(conv.messages.length, 3);
  const opMessage = conv.messages.find((m) => m.text.includes('respondendo diretamente pelo WhatsApp'));
  assert.ok(opMessage, 'Mensagem do operador enviada via WhatsApp (fromMe) deve estar na conversa');
  assert.equal(opMessage.from, 'agent');
  assert.equal(opMessage.sent_by, 'Operador WhatsApp');
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

test('records Genesis drag and drop with the exact sales stage key', async () => {
  const card = {
    id: 'card-1',
    externalConversationId: 'chat-1',
    channelType: 'whatsapp',
    targetColumnId: 'sales_new',
    salesStageKey: 'sales_new',
    salesLeadId: 'lead-1',
    owner: 'Ana',
    ownerKind: 'agent',
    ownerId: 'agent-1',
  };

  for (const target of ['sales_human', 'sales_financing']) {
    const events = await moveKanbanCard('wesley_automoveis', card, target, null, { automationKey: target, title: target });
    assert.equal(events.length, 1);
    assert.equal(events[0].raw_payload.kanban_transition.to_column, target);
    assert.equal(events[0].service, 'sales_stage_changed');
  }
});

test('builds the existing sales move RPC payload from the lead revision and target automation key', () => {
  assert.deepEqual(
    buildGenesisSalesMovePayload('97448963-99d7-44f8-a719-1fba6bc9858e', 'sales_qualifying', 6),
    {
      p_lead: '97448963-99d7-44f8-a719-1fba6bc9858e',
      p_stage: 'sales_qualifying',
      p_revision: 6,
    },
  );
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

test('contact directory gives canonical contact name priority over an inbound placeholder', () => {
  const directory = buildContactDirectory([{
    id: 'contact-guilherme', tenant_id: 'tenant-a', source_channel: 'whatsapp',
    external_handle: '5521992988071@s.whatsapp.net', name: 'Guilherme Santos', avatar_url: null,
  }], 'tenant-a');
  const [enriched] = applyContactDirectory([event({
    tenant_slug: 'tenant-a', channel_type: 'whatsapp', external_conversation_id: '5521992988071@s.whatsapp.net',
    contact_name: '.', created_at: '2026-10-01T10:00:00.000Z',
  })], directory, 'tenant-a');
  const [conversation] = eventsToConversations([enriched], 'tenant-a');
  assert.equal(conversation.contact, 'Guilherme Santos');
});

test('emoji display names are useful while punctuation and telephone fallbacks are formatted', () => {
  assert.equal(isUsefulContactName('🧋', '5521992988071'), true);
  assert.equal(isUsefulContactName('.', '5521992988071'), false);
  assert.equal(isUsefulContactName('5521992988071', '5521992988071'), false);
  assert.equal(formatWhatsAppPhone('5521992988071'), '+55 (21) 99298-8071');
  const [emoji] = eventsToConversations([event({ contact_name: '🧋', external_conversation_id: '5521992988071@s.whatsapp.net' })], 'tenant-a');
  const [phone] = eventsToConversations([event({ contact_name: '.', external_conversation_id: '5521992988071@s.whatsapp.net' })], 'tenant-a');
  assert.equal(emoji.contact, '🧋');
  assert.equal(phone.contact, '+55 (21) 99298-8071');
});

test('contact realtime update changes canonical name and avatar without reloading conversations', () => {
  const [initial] = eventsToConversations([event({
    tenant_slug: 'tenant-a', channel_type: 'whatsapp', external_conversation_id: '5521992988071@s.whatsapp.net', contact_name: '.',
  })], 'tenant-a');
  const [updated] = applyContactUpdateToConversations([initial], {
    tenant_id: 'tenant-a', source_channel: 'whatsapp', external_handle: '5521992988071@s.whatsapp.net',
    name: 'Raphael do Civic', avatar_url: 'https://cdn.example/raphael.jpg',
  }, 'tenant-a');
  assert.equal(updated.contact, 'Raphael do Civic');
  assert.equal(updated.avatarUrl, 'https://cdn.example/raphael.jpg');
});

test('TEST A: contact com avatar_url https valida resulta em conversation.avatarUrl correto', () => {
  const contacts = [{
    tenant_id: 'tenant-a',
    source_channel: 'whatsapp',
    external_handle: '5521983622313@s.whatsapp.net',
    avatar_url: 'https://cdn.example.com/avatars/valid-photo.jpg',
  }];
  const avatarIndex = buildContactAvatarIndex(contacts, 'tenant-a');
  const events = [
    event({
      tenant_slug: 'tenant-a',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_handle: '5521983622313@s.whatsapp.net',
      created_at: '2026-09-30T10:00:00.000Z',
    }),
  ];
  const eventsWithAvatars = applyContactAvatars(events, avatarIndex, 'tenant-a');
  const [conv] = eventsToConversations(eventsWithAvatars, 'tenant-a');

  assert.ok(conv);
  assert.equal(conv.avatarUrl, 'https://cdn.example.com/avatars/valid-photo.jpg');
});

test('TEST B: contact com avatar_url = null resulta em fallback sem erro (avatarUrl = null)', () => {
  const contacts = [{
    tenant_id: 'tenant-a',
    source_channel: 'whatsapp',
    external_handle: '5521983622313@s.whatsapp.net',
    avatar_url: null,
  }];
  const avatarIndex = buildContactAvatarIndex(contacts, 'tenant-a');
  const events = [
    event({
      tenant_slug: 'tenant-a',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_handle: '5521983622313@s.whatsapp.net',
      created_at: '2026-09-30T10:00:00.000Z',
    }),
  ];
  const eventsWithAvatars = applyContactAvatars(events, avatarIndex, 'tenant-a');
  const [conv] = eventsToConversations(eventsWithAvatars, 'tenant-a');

  assert.ok(conv);
  assert.equal(conv.avatarUrl, null);
});

test('TEST C: avatar_url invalida (http, javascript, data, blob, malformada) e ignorada', () => {
  assert.equal(normalizeAvatarUrl('http://insecure.example.com/avatar.jpg'), null);
  assert.equal(normalizeAvatarUrl('javascript:alert(1)'), null);
  assert.equal(normalizeAvatarUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='), null);
  assert.equal(normalizeAvatarUrl('blob:https://example.com/1234-5678'), null);
  assert.equal(normalizeAvatarUrl('https://'), null);
  assert.equal(normalizeAvatarUrl('not-a-url'), null);
  assert.equal(normalizeAvatarUrl(''), null);
  assert.equal(normalizeAvatarUrl(undefined), null);

  const contacts = [{
    tenant_id: 'tenant-a',
    source_channel: 'whatsapp',
    external_handle: '5521983622313@s.whatsapp.net',
    avatar_url: 'http://insecure.example.com/avatar.jpg',
  }];
  const avatarIndex = buildContactAvatarIndex(contacts, 'tenant-a');
  const events = [
    event({
      tenant_slug: 'tenant-a',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      created_at: '2026-09-30T10:00:00.000Z',
    }),
  ];
  const eventsWithAvatars = applyContactAvatars(events, avatarIndex, 'tenant-a');
  const [conv] = eventsToConversations(eventsWithAvatars, 'tenant-a');
  assert.equal(conv.avatarUrl, null);
});

test('TEST D: Realtime recebe contact_avatar.avatarUrl valido e atualiza Conversation existente', () => {
  const initialEvent = event({
    id: 'evt-1',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:00:00.000Z',
    avatar_url: 'https://cdn.example.com/foto-antiga.jpg',
  });
  const initialConversations = eventsToConversations([initialEvent], 'tenant-a');
  assert.equal(initialConversations[0].avatarUrl, 'https://cdn.example.com/foto-antiga.jpg');

  const incomingRealtimeEvent = event({
    id: 'evt-2',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:05:00.000Z',
    raw_payload: {
      contact_avatar: {
        avatarUrl: 'https://cdn.example.com/foto-nova.jpg',
      },
    },
  });

  const updatedConversations = applyIncomingEventToConversations(initialConversations, incomingRealtimeEvent, 'tenant-a');
  assert.equal(updatedConversations.length, 1);
  assert.equal(updatedConversations[0].avatarUrl, 'https://cdn.example.com/foto-nova.jpg');
});

test('TEST E: Realtime sem contact_avatar nao apaga avatar existente', () => {
  const initialEvent = event({
    id: 'evt-1',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:00:00.000Z',
    avatar_url: 'https://cdn.example.com/foto-antiga.jpg',
  });
  const initialConversations = eventsToConversations([initialEvent], 'tenant-a');
  assert.equal(initialConversations[0].avatarUrl, 'https://cdn.example.com/foto-antiga.jpg');

  const incomingRealtimeEvent = event({
    id: 'evt-2',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:05:00.000Z',
    raw_payload: {},
  });

  const updatedConversations = applyIncomingEventToConversations(initialConversations, incomingRealtimeEvent, 'tenant-a');
  assert.equal(updatedConversations.length, 1);
  assert.equal(updatedConversations[0].avatarUrl, 'https://cdn.example.com/foto-antiga.jpg');
});

test('TEST F: Realtime com URL invalida nao apaga avatar existente', () => {
  const initialEvent = event({
    id: 'evt-1',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:00:00.000Z',
    avatar_url: 'https://cdn.example.com/foto-antiga.jpg',
  });
  const initialConversations = eventsToConversations([initialEvent], 'tenant-a');
  assert.equal(initialConversations[0].avatarUrl, 'https://cdn.example.com/foto-antiga.jpg');

  const incomingBadEvent = event({
    id: 'evt-2',
    tenant_slug: 'tenant-a',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T10:05:00.000Z',
    raw_payload: {
      contact_avatar: {
        avatarUrl: 'http://unsafe-url.com/avatar.jpg',
      },
    },
  });

  const updatedConversations = applyIncomingEventToConversations(initialConversations, incomingBadEvent, 'tenant-a');
  assert.equal(updatedConversations.length, 1);
  assert.equal(updatedConversations[0].avatarUrl, 'https://cdn.example.com/foto-antiga.jpg');
});

test('TEST G: mesmo external_conversation_id em tenants diferentes nao mistura avatar', () => {
  const contacts = [
    {
      tenant_id: 'tenant-genesis',
      source_channel: 'whatsapp',
      external_handle: '5521983622313@s.whatsapp.net',
      avatar_url: 'https://genesis.cdn.com/avatar-wesley.jpg',
    },
    {
      tenant_id: 'tenant-nubia',
      source_channel: 'whatsapp',
      external_handle: '5521983622313@s.whatsapp.net',
      avatar_url: 'https://nubia.cdn.com/avatar-nubia.jpg',
    },
  ];

  const indexGenesis = buildContactAvatarIndex(contacts, 'tenant-genesis');
  const indexNubia = buildContactAvatarIndex(contacts, 'tenant-nubia');

  const eventGenesis = event({
    tenant_slug: 'genesis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
  });
  const eventNubia = event({
    tenant_slug: 'nubia',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
  });

  const [appliedGenesis] = applyContactAvatars([eventGenesis], indexGenesis, 'tenant-genesis');
  const [appliedNubia] = applyContactAvatars([eventNubia], indexNubia, 'tenant-nubia');

  const [convGenesis] = eventsToConversations([appliedGenesis], 'genesis');
  const [convNubia] = eventsToConversations([appliedNubia], 'nubia');

  assert.equal(convGenesis.avatarUrl, 'https://genesis.cdn.com/avatar-wesley.jpg');
  assert.equal(convNubia.avatarUrl, 'https://nubia.cdn.com/avatar-nubia.jpg');
  assert.notEqual(convGenesis.avatarUrl, convNubia.avatarUrl);
});

test('TEST H: mesmo contato com nova session_id / sales_lead_id continua uma unica conversa e preserva avatar', () => {
  const events = [
    event({
      id: 'evt-s1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      created_at: '2026-09-28T09:00:00.000Z',
      avatar_url: 'https://cdn.example.com/avatar-ian.jpg',
      raw_payload: { conversation_session_id: 'session-001', sales_lead_id: 'lead-001' },
    }),
    event({
      id: 'evt-s2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      created_at: '2026-09-29T14:00:00.000Z',
      raw_payload: { conversation_session_id: 'session-002', sales_lead_id: 'lead-002' },
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].avatarUrl, 'https://cdn.example.com/avatar-ian.jpg');

  const realtimeEvt = event({
    id: 'evt-s3',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    created_at: '2026-09-30T18:00:00.000Z',
    raw_payload: { conversation_session_id: 'session-003', sales_lead_id: 'lead-003' },
  });

  const updatedConvs = applyIncomingEventToConversations(convs, realtimeEvt, 'wesley_automoveis');
  assert.equal(updatedConvs.length, 1);
  assert.equal(updatedConvs[0].avatarUrl, 'https://cdn.example.com/avatar-ian.jpg');
});

test('TEST I: ContactAvatar recebe URL A que falha, depois recebe URL B valida -> erro reseta e tenta renderizar B', () => {
  // 1. Recebe URL A
  let state = resolveContactAvatarState({ currentFailed: false, prevUrl: null, nextUrl: 'https://cdn.example.com/avatar-a.jpg' });
  assert.equal(state.failed, false);
  assert.equal(state.url, 'https://cdn.example.com/avatar-a.jpg');
  assert.equal(state.shouldRenderImage, true);

  // 2. URL A falha ao carregar (onError)
  state = { ...state, failed: true, shouldRenderImage: false };
  assert.equal(state.failed, true);
  assert.equal(state.shouldRenderImage, false);

  // 3. Realtime entrega nova URL B válida -> useEffect reseta failed para false
  state = resolveContactAvatarState({
    currentFailed: state.failed,
    prevUrl: 'https://cdn.example.com/avatar-a.jpg',
    nextUrl: 'https://cdn.example.com/avatar-b.jpg',
  });
  assert.equal(state.failed, false);
  assert.equal(state.url, 'https://cdn.example.com/avatar-b.jpg');
  assert.equal(state.shouldRenderImage, true);
});

test('TEST J: contacts vazio -> frontend continua funcionando normalmente com iniciais', () => {
  const avatarIndex = buildContactAvatarIndex([], 'tenant-a');
  assert.equal(avatarIndex.size, 0);

  const events = [
    event({
      tenant_slug: 'tenant-a',
      channel_type: 'whatsapp',
      external_conversation_id: '5521999999999@s.whatsapp.net',
      contact_name: 'Wesley Silva',
      created_at: '2026-09-30T10:00:00.000Z',
    }),
  ];
  const eventsWithAvatars = applyContactAvatars(events, avatarIndex, 'tenant-a');
  const [conv] = eventsToConversations(eventsWithAvatars, 'tenant-a');

  assert.ok(conv);
  assert.equal(conv.avatarUrl, null);
  assert.equal(conv.contact, 'Wesley Silva');
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

test('applyIncomingEventToConversations updates messages, preview, unread, and moves conversation to top', () => {
  const initial = eventsToConversations([
    event({ id: 'e1', external_conversation_id: 'chat-1', contact_name: 'Janete', created_at: '2026-09-30T10:00:00.000Z', message_text: 'Olá Janete' }),
    event({ id: 'e2', external_conversation_id: 'chat-2', contact_name: 'Carlos', created_at: '2026-09-30T11:00:00.000Z', message_text: 'Olá Carlos' }),
  ]);

  assert.equal(initial[0].contact, 'Carlos');
  assert.equal(initial[1].contact, 'Janete');
  assert.equal(initial[1].messages.length, 1);
  assert.equal(initial[1].unread, 0);

  const incomingInbound = event({
    id: 'e3',
    external_conversation_id: 'chat-1',
    contact_name: 'Janete',
    direction: 'inbound',
    created_at: '2026-09-30T12:00:00.000Z',
    message_text: 'Gostaria de agendar um horário',
  });

  const updated = applyIncomingEventToConversations(initial, incomingInbound);

  // Janete should now be at the top because of the newer timestamp (12:00 > 11:00)
  assert.equal(updated[0].contact, 'Janete');
  assert.equal(updated[0].lastMessage, 'Gostaria de agendar um horário');
  assert.equal(updated[0].unread, 1);
  assert.equal(updated[0].messages.length, 2);
  assert.equal(updated[0].messages[1].text, 'Gostaria de agendar um horário');
  assert.equal(updated[0].messages[1].from, 'contact');
});

test('applyIncomingEventToConversations handles outbound message and does not increment unread', () => {
  const initial = eventsToConversations([
    event({ id: 'e1', external_conversation_id: 'chat-1', contact_name: 'Janete', created_at: '2026-09-30T10:00:00.000Z', message_text: 'Olá Janete' }),
  ]);

  const outboundEvent = event({
    id: 'e-reply',
    external_conversation_id: 'chat-1',
    contact_name: 'Janete',
    direction: 'outbound',
    sender_type: 'operator',
    sent_by_user: 'Atendente Maria',
    created_at: '2026-09-30T10:05:00.000Z',
    message_text: 'Posso ajudar sim, qual o melhor dia?',
  });

  const updated = applyIncomingEventToConversations(initial, outboundEvent);
  assert.equal(updated[0].messages.length, 2);
  assert.equal(updated[0].messages[1].from, 'agent');
  assert.equal(updated[0].messages[1].sent_by, 'Atendente Maria');
  assert.equal(updated[0].unread, 0);
  assert.equal(updated[0].lastMessage, 'Posso ajudar sim, qual o melhor dia?');
});

test('applyIncomingEventToConversations materializes new conversation when none existed', () => {
  const initial = [];
  const newEvent = event({
    id: 'e-new',
    external_conversation_id: 'chat-novo',
    contact_name: 'Novo Cliente',
    direction: 'inbound',
    created_at: '2026-10-01T15:00:00.000Z',
    message_text: 'Primeira mensagem',
  });

  const updated = applyIncomingEventToConversations(initial, newEvent);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].contact, 'Novo Cliente');
  assert.equal(updated[0].lastMessage, 'Primeira mensagem');
  assert.equal(updated[0].unread, 1);
});

test('hides only a disposable generic ad opener once the same contact sends a useful follow-up', () => {
  const opener = event({
    id: 'ad-opener', tenant_slug: 'tenant-a', external_conversation_id: 'ad-chat',
    created_at: '2026-10-04T14:35:15.000Z', message_text: 'Olá! Posso ter mais informações sobre isso?',
  });
  const vehicle = event({
    id: 'vehicle-detail', tenant_slug: 'tenant-a', external_conversation_id: 'ad-chat',
    created_at: '2026-10-04T14:36:04.000Z', message_text: 'Sandero 2016 1.6',
  });

  const [conversation] = eventsToConversations([opener, vehicle], 'tenant-a');
  assert.deepEqual(conversation.messages.map((message) => message.text), ['Sandero 2016 1.6']);
  assert.equal(conversation.lastMessage, 'Sandero 2016 1.6');

  const [standalone] = eventsToConversations([opener], 'tenant-a');
  assert.deepEqual(standalone.messages.map((message) => message.text), ['Olá! Posso ter mais informações sobre isso?']);
});

test('realtime follow-up removes a previously rendered disposable generic ad opener', () => {
  const opener = event({
    id: 'ad-opener-realtime', tenant_slug: 'tenant-a', external_conversation_id: 'ad-chat-realtime',
    created_at: '2026-10-04T14:35:15.000Z', message_text: 'Olá! Posso ter mais informações sobre isso?',
  });
  const [initial] = eventsToConversations([opener], 'tenant-a');
  const detailedFollowUp = event({
    id: 'vehicle-detail-realtime', tenant_slug: 'tenant-a', external_conversation_id: 'ad-chat-realtime',
    created_at: '2026-10-04T14:36:04.000Z', message_text: 'Sandero 2016 1.6',
  });

  const [updated] = applyIncomingEventToConversations([initial], detailedFollowUp, 'tenant-a');
  assert.deepEqual(updated.messages.map((message) => message.text), ['Sandero 2016 1.6']);
});

test('unread: incrementa somente para inbound novo fora da conversa visivel', () => {
  const base = eventsToConversations([event({ id: 'read-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const incoming = event({ id: 'unread-new', created_at: '2026-10-01T09:01:00.000Z', message_text: 'Nova mensagem' });

  const hidden = applyIncomingEventToConversations(base, incoming);
  const visible = applyIncomingEventToConversations(base, incoming, '', { markIncomingAsRead: true });

  assert.equal(hidden[0].unread, 1);
  assert.equal(visible[0].unread, 0);
});

test('unread: evento Realtime duplicado nao incrementa novamente', () => {
  const base = eventsToConversations([event({ id: 'dedup-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const incoming = event({ id: 'dedup-inbound', created_at: '2026-10-01T09:01:00.000Z' });

  const once = applyIncomingEventToConversations(base, incoming);
  const twice = applyIncomingEventToConversations(once, incoming);

  assert.equal(once[0].unread, 1);
  assert.equal(twice[0].unread, 1);
  assert.equal(twice[0].messages.filter((message) => message.eventId === 'dedup-inbound').length, 1);
});

test('unread: duas mensagens inbound diferentes acumulam 0 -> 1 -> 2', () => {
  const base = eventsToConversations([event({ id: 'two-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const first = applyIncomingEventToConversations(base, event({ id: 'two-first', created_at: '2026-10-01T09:01:00.000Z' }));
  const second = applyIncomingEventToConversations(first, event({ id: 'two-second', created_at: '2026-10-01T09:02:00.000Z' }));

  assert.equal(first[0].unread, 1);
  assert.equal(second[0].unread, 2);
});

test('unread: eventos operacionais e outbound nao recebem badge', () => {
  const base = eventsToConversations([event({ id: 'ignored-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const operational = event({
    id: 'operational-event',
    direction: 'internal',
    sender_type: 'system',
    raw_payload: { event_type: 'kanban_stage_changed', is_internal: true },
  });
  const outbound = event({ id: 'outbound-event', direction: 'outbound', sender_type: 'agent' });

  assert.equal(applyIncomingEventToConversations(base, operational)[0].unread, 0);
  assert.equal(applyIncomingEventToConversations(base, outbound)[0].unread, 0);
  assert.equal(isUnreadInboundEvent(operational), false);
  assert.equal(isUnreadInboundEvent(outbound), false);
});

test('unread: watermark persistido zera o historico e reaplica apos reload', () => {
  const source = eventsToConversations([
    event({ id: 'history-1', created_at: '2026-10-01T09:00:00.000Z' }),
    event({ id: 'history-2', created_at: '2026-10-01T09:01:00.000Z' }),
  ], 'tenant-a');
  const marker = {
    tenant_id: 'tenant-a-id',
    user_id: 'user-a',
    channel_type: 'whatsapp',
    external_conversation_id: 'chat-1',
    last_read_event_id: 'history-2',
    last_read_at: '2026-10-01T09:01:00.000Z',
  };

  const firstLoad = applyConversationReadState(source, [marker], 'tenant-a-id', 'user-a');
  const reloaded = applyConversationReadState(source, [marker], 'tenant-a-id', 'user-a');

  assert.equal(firstLoad[0].unread, 0);
  assert.equal(reloaded[0].unread, 0);
});

test('unread: inbound posterior ao watermark volta a contar como nao lido', () => {
  const base = eventsToConversations([event({ id: 'watermark-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const marker = {
    tenant_id: 'tenant-a-id', user_id: 'user-a', channel_type: 'whatsapp', external_conversation_id: 'chat-1',
    last_read_event_id: 'watermark-base', last_read_at: '2026-10-01T09:00:00.000Z',
  };
  const readBase = applyConversationReadState(base, [marker], 'tenant-a-id', 'user-a');
  const withLaterMessage = applyIncomingEventToConversations(
    readBase,
    event({ id: 'watermark-later', created_at: '2026-10-01T09:01:00.000Z' }),
  );

  assert.equal(readBase[0].unread, 0);
  assert.equal(withLaterMessage[0].unread, 1);
});

test('unread: aba oculta ou chat mobile fechado mantem inbound como nao lido', () => {
  const base = eventsToConversations([event({ id: 'hidden-base', created_at: '2026-10-01T09:00:00.000Z' })]);
  const incoming = event({ id: 'hidden-inbound', created_at: '2026-10-01T09:01:00.000Z' });

  // O componente so passa markIncomingAsRead quando a aba esta visivel e o chat esta aberto.
  const hiddenTab = applyIncomingEventToConversations(base, incoming, '', { markIncomingAsRead: false });
  const mobileChatClosed = applyIncomingEventToConversations(base, incoming, '', { markIncomingAsRead: false });

  assert.equal(hiddenTab[0].unread, 1);
  assert.equal(mobileChatClosed[0].unread, 1);
});

test('unread: marcador e contagem ficam isolados por usuario e tenant', () => {
  const source = eventsToConversations([event({ id: 'isolation-message', created_at: '2026-10-01T09:00:00.000Z' })]);
  const marker = {
    tenant_id: 'tenant-a-id',
    user_id: 'user-a',
    channel_type: 'whatsapp',
    external_conversation_id: 'chat-1',
    last_read_event_id: 'isolation-message',
    last_read_at: '2026-10-01T09:00:00.000Z',
  };

  assert.equal(applyConversationReadState(source, [marker], 'tenant-a-id', 'user-a')[0].unread, 0);
  assert.equal(applyConversationReadState(source, [marker], 'tenant-a-id', 'user-b')[0].unread, 1);
  assert.equal(applyConversationReadState(source, [marker], 'tenant-b-id', 'user-a')[0].unread, 1);
});

test('unread: identifica a conversa de forma canonica e nao mistura canais', () => {
  assert.equal(
    conversationReadKey('tenant-a', 'user-a', 'whatsapp', '55 249 9877-0247'),
    conversationReadKey('tenant-a', 'user-a', 'whatsapp', '5524998770247@s.whatsapp.net'),
  );
  assert.notEqual(
    conversationReadKey('tenant-a', 'user-a', 'whatsapp', 'chat-1'),
    conversationReadKey('tenant-a', 'user-a', 'telegram', 'chat-1'),
  );
});

test('unread: o marcador otimista avanca sem regredir por resposta Realtime antiga', () => {
  const current = {
    tenant_id: 'tenant-a', user_id: 'user-a', channel_type: 'whatsapp', external_conversation_id: 'chat-1',
    last_read_event_id: 'event-new', last_read_at: '2026-10-01T09:02:00.000Z',
  };
  const stale = { ...current, last_read_event_id: 'event-old', last_read_at: '2026-10-01T09:01:00.000Z' };
  const next = upsertConversationReadMarker([current], stale);

  assert.equal(next[0].last_read_event_id, 'event-new');
  assert.equal(shouldAdvanceConversationRead(current, { eventId: 'event-newer', createdAt: '2026-10-01T09:03:00.000Z' }), true);
});

test('unread: marcador recebido por Realtime recalcula outra aba sem decremento fragil', () => {
  const source = eventsToConversations([event({ id: 'realtime-read', created_at: '2026-10-01T09:00:00.000Z' })]);
  const beforeMarker = applyConversationReadState(source, [], 'tenant-a', 'user-a');
  const realtimeMarker = {
    tenant_id: 'tenant-a', user_id: 'user-a', channel_type: 'whatsapp', external_conversation_id: 'chat-1',
    last_read_event_id: 'realtime-read', last_read_at: '2026-10-01T09:00:00.000Z',
  };
  const afterMarker = applyConversationReadState(source, [realtimeMarker], 'tenant-a', 'user-a');

  assert.equal(beforeMarker[0].unread, 1);
  assert.equal(afterMarker[0].unread, 0);
});

test('unread: ultimo evento visivel fornece o watermark correto e o filtro conta conversas', () => {
  const source = eventsToConversations([
    event({ id: 'latest-old', created_at: '2026-10-01T09:00:00.000Z' }),
    event({ id: 'latest-new', created_at: '2026-10-01T09:02:00.000Z' }),
  ]);
  const latest = getLatestReadableEvent(source[0]);
  const withUnread = applyIncomingEventToConversations(source, event({ id: 'other-chat', external_conversation_id: 'chat-2' }));

  assert.equal(latest.eventId, 'latest-new');
  assert.equal(withUnread.filter((conversation) => conversation.unread > 0).length, 1);
});

test('applyIncomingEventToKanban updates card preview and recency', () => {
  const initialColumns = [
    {
      id: 'col-1',
      cards: [
        {
          id: 'card-1',
          externalConversationId: 'chat-1',
          title: 'Cliente 1',
          subtitle: 'Mensagem antiga',
          lastAt: '28/09 10:00',
          lastActivityAt: '2026-09-28T10:00:00.000Z',
        },
      ],
    },
  ];

  const incoming = event({
    id: 'e-k1',
    external_conversation_id: 'chat-1',
    created_at: '2026-10-01T16:00:00.000Z',
    message_text: 'Nova mensagem em tempo real',
  });

  const updated = applyIncomingEventToKanban(initialColumns, incoming);
  assert.equal(updated[0].cards[0].subtitle, 'Nova mensagem em tempo real');
  assert.equal(updated[0].cards[0].lastActivityAt, '2026-10-01T16:00:00.000Z');
});

test('CASO 1: mesmo tenant, mesmo external_conversation_id, mesma session -> uma conversa', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'sess-1' },
      message_text: 'Olá',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'sess-1' },
      direction: 'outbound',
      sender_type: 'ai',
      response_text: 'Olá, como posso ajudar?',
      created_at: '2026-10-01T10:01:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].contact, 'Ian Shtorache');
  assert.equal(convs[0].messages.length, 2);
});

test('CASO 2: mesmo tenant, mesmo external_conversation_id, session diferente -> uma conversa visual', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'sess-A' },
      message_text: 'Mensagem na sessão A',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'WhatsApp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'sess-B' },
      message_text: 'Mensagem na sessão B horas depois',
      created_at: '2026-10-01T15:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].messages.length, 2);
  assert.equal(convs[0].messages[0].sessionId, 'sess-A');
  assert.equal(convs[0].messages[1].sessionId, 'sess-B');
});

test('CASO 3: mesmo tenant, mesmo external_conversation_id, sales_lead_id diferente -> uma conversa visual', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { sales_lead_id: 'lead-001', conversation_session_id: 'sess-1' },
      message_text: 'Interesse no carro X',
      created_at: '2026-09-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { sales_lead_id: 'lead-002', conversation_session_id: 'sess-2' },
      message_text: 'Interesse no carro Y semanas depois',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].messages.length, 2);
});

test('CASO 4: mesmo tenant, external_conversation_id diferente -> duas conversas', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Olá do Ian',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521999998888@s.whatsapp.net',
      contact_name: 'Marcos Silva',
      message_text: 'Olá do Marcos',
      created_at: '2026-10-01T11:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 2);
});

test('CASO 5: mesmo external_conversation_id, tenant diferente -> duas conversas isoladas', () => {
  const eventsTenantA = [
    event({
      id: 'e1',
      tenant_slug: 'tenant_a',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Cliente Compartilhado',
      message_text: 'Mensagem para loja A',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];
  const eventsTenantB = [
    event({
      id: 'e2',
      tenant_slug: 'tenant_b',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Cliente Compartilhado',
      message_text: 'Mensagem para clínica B',
      created_at: '2026-10-01T10:05:00.000Z',
    }),
  ];

  const convA = eventsToConversations(eventsTenantA, 'tenant_a');
  const convB = eventsToConversations(eventsTenantB, 'tenant_b');

  assert.equal(convA.length, 1);
  assert.equal(convB.length, 1);
  assert.notEqual(convA[0].id, convB[0].id);
  assert.equal(convA[0].id.includes('tenant_a'), true);
  assert.equal(convB[0].id.includes('tenant_b'), true);
});

test('CASO 6: mensagem Realtime chega para session nova -> conversa existente atualizada, nenhuma duplicata criada', () => {
  const initial = eventsToConversations([
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'sess-antiga' },
      message_text: 'Atendimento anterior',
      created_at: '2026-10-01T09:00:00.000Z',
    }),
  ], 'wesley_automoveis');

  assert.equal(initial.length, 1);

  const incomingNewSession = event({
    id: 'e2-realtime',
    tenant_slug: 'wesley_automoveis',
    channel_type: 'whatsapp',
    external_conversation_id: '5521983622313@s.whatsapp.net',
    contact_name: 'Ian Shtorache',
    raw_payload: { conversation_session_id: 'sess-nova-999' },
    message_text: 'Oi, voltei para ver outro veículo',
    created_at: '2026-10-01T17:00:00.000Z',
    direction: 'inbound',
  });

  const updated = applyIncomingEventToConversations(initial, incomingNewSession, 'wesley_automoveis');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].messages.length, 2);
  assert.equal(updated[0].lastMessage, 'Oi, voltei para ver outro veículo');
});

test('CASO 7: atendimento encerrado -> nova mensagem horas depois -> nova session permitida, mesma conversa visual', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'session-1' },
      message_text: 'Dúvida inicial',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2-close',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      service: 'conversation_closed',
      stage: 'Finalizado',
      raw_payload: { conversation_session_id: 'session-1' },
      message_text: 'Atendimento encerrado pela interface',
      created_at: '2026-10-01T10:30:00.000Z',
      direction: 'outbound',
    }),
    event({
      id: 'e3-new-inbound',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      raw_payload: { conversation_session_id: 'session-2' },
      message_text: 'Oi, estou de volta!',
      created_at: '2026-10-01T18:00:00.000Z',
      direction: 'inbound',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].status, 'ia_ativa');
  assert.equal(convs[0].messages.length, 3);
});

test('CASO 8: mensagens antigas e novas continuam em ordem cronológica preservando histórico completo', () => {
  const events = [
    event({
      id: 'e3',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Terceira mensagem',
      created_at: '2026-10-01T12:00:00.000Z',
    }),
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Primeira mensagem',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Segunda mensagem',
      created_at: '2026-10-01T11:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].messages.length, 3);
  assert.equal(convs[0].messages[0].text, 'Primeira mensagem');
  assert.equal(convs[0].messages[1].text, 'Segunda mensagem');
  assert.equal(convs[0].messages[2].text, 'Terceira mensagem');
});

test('normaliza variação de formato JID do WhatsApp (com e sem @s.whatsapp.net) na mesma conversa', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313',
      contact_name: 'Ian Shtorache',
      message_text: 'Mensagem vinda de webhook com número puro',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'WhatsApp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Mensagem vinda com JID completo',
      created_at: '2026-10-01T10:05:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].messages.length, 2);
});

test('atualiza contact_name da conversa quando o primeiro evento tinha nome genérico/nulo e o posterior traz nome real', () => {
  const events = [
    event({
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: null,
      message_text: 'Primeira mensagem do contato desconhecido',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521983622313@s.whatsapp.net',
      contact_name: 'Ian Shtorache',
      message_text: 'Segunda mensagem identificada',
      created_at: '2026-10-01T10:05:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].contact, 'Ian Shtorache');
});

test('TEST A: última mensagem inbound define sender Cliente e tipo contact', () => {
  const events = [
    event({
      id: 'e-a1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Tenho interesse',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, 'Tenho interesse');
  assert.equal(convs[0].lastMessageSender, 'Cliente');
  assert.equal(convs[0].lastMessageSenderType, 'contact');
});

test('TEST B: última mensagem manual com sender_type agent e sent_by_user Wesley', () => {
  const events = [
    event({
      id: 'e-b1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Olá',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e-b2',
      tenant_slug: 'wesley_automoveis',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley',
      service: 'manual_reply',
      message_text: 'Faço 27 na minha',
      created_at: '2026-10-01T10:05:00.000Z',
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, 'Faço 27 na minha');
  assert.equal(convs[0].lastMessageSender, 'Wesley');
  assert.equal(convs[0].lastMessageSenderType, 'agent');
});

test('TEST C: mensagem manual sem nome de atendente usa fallback Atendente', () => {
  const events = [
    event({
      id: 'e-c1',
      tenant_slug: 'wesley_automoveis',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: null,
      service: 'manual_reply',
      message_text: 'Mensagem sem autor específico',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, 'Mensagem sem autor específico');
  assert.equal(convs[0].lastMessageSender, 'Atendente');
  assert.equal(convs[0].lastMessageSenderType, 'agent');
});

test('TEST D: mensagem gerada por IA define sender IA e tipo ai (mesmo com responsável)', () => {
  const events = [
    event({
      id: 'e-d1',
      tenant_slug: 'wesley_automoveis',
      direction: 'outbound',
      sender_type: 'assistant',
      ai_provider: 'gemini',
      service: 'geral',
      message_text: 'Olá! Seja bem-vindo à Genesis Automóveis.',
      created_at: '2026-10-01T10:00:00.000Z',
      raw_payload: {
        assignee: { name: 'Wesley' },
      },
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, 'Olá! Seja bem-vindo à Genesis Automóveis.');
  assert.equal(convs[0].lastMessageSender, 'IA');
  assert.equal(convs[0].lastMessageSenderType, 'ai');
});

test('TEST E: evento operacional posterior não substitui lastMessage nem remetente', () => {
  const initial = eventsToConversations([
    event({
      id: 'e-e1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Tenho interesse no Corolla',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ], 'wesley_automoveis');

  assert.equal(initial[0].lastMessage, 'Tenho interesse no Corolla');
  assert.equal(initial[0].lastMessageSender, 'Cliente');

  const opEvent = event({
    id: 'e-e2',
    tenant_slug: 'wesley_automoveis',
    direction: 'internal',
    service: 'conversation_closed',
    ai_provider: 'conversation_closed',
    message_text: '[Kanban] Etapa alterada',
    created_at: '2026-10-01T10:15:00.000Z',
    raw_payload: {
      event_type: 'kanban_stage_changed',
      is_internal: true,
    },
  });

  const afterOp = applyIncomingEventToConversations(initial, opEvent, 'wesley_automoveis');
  assert.equal(afterOp[0].lastMessage, 'Tenho interesse no Corolla');
  assert.equal(afterOp[0].lastMessageSender, 'Cliente');
  assert.equal(afterOp[0].lastMessageSenderType, 'contact');
});

test('TEST F: evento Realtime mais novo atualiza mensagem e remetente atomicamente', () => {
  const initial = eventsToConversations([
    event({
      id: 'e-f1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Qual o valor?',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ], 'wesley_automoveis');

  assert.equal(initial[0].lastMessage, 'Qual o valor?');
  assert.equal(initial[0].lastMessageSender, 'Cliente');

  const incomingNewer = event({
    id: 'e-f2',
    tenant_slug: 'wesley_automoveis',
    direction: 'outbound',
    sender_type: 'agent',
    sent_by_user: 'Wesley',
    service: 'manual_reply',
    message_text: 'Valor de R$ 95.000 à vista',
    created_at: '2026-10-01T10:05:00.000Z',
  });

  const updated = applyIncomingEventToConversations(initial, incomingNewer, 'wesley_automoveis');
  assert.equal(updated[0].lastMessage, 'Valor de R$ 95.000 à vista');
  assert.equal(updated[0].lastMessageSender, 'Wesley');
  assert.equal(updated[0].lastMessageSenderType, 'agent');
});

test('TEST G: evento Realtime mais antigo (out-of-order) não sobrescreve mensagem/remetente', () => {
  const initial = eventsToConversations([
    event({
      id: 'e-g2',
      tenant_slug: 'wesley_automoveis',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley',
      service: 'manual_reply',
      message_text: 'Mensagem mais recente já recebida',
      created_at: '2026-10-01T10:10:00.000Z',
    }),
  ], 'wesley_automoveis');

  const incomingOlder = event({
    id: 'e-g1',
    tenant_slug: 'wesley_automoveis',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Mensagem antiga atrasada',
    created_at: '2026-10-01T10:05:00.000Z',
  });

  const updated = applyIncomingEventToConversations(initial, incomingOlder, 'wesley_automoveis');
  assert.equal(updated[0].lastMessage, 'Mensagem mais recente já recebida');
  assert.equal(updated[0].lastMessageSender, 'Wesley');
  assert.equal(updated[0].lastMessageSenderType, 'agent');
});

test('TEST H: evento duplicado não altera nem corrompe remetente ou mensagens', () => {
  const evt = event({
    id: 'e-h1',
    tenant_slug: 'wesley_automoveis',
    direction: 'outbound',
    sender_type: 'agent',
    sent_by_user: 'Wesley',
    service: 'manual_reply',
    message_text: 'Mensagem única',
    created_at: '2026-10-01T10:00:00.000Z',
  });

  const initial = eventsToConversations([evt], 'wesley_automoveis');
  assert.equal(initial[0].messages.length, 1);
  assert.equal(initial[0].lastMessage, 'Mensagem única');
  assert.equal(initial[0].lastMessageSender, 'Wesley');

  const afterDupe = applyIncomingEventToConversations(initial, evt, 'wesley_automoveis');
  assert.equal(afterDupe[0].messages.length, 1);
  assert.equal(afterDupe[0].lastMessage, 'Mensagem única');
  assert.equal(afterDupe[0].lastMessageSender, 'Wesley');
  assert.equal(afterDupe[0].lastMessageSenderType, 'agent');
});

test('TEST I: mídia inbound exibe preview com remetente Cliente: [audio]', () => {
  const events = [
    event({
      id: 'e-i1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: null,
      created_at: '2026-10-01T10:00:00.000Z',
      raw_payload: {
        magia_operator: {
          media: {
            category: 'audio',
            ptt: true,
          },
        },
      },
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, '[audio]');
  assert.equal(convs[0].lastMessageSender, 'Cliente');
  assert.equal(convs[0].lastMessageSenderType, 'contact');
});

test('TEST J: mídia outbound humana exibe remetente do autor: Wesley: [imagem]', () => {
  const events = [
    event({
      id: 'e-j1',
      tenant_slug: 'wesley_automoveis',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley',
      service: 'manual_reply',
      message_text: null,
      created_at: '2026-10-01T10:00:00.000Z',
      raw_payload: {
        magia_operator: {
          media: {
            category: 'image',
          },
        },
      },
    }),
  ];
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs.length, 1);
  assert.equal(convs[0].lastMessage, '[imagem]');
  assert.equal(convs[0].lastMessageSender, 'Wesley');
  assert.equal(convs[0].lastMessageSenderType, 'agent');
});

test('TEST K: bootstrap/reload e processamento Realtime produzem o mesmo sender e preview', () => {
  const ev1 = event({
    id: 'e-k1',
    tenant_slug: 'wesley_automoveis',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Olá',
    created_at: '2026-10-01T10:00:00.000Z',
  });
  const ev2 = event({
    id: 'e-k2',
    tenant_slug: 'wesley_automoveis',
    direction: 'outbound',
    sender_type: 'assistant',
    ai_provider: 'gemini',
    message_text: 'Olá! Como posso ajudar?',
    created_at: '2026-10-01T10:01:00.000Z',
  });
  const ev3 = event({
    id: 'e-k3',
    tenant_slug: 'wesley_automoveis',
    direction: 'outbound',
    sender_type: 'agent',
    sent_by_user: 'Wesley',
    service: 'manual_reply',
    message_text: 'Deixa que eu assumo aqui',
    created_at: '2026-10-01T10:05:00.000Z',
  });

  const bootstrapConvs = eventsToConversations([ev1, ev2, ev3], 'wesley_automoveis');

  let realtimeConvs = eventsToConversations([ev1], 'wesley_automoveis');
  realtimeConvs = applyIncomingEventToConversations(realtimeConvs, ev2, 'wesley_automoveis');
  realtimeConvs = applyIncomingEventToConversations(realtimeConvs, ev3, 'wesley_automoveis');

  assert.equal(bootstrapConvs[0].lastMessage, realtimeConvs[0].lastMessage);
  assert.equal(bootstrapConvs[0].lastMessageSender, realtimeConvs[0].lastMessageSender);
  assert.equal(bootstrapConvs[0].lastMessageSenderType, realtimeConvs[0].lastMessageSenderType);
  assert.equal(realtimeConvs[0].lastMessageSender, 'Wesley');
  assert.equal(realtimeConvs[0].lastMessage, 'Deixa que eu assumo aqui');
});

test('TEST L: evento de outro tenant não interfere nas conversas do tenant ativo', () => {
  const activeTenantConvs = eventsToConversations([
    event({
      id: 'e-l1',
      tenant_slug: 'wesley_automoveis',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Conversa Wesley',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ], 'wesley_automoveis');

  const incomingOtherTenant = event({
    id: 'e-l2',
    tenant_slug: 'clinica_nubia',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Mensagem Núbia',
    created_at: '2026-10-01T10:05:00.000Z',
  });

  const result = applyIncomingEventToConversations(activeTenantConvs, incomingOtherTenant, 'wesley_automoveis');
  assert.equal(result.length, 1);
  assert.equal(result[0].tenantSlug, 'wesley_automoveis');
  assert.equal(result[0].lastMessage, 'Conversa Wesley');
  assert.equal(result[0].lastMessageSender, 'Cliente');
});

test('cleanAgentName sanitiza identificadores técnicos, genéricos e nomes empresariais', () => {
  assert.equal(cleanAgentName('Wesley'), 'Wesley');
  assert.equal(cleanAgentName('Carlos Eduardo'), 'Carlos Eduardo');
  assert.equal(cleanAgentName('Operador NORIA'), '');
  assert.equal(cleanAgentName('Operador (WhatsApp)'), '');
  assert.equal(cleanAgentName('human_operator'), '');
  assert.equal(cleanAgentName('sales_operator'), '');
  assert.equal(cleanAgentName('agent'), '');
  assert.equal(cleanAgentName('atendente'), '');
  assert.equal(cleanAgentName('5521985198468@s.whatsapp.net'), '');
  assert.equal(cleanAgentName('5521985198468'), '');
  assert.equal(cleanAgentName('Gênesis automóveis'), '');
  assert.equal(cleanAgentName('Clínica Núbia'), '');
  assert.equal(cleanAgentName(''), '');
  assert.equal(cleanAgentName(null), '');
});

test('TESTE KANBAN OWNER A: sales_new + ai_locked=false + único team_agent Wesley => owner = Assistente IA', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', role: 'Atendimento', is_active: true }];
  const owner = resolveConversationOwner({
    stage: 'sales_new',
    aiLocked: false,
    activeAgents,
  });
  assert.equal(owner, 'Assistente IA');

  const lead = genesisLead('sales_new', { ai_locked: false });
  const cards = cardsFor(eventsToKanban(
    [event({ id: 'e-a1', external_conversation_id: 'chat-a1', stage: 'sales_new' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  ), 'chat-a1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Assistente IA');
  assert.equal(cards[0].ownerKind, 'ai');
});

test('TESTE KANBAN OWNER B: sales_qualifying + ai_locked=false + único team_agent Wesley => owner = Assistente IA', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    stage: 'sales_qualifying',
    aiLocked: false,
    activeAgents,
  });
  assert.equal(owner, 'Assistente IA');

  const lead = genesisLead('sales_qualifying', { ai_locked: false });
  const cards = cardsFor(eventsToKanban(
    [event({ id: 'e-b1', external_conversation_id: 'chat-b1', stage: 'sales_qualifying' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  ), 'chat-b1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Assistente IA');
  assert.equal(cards[0].ownerKind, 'ai');
});

test('TESTE KANBAN OWNER C: sales_human + ai_locked=true + único team_agent Wesley => owner = Wesley', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    stage: 'sales_human',
    aiLocked: true,
    activeAgents,
  });
  assert.equal(owner, 'Wesley');

  const lead = genesisLead('sales_human', { ai_locked: true });
  const cards = cardsFor(eventsToKanban(
    [event({ id: 'e-c1', external_conversation_id: 'chat-c1', stage: 'sales_human', handoff: true })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  ), 'chat-c1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Wesley');
  assert.equal(cards[0].ownerKind, 'agent');
});

test('TESTE KANBAN OWNER D: IA ativa + operator_name "Gênesis automóveis" => continua Assistente IA', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    isAiControlled: true,
    explicitOwner: 'Gênesis automóveis',
    activeAgents,
  });
  assert.equal(owner, 'Assistente IA');

  const lead = genesisLead('sales_new', { ai_locked: false });
  const initialColumns = eventsToKanban(
    [event({ id: 'e-d1', external_conversation_id: 'chat-d1', stage: 'sales_new' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  );
  assert.equal(cardsFor(initialColumns, 'chat-d1')[0].owner, 'Assistente IA');

  const fromMeEvent = event({
    id: 'e-d2',
    external_conversation_id: 'chat-d1',
    direction: 'outbound',
    sender_type: 'agent',
    sent_by_user: 'Gênesis automóveis',
    message_text: 'Fotos enviadas do Corolla',
    raw_payload: { magia_operator: { operator_name: 'Gênesis automóveis' } },
  });
  const updatedColumns = applyIncomingEventToKanban(initialColumns, fromMeEvent, 'wesley_automoveis', activeAgents);
  assert.equal(cardsFor(updatedColumns, 'chat-d1')[0].owner, 'Assistente IA');
});

test('TESTE KANBAN OWNER E: IA ativa + único team_agent Wesley => NÃO retorna Wesley', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    isAiControlled: true,
    activeAgents,
  });
  assert.notEqual(owner, 'Wesley');
  assert.equal(owner, 'Assistente IA');
});

test('TESTE KANBAN OWNER F: responsável humano explícito Carlos => Carlos vence qualquer fallback', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    explicitOwner: 'Carlos',
    isAiControlled: true,
    activeAgents,
  });
  assert.equal(owner, 'Carlos');

  const lead = genesisLead('sales_new', { ai_locked: false });
  const cards = cardsFor(eventsToKanban(
    [event({
      id: 'e-f1',
      external_conversation_id: 'chat-f1',
      stage: 'sales_new',
      raw_payload: { assignee: { id: 'carlos-id', name: 'Carlos' } },
    })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  ), 'chat-f1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Carlos');
  assert.equal(cards[0].ownerId, 'carlos-id');
});

test('TESTE KANBAN OWNER G: handoff humano sem responsável explícito + único agente Wesley => Wesley', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const owner = resolveConversationOwner({
    handoff: true,
    activeAgents,
  });
  assert.equal(owner, 'Wesley');

  const lead = genesisLead('sales_human', { ai_locked: true });
  const cards = cardsFor(eventsToKanban(
    [event({ id: 'e-g1', external_conversation_id: 'chat-g1', handoff: true, stage: 'sales_human' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  ), 'chat-g1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].owner, 'Wesley');
});

test('TESTE KANBAN OWNER H: Realtime de mensagem da IA não converte owner para Wesley', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const lead = genesisLead('sales_new', { ai_locked: false });
  const initialColumns = eventsToKanban(
    [event({ id: 'e-h1', external_conversation_id: 'chat-h1', stage: 'sales_new' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  );
  assert.equal(cardsFor(initialColumns, 'chat-h1')[0].owner, 'Assistente IA');

  const aiEvent = event({
    id: 'e-h2',
    external_conversation_id: 'chat-h1',
    direction: 'outbound',
    sender_type: 'assistant',
    ai_provider: 'gemini',
    message_text: 'Olá! Como posso ajudar você hoje?',
  });
  const updatedColumns = applyIncomingEventToKanban(initialColumns, aiEvent, 'wesley_automoveis', activeAgents);
  const card = cardsFor(updatedColumns, 'chat-h1')[0];
  assert.equal(card.owner, 'Assistente IA');
  assert.notEqual(card.owner, 'Wesley');
});

test('TESTE KANBAN OWNER I: Realtime de mensagem inbound enquanto IA conduz => continua Assistente IA', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const lead = genesisLead('sales_qualifying', { ai_locked: false });
  const initialColumns = eventsToKanban(
    [event({ id: 'e-i1', external_conversation_id: 'chat-i1', stage: 'sales_qualifying' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  );
  assert.equal(cardsFor(initialColumns, 'chat-i1')[0].owner, 'Assistente IA');

  const inboundEvent = event({
    id: 'e-i2',
    external_conversation_id: 'chat-i1',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Qual o valor daquele Corolla?',
  });
  const updatedColumns = applyIncomingEventToKanban(initialColumns, inboundEvent, 'wesley_automoveis', activeAgents);
  const card = cardsFor(updatedColumns, 'chat-i1')[0];
  assert.equal(card.owner, 'Assistente IA');
  assert.notEqual(card.owner, 'Wesley');
});

test('TESTE KANBAN OWNER J: quando houver handoff real para humano => owner muda de Assistente IA para Wesley/fallback humano', () => {
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const lead = genesisLead('sales_new', { ai_locked: false });
  const initialColumns = eventsToKanban(
    [event({ id: 'e-j1', external_conversation_id: 'chat-j1', stage: 'sales_new' })],
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [lead],
    activeAgents,
  );
  assert.equal(cardsFor(initialColumns, 'chat-j1')[0].owner, 'Assistente IA');

  const handoffEvent = event({
    id: 'e-j2',
    external_conversation_id: 'chat-j1',
    direction: 'internal',
    handoff: true,
    service: 'conversation_assigned',
    stage: 'Atendimento humano',
    message_text: '[Kanban] Etapa alterada para: Atendimento humano',
    raw_payload: {
      kanban_transition: { to_column: 'sales_human' },
    },
  });
  const updatedColumns = applyIncomingEventToKanban(initialColumns, handoffEvent, 'wesley_automoveis', activeAgents);
  const card = cardsFor(updatedColumns, 'chat-j1')[0];
  assert.equal(card.owner, 'Wesley');
  assert.equal(card.ownerKind, 'agent');
});

test('TESTE KANBAN OWNER K: troca de tenant não reaproveita Wesley em outro tenant', () => {
  const nubiaAgents = [{ id: 'agent-nubia', name: 'Núbia', is_active: true }];
  const emptyTenantAgents = [];

  const nubiaCards = cardsFor(eventsToKanban(
    [event({ id: 'e-k1', external_conversation_id: 'chat-k1', tenant_slug: 'clinica_nubia', stage: 'Atendimento humano', handoff: true })],
    'clinica_nubia',
    [],
    null,
    [],
    [],
    nubiaAgents,
  ), 'chat-k1');
  assert.equal(nubiaCards.length, 1);
  assert.equal(nubiaCards[0].owner, 'Núbia');
  assert.notEqual(nubiaCards[0].owner, 'Wesley');

  const otherCards = cardsFor(eventsToKanban(
    [event({ id: 'e-k2', external_conversation_id: 'chat-k2', tenant_slug: 'outro_tenant', stage: 'Atendimento humano', handoff: true })],
    'outro_tenant',
    [],
    null,
    [],
    [],
    emptyTenantAgents,
  ), 'chat-k2');
  assert.equal(otherCards.length, 1);
  assert.equal(otherCards[0].owner, 'Sem responsável');
  assert.notEqual(otherCards[0].owner, 'Wesley');
});

test('TESTE KANBAN OWNER L: autor da última mensagem continua funcionando independentemente do owner', () => {
  const events = [
    event({
      id: 'e-l1',
      external_conversation_id: 'chat-l1',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Olá, bom dia',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
    event({
      id: 'e-l2',
      external_conversation_id: 'chat-l1',
      direction: 'outbound',
      sender_type: 'assistant',
      ai_provider: 'gemini',
      message_text: 'Olá! Como posso ajudar?',
      created_at: '2026-10-01T10:01:00.000Z',
    }),
    event({
      id: 'e-l3',
      external_conversation_id: 'chat-l1',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley',
      message_text: 'Aqui é o Wesley, vou te atender.',
      created_at: '2026-10-01T10:02:00.000Z',
    }),
  ];

  // Na sidebar de conversas: autor da última mensagem é Wesley
  const convs = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(convs[0].lastMessageSender, 'Wesley');
  assert.equal(convs[0].lastMessageSenderType, 'agent');

  // Se o cliente responde por último:
  const eventsAfterClient = [
    ...events,
    event({
      id: 'e-l4',
      external_conversation_id: 'chat-l1',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Perfeito Wesley, obrigado!',
      created_at: '2026-10-01T10:03:00.000Z',
    }),
  ];
  const convsAfterClient = eventsToConversations(eventsAfterClient, 'wesley_automoveis');
  assert.equal(convsAfterClient[0].lastMessageSender, 'Cliente');
  assert.equal(convsAfterClient[0].lastMessageSenderType, 'contact');

  // No Kanban, com handoff para humano ativo, o responsável é Wesley
  const activeAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const kanbanCards = cardsFor(eventsToKanban(
    eventsAfterClient.map((e) => ({ ...e, handoff: true, stage: 'sales_human' })),
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [genesisLead('sales_human', { ai_locked: true })],
    activeAgents,
  ), 'chat-l1');
  assert.equal(kanbanCards[0].owner, 'Wesley');
});

test('TESTE CONVERSAS OWNER A: conversa em atendimento humano herda atribuição do Kanban (Wesley)', () => {
  const activeAgents = [{ id: 'agent-w1', name: 'Wesley', is_active: true, status: 'online' }];
  const events = [
    event({
      id: 'e-jotta',
      external_conversation_id: 'chat-jotta',
      contact_name: 'Jotta ☠️',
      stage: 'sales_human',
      handoff: true,
      message_text: 'Preciso falar com um vendedor',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];

  const kanban = eventsToKanban(
    events,
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [genesisLead('sales_human', { ai_locked: true })],
    activeAgents,
  );

  const convs = eventsToConversations(events, 'wesley_automoveis', activeAgents, kanban);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].contact, 'Jotta ☠️');
  assert.equal(convs[0].owner, 'Wesley');
  assert.equal(convs[0].ownerKind, 'agent');
});

test('TESTE CONVERSAS OWNER B: conversa em atendimento humano com único agente ativo atribui esse agente mesmo sem kanbanColumns', () => {
  const activeAgents = [{ id: 'agent-w1', name: 'Wesley', is_active: true, status: 'online' }];
  const events = [
    event({
      id: 'e-human-alone',
      external_conversation_id: 'chat-alone',
      stage: 'Atendimento humano',
      handoff: true,
      message_text: 'Olá',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis', activeAgents);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].owner, 'Wesley');
  assert.equal(convs[0].ownerKind, 'agent');
});

test('TESTE CONVERSAS OWNER C: conversa com IA conduzindo permanece com Assistente IA (não atribui Wesley antecipadamente)', () => {
  const activeAgents = [{ id: 'agent-w1', name: 'Wesley', is_active: true, status: 'online' }];
  const events = [
    event({
      id: 'e-ai-chat',
      external_conversation_id: 'chat-ai',
      stage: 'sales_qualifying',
      handoff: false,
      message_text: 'Tenho interesse no Corolla',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];

  const kanban = eventsToKanban(
    events,
    'wesley_automoveis',
    [],
    genesisColumns,
    [],
    [genesisLead('sales_qualifying', { ai_locked: false })],
    activeAgents,
  );

  const convs = eventsToConversations(events, 'wesley_automoveis', activeAgents, kanban);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].owner, 'Assistente IA');
  assert.equal(convs[0].ownerKind, 'ai');
});

test('TESTE CONVERSAS OWNER D: responsável explícito Carlos prevalece sobre fallback', () => {
  const activeAgents = [{ id: 'agent-w1', name: 'Wesley', is_active: true, status: 'online' }];
  const events = [
    event({
      id: 'e-carlos-assigned',
      external_conversation_id: 'chat-carlos',
      stage: 'sales_human',
      handoff: true,
      raw_payload: { assignee: { id: 'agent-c1', name: 'Carlos' } },
      message_text: 'Atendimento em andamento',
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ];

  const convs = eventsToConversations(events, 'wesley_automoveis', activeAgents);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].owner, 'Carlos');
  assert.equal(convs[0].ownerKind, 'agent');
});

const controlAgents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];

function materializeSalesControl(history, lead, agents = controlAgents, tenant = 'wesley_automoveis') {
  const columns = eventsToKanban(history, tenant, [], genesisColumns, [], lead ? [lead] : [], agents);
  return { columns, card: cardsFor(columns)[0], conversation: eventsToConversations(history, tenant, agents, columns)[0] };
}

function priorHumanPeriod() {
  return [
    event({ id: 'assigned-old', service: 'conversation_assigned', handoff: true, stage: 'Atendimento humano',
      raw_payload: { assignee: { id: 'agent-w', name: 'Wesley' } } }),
    event({ id: 'manual-old', direction: 'outbound', sender_type: 'agent', service: 'manual_reply',
      handoff: true, stage: 'Atendimento humano', sent_by_user: 'Wesley', message_text: 'Resposta humana antiga',
      created_at: '2026-09-28T10:30:00.000Z' }),
  ];
}

test('sales control A: persisted qualification overrides historical handoff, manual reply and owner', () => {
  const history = priorHumanPeriod();
  const { card, conversation } = materializeSalesControl(history, genesisLead('sales_qualifying'));
  assert.equal(card.targetColumnId, 'sales_qualifying');
  assert.equal(card.salesAiLocked, false);
  assert.equal(card.owner, 'Assistente IA');
  assert.equal(card.ownerKind, 'ai');
  assert.equal(card.ownerId, null);
  assert.equal(card.aiReason, 'IA conduzindo a conversa');
  assert.equal(conversation.status, 'ia_ativa');
  assert.equal(conversation.stage, 'IA - Qualificacao automotiva');
  assert.equal(conversation.ownerId, null);
  assert.equal(conversation.lastMessageSender, 'Wesley');
});

test('sales control B: historical assignment followed by resume_ai never wins current AI control', () => {
  const history = [...priorHumanPeriod(), event({ id: 'resumed', service: 'resume_ai', stage: 'Qualificação',
    sender_type: 'system', direction: 'outbound', created_at: '2026-09-28T11:00:00.000Z' })];
  for (const events of [history, [...history].reverse()]) {
    const { card } = materializeSalesControl(events, genesisLead('sales_qualifying'));
    assert.deepEqual({ name: card.owner, id: card.ownerId, kind: card.ownerKind }, { name: 'Assistente IA', id: null, kind: 'ai' });
    assert.equal(card.aiReason, 'IA conduzindo a conversa');
  }
});

test('sales control C: current human lead uses the sole active agent, or none for zero/multiple agents', () => {
  for (const agents of [controlAgents, [], [...controlAgents, { id: 'agent-c', name: 'Carlos', is_active: true }]]) {
    const { card } = materializeSalesControl([event()], genesisLead('sales_human', { ai_locked: true }), agents);
    assert.equal(card.owner, agents.length === 1 ? 'Wesley' : 'Sem responsável');
    assert.equal(card.aiReason, '');
  }
});

test('sales control D/K: current explicit Carlos assignment after handoff overrides human fallback', () => {
  const history = [event({ handoff: true, stage: 'Atendimento humano' }), event({ id: 'assigned-current',
    service: 'conversation_assigned', handoff: true, stage: 'Atendimento humano', created_at: '2026-09-28T11:01:00.000Z',
    raw_payload: { assignee: { id: 'agent-c', name: 'Carlos' } } })];
  for (const events of [history, [...history].reverse()]) {
    const { card } = materializeSalesControl(events, genesisLead('sales_human', { ai_locked: true }));
    assert.equal(card.owner, 'Carlos');
    assert.equal(card.ownerId, 'agent-c');
    assert.equal(card.ownerKind, 'agent');
    assert.equal(card.aiReason, '');
    assert.equal(resolveConversationHeaderOwner({ owner: 'Wesley', ownerId: 'agent-w' }, card, controlAgents).name, 'Carlos');
  }
  const beforeAssignment = materializeSalesControl([history[0]], genesisLead('sales_human', { ai_locked: true }));
  const assignedCard = cardsFor(applyIncomingEventToKanban(beforeAssignment.columns, history[1], 'wesley_automoveis', controlAgents))[0];
  assert.equal(assignedCard.owner, 'Carlos');
  assert.equal(assignedCard.ownerId, 'agent-c');
  assert.equal(assignedCard.ownerKind, 'agent');
});

test('sales control E/F: new and hot leads with unlocked AI ignore historical human ownership', () => {
  for (const stage of ['sales_new', 'sales_hot']) {
    const { card } = materializeSalesControl(priorHumanPeriod(), genesisLead(stage));
    assert.equal(card.targetColumnId, stage);
    assert.equal(card.owner, 'Assistente IA');
    assert.equal(card.ownerKind, 'ai');
    assert.equal(card.aiReason, 'IA conduzindo a conversa');
  }
});

test('sales control G: conversation inherits AI card and clears historical ownerId', () => {
  const card = { externalConversationId: 'chat-1', owner: 'Assistente IA', ownerKind: 'ai', ownerId: null };
  const [conversation] = eventsToConversations(priorHumanPeriod(), 'wesley_automoveis', controlAgents, [{ cards: [card] }]);
  assert.equal(conversation.owner, 'Assistente IA');
  assert.equal(conversation.ownerKind, 'ai');
  assert.equal(conversation.ownerId, null);
});

test('sales control H: header ignores stale Wesley ID when card says AI or has canonical unlocked stage', () => {
  const selected = { owner: 'Wesley', ownerId: 'agent-w', ownerKind: 'agent', status: 'atendimento_humano', stage: 'Atendimento humano' };
  for (const card of [
    { owner: 'Assistente IA', ownerKind: 'ai', ownerId: null },
    { owner: 'Wesley', ownerId: 'agent-w', salesStageKey: 'sales_qualifying', salesAiLocked: false },
  ]) {
    assert.deepEqual(resolveConversationHeaderOwner(selected, card, controlAgents), { name: 'Assistente IA', id: null, kind: 'ai' });
  }
  assert.equal(resolveConversationHeaderOwner({ ...selected, ownerKind: 'ai' }, null, controlAgents).kind, 'ai');
});

test('sales control I: resume_ai requests rebuild; burst debounce retains the last transition and cancels on cleanup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rebuilds = 0;
  const refresh = createDebouncedRealtimeRefresh(() => { rebuilds += 1; });
  const dispatch = (incoming) => { if (shouldRefreshConversationState(incoming)) refresh(); };
  dispatch(event({ service: 'conversation_assigned' }));
  t.mock.timers.tick(500);
  dispatch(event({ service: 'resume_ai', handoff: false }));
  t.mock.timers.tick(799);
  assert.equal(rebuilds, 0);
  t.mock.timers.tick(1);
  assert.equal(rebuilds, 1);
  dispatch(event({ handoff: true }));
  refresh.cancel();
  t.mock.timers.tick(800);
  assert.equal(rebuilds, 1);
  assert.equal(shouldRefreshConversationState(event({ service: 'geral', handoff: false })), false);
});

test('sales control J: realtime handoff requests rebuild and canonical human lead restores human owner without AI badge', () => {
  const initial = materializeSalesControl([event()], genesisLead('sales_qualifying'));
  const incoming = event({ id: 'new-handoff', handoff: true, stage: 'Atendimento humano', created_at: '2026-09-28T12:00:00.000Z' });
  assert.equal(shouldRefreshConversationState(incoming), true);
  const incremental = cardsFor(applyIncomingEventToKanban(initial.columns, incoming, 'wesley_automoveis', controlAgents))[0];
  assert.equal(incremental.owner, 'Wesley');
  const { card, conversation } = materializeSalesControl([event(), incoming], genesisLead('sales_human', { ai_locked: true }));
  assert.equal(card.owner, 'Wesley');
  assert.equal(card.ownerKind, 'agent');
  assert.equal(card.aiReason, '');
  assert.equal(resolveConversationHeaderOwner(conversation, card, controlAgents).name, 'Wesley');
});

test('sales control L: generic tenant and Genesis without a lead retain event-based human precedence', () => {
  for (const tenant of ['clinica_nubia', 'wesley_automoveis']) {
    const { card } = materializeSalesControl(priorHumanPeriod(), tenant === 'clinica_nubia' ? genesisLead('sales_qualifying') : null, controlAgents, tenant);
    assert.equal(card.owner, 'Wesley');
    assert.equal(card.ownerKind, 'agent');
    assert.equal(card.aiReason, '');
  }
});

test('sales control: human lock/stage beats AI stages; other persisted stages do not invent active AI', () => {
  assert.equal(resolveSalesControlMode(genesisLead('sales_qualifying', { ai_locked: true })), 'human');
  assert.equal(resolveSalesControlMode(genesisLead('sales_human', { ai_locked: false })), 'human');
  assert.equal(resolveSalesControlMode(genesisLead('sales_closed')), 'none');
  assert.equal(resolveSalesControlMode(null), null);
  const owner = resolveConversationOwnerDetails({ salesLead: genesisLead('sales_qualifying'),
    explicitOwner: 'Wesley', explicitOwnerId: 'agent-w', handoff: true, isHumanControlled: true });
  assert.deepEqual(owner, { name: 'Assistente IA', id: null, kind: 'ai' });
});

test('sales control: resume_ai clears old Carlos assignment before a later unassigned human period', () => {
  const history = [event({ service: 'conversation_assigned', raw_payload: { assignee: { id: 'agent-c', name: 'Carlos' } } }),
    event({ id: 'resume', service: 'resume_ai', created_at: '2026-09-28T11:00:00.000Z' }),
    event({ id: 'handoff-again', handoff: true, stage: 'Atendimento humano', created_at: '2026-09-28T12:00:00.000Z' })];
  const { card } = materializeSalesControl(history.reverse(), genesisLead('sales_human', { ai_locked: true }));
  assert.equal(card.owner, 'Wesley');
  assert.equal(card.ownerId, 'agent-w');
});

test('contact identity only trusts inbound contact events across conversations, Kanban, and realtime', () => {
  const inbound = event({
    id: 'identity-inbound',
    external_conversation_id: 'identity-chat',
    contact_handle: '5511999999999',
    contact_name: 'João da Silva',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Olá',
    created_at: '2026-10-02T10:00:00.000Z',
  });
  const manualReply = event({
    id: 'identity-manual',
    external_conversation_id: 'identity-chat',
    contact_handle: '5511999999999',
    contact_name: 'Gênesis automóveis',
    direction: 'outbound',
    sender_type: 'agent',
    service: 'manual_reply',
    sent_by_user: 'Wesley',
    message_text: 'Como posso ajudar?',
    created_at: '2026-10-02T10:01:00.000Z',
  });
  const aiReply = event({
    id: 'identity-ai',
    external_conversation_id: 'identity-chat',
    contact_handle: '5511999999999',
    contact_name: 'Outro nome inválido',
    direction: 'outbound',
    sender_type: 'assistant',
    ai_provider: 'gemini',
    message_text: 'Resposta da IA',
    created_at: '2026-10-02T10:02:00.000Z',
  });

  const [conversation] = eventsToConversations([inbound, manualReply, aiReply]);
  const [card] = cardsFor(eventsToKanban([inbound, manualReply, aiReply]), 'identity-chat');
  assert.equal(conversation.contact, 'João da Silva');
  assert.equal(card.title, 'João da Silva');
  assert.equal(conversation.messages.at(-1).from, 'ai');

  const [outboundOnly] = eventsToConversations([manualReply]);
  const [outboundOnlyCard] = cardsFor(eventsToKanban([manualReply]), 'identity-chat');
  assert.equal(outboundOnly.contact, '+55 (11) 99999-9999');
  assert.equal(outboundOnlyCard.title, '+55 (11) 99999-9999');

  const [realInboundGenesis] = eventsToConversations([
    { ...inbound, contact_name: 'Gênesis automóveis' },
  ]);
  assert.equal(realInboundGenesis.contact, 'Gênesis automóveis');

  const realtime = applyIncomingEventToConversations(
    eventsToConversations([inbound]),
    manualReply,
  );
  assert.equal(realtime[0].contact, 'João da Silva');
  assert.equal(realtime[0].messages.at(-1).from, 'agent');
});

test('contact identity requires a useful trusted name and keeps Conversations and Kanban consistent', () => {
  const phone = '5521985198468';
  for (const invalidName of ['', '..', '...', phone]) {
    const inbound = event({
      id: `identity-invalid-${invalidName || 'empty'}`,
      external_conversation_id: `identity-invalid-${invalidName || 'empty'}`,
      contact_handle: phone,
      contact_name: invalidName,
      direction: 'inbound',
      sender_type: 'contact',
    });
    const [conversation] = eventsToConversations([inbound]);
    const [card] = cardsFor(eventsToKanban([inbound]), inbound.external_conversation_id);
    assert.equal(conversation.contact, '+55 (21) 98519-8468', invalidName || 'empty');
    assert.equal(card.title, '+55 (21) 98519-8468', invalidName || 'empty');
  }

  for (const validName of ['🚛 CD Tids', 'Oficina_j3a', 'Gênesis automóveis']) {
    const inbound = event({
      id: `identity-valid-${validName}`,
      external_conversation_id: `identity-valid-${validName}`,
      contact_handle: phone,
      contact_name: validName,
      direction: 'inbound',
      sender_type: 'contact',
    });
    const [conversation] = eventsToConversations([inbound]);
    const [card] = cardsFor(eventsToKanban([inbound]), inbound.external_conversation_id);
    assert.equal(conversation.contact, validName);
    assert.equal(card.title, validName);
  }

  const namedInbound = event({
    id: 'identity-useful-old',
    external_conversation_id: 'identity-useful-chat',
    contact_handle: phone,
    contact_name: 'Márcio veja meus status',
    direction: 'inbound',
    sender_type: 'contact',
    created_at: '2026-10-02T10:00:00.000Z',
  });
  const emojiInbound = event({
    id: 'identity-emoji-new',
    external_conversation_id: 'identity-useful-chat',
    contact_handle: phone,
    contact_name: '🌙',
    direction: 'inbound',
    sender_type: 'contact',
    created_at: '2026-10-02T10:01:00.000Z',
  });
  const [conversation] = eventsToConversations([namedInbound, emojiInbound]);
  const [card] = cardsFor(eventsToKanban([namedInbound, emojiInbound]), 'identity-useful-chat');
  assert.equal(conversation.contact, '🌙');
  assert.equal(card.title, '🌙');

  const realtime = applyIncomingEventToConversations(
    eventsToConversations([namedInbound]),
    { ...emojiInbound, contact_name: '...' },
  );
  assert.equal(realtime[0].contact, 'Márcio veja meus status');
});

test('contact display fallback derives WhatsApp phone from external_conversation_id when handle is absent', () => {
  const cases = [
    { contact_name: '..', external_conversation_id: '5521959261839@s.whatsapp.net', expected: '+55 (21) 95926-1839' },
    { contact_name: '🌙', external_conversation_id: '5521985198468@s.whatsapp.net', expected: '🌙' },
    { contact_name: '5521985198468', external_conversation_id: '5521985198468@s.whatsapp.net', expected: '+55 (21) 98519-8468' },
  ];

  for (const item of cases) {
    const inbound = event({
      id: `identity-jid-${item.contact_name}`,
      external_conversation_id: item.external_conversation_id,
      contact_handle: null,
      contact_name: item.contact_name,
      direction: 'inbound',
      sender_type: 'contact',
    });
    const [conversation] = eventsToConversations([inbound]);
    const [card] = cardsFor(eventsToKanban([inbound]), item.external_conversation_id);
    assert.equal(conversation.contact, item.expected);
    assert.equal(card.title, item.expected);
  }

  const missingIdentifier = event({
    id: 'identity-missing-identifier',
    external_conversation_id: '',
    contact_handle: null,
    contact_name: '...',
    direction: 'inbound',
    sender_type: 'contact',
  });
  const [conversation] = eventsToConversations([missingIdentifier]);
  const [card] = cardsFor(eventsToKanban([missingIdentifier]), '');
  assert.equal(conversation.contact, 'Contato WhatsApp');
  assert.equal(card.title, 'Contato WhatsApp');
});

test('Cenário A: getStageLabel resolves Genesis stages for wesley_automoveis', () => {
  const ctx = { tenantSlug: 'wesley_automoveis' };
  assert.equal(getStageLabel('sales_appraisal', ctx), 'Avaliacao de retoma - Compra');
  assert.equal(getStageLabel('sales_new', ctx), 'Patio - Novos contatos');
  assert.equal(getStageLabel('sales_qualifying', ctx), 'IA - Qualificacao automotiva');
  assert.equal(getStageLabel('sales_hot', ctx), 'Leads quentes - Venda');
  assert.equal(getStageLabel('sales_human', ctx), 'Atendimento humano');
  assert.equal(getStageLabel('sales_financing', ctx), 'Fila de financiamento');
  assert.equal(getStageLabel('sales_after_sales', ctx), 'Pos-venda - Manutencao');
  assert.equal(getStageLabel('sales_closed', ctx), 'Negocio fechado');
});

test('Cenário B: outro tenant com sales_appraisal e nome customizado mostra nome customizado', () => {
  const customSettings = {
    sales: {
      stages: {
        sales_appraisal: { name: 'Avaliação personalizada' },
      },
    },
  };
  assert.equal(
    getStageLabel('sales_appraisal', { tenantSlug: 'clinica_estetica', tenantSettings: customSettings }),
    'Avaliação personalizada'
  );
  const customCols = [{ id: 'sales_appraisal', title: 'Avaliação personalizada de coluna' }];
  assert.equal(
    getStageLabel('sales_appraisal', { tenantSlug: 'clinica_estetica', kanbanColumns: customCols }),
    'Avaliação personalizada de coluna'
  );
});

test('Cenário C: outro tenant com sales_appraisal SEM tenantSettings NÃO recebe label específico da Genesis', () => {
  // Outro tenant sem tenantSettings nem colunas
  const result = getStageLabel('sales_appraisal', { tenantSlug: 'universo_prata' });
  // Deve NÃO ser o nome da Genesis
  assert.notEqual(result, 'Avaliacao de retoma - Compra');
  // Deve cair no fallback limpo (Title Case)
  assert.equal(result, 'Sales Appraisal');

  // Outro tenant com sales_new sem settings também não pode receber "Patio - Novos contatos"
  const newResult = getStageLabel('sales_new', { tenantSlug: 'clinica_nubia' });
  assert.notEqual(newResult, 'Patio - Novos contatos');
  assert.equal(newResult, 'Sales New');
});

test('Cenário D: string já amigável deve ser preservada', () => {
  assert.equal(getStageLabel('Atendimento humano'), 'Atendimento humano');
  assert.equal(getStageLabel('Leads quentes - Venda'), 'Leads quentes - Venda');
  assert.equal(getStageLabel('Avaliação personalizada'), 'Avaliação personalizada');
  assert.equal(getStageLabel('Qualificação'), 'Qualificação');
});

test('Cenário E: chaves técnicas usadas internamente permanecem técnicas na lógica', () => {
  const lead = genesisLead('sales_appraisal', { chat_id: 'chat-appr' });
  const e = event({ id: 'ev-appr', external_conversation_id: 'chat-appr', stage: 'sales_appraisal' });
  const kanban = eventsToKanban([e], 'wesley_automoveis', [], genesisColumns, [], [lead]);
  const card = cardsFor(kanban, 'chat-appr')[0];
  assert.ok(card);
  // Preservação estrita das chaves de máquina para RPCs e operações backend
  assert.equal(card.salesStageKey, 'sales_appraisal');
  assert.equal(card.targetColumnId, 'sales_appraisal');
  // Apresentação amigável resolvida para o tenant Genesis
  assert.equal(card.stage, 'Avaliacao de retoma - Compra');

  const convs = eventsToConversations([e], 'wesley_automoveis', controlAgents, kanban);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].salesStageKey, 'sales_appraisal');
  assert.equal(convs[0].stage, 'Avaliacao de retoma - Compra');
});

test('normalizeStage atua estritamente como categorizador semântico interno', () => {
  assert.equal(normalizeStage('sales_human'), 'Atendimento humano');
  assert.equal(normalizeStage('atendimento_humano'), 'Atendimento humano');
  assert.equal(normalizeStage('sales_closed'), 'Finalizado');
  assert.equal(normalizeStage('finalizado'), 'Finalizado');
  assert.equal(normalizeStage('Finalizada'), 'Finalizado');
  assert.equal(normalizeStage('sales_qualifying'), 'Qualificação');
  assert.equal(normalizeStage('reset'), 'Qualificação');
  assert.equal(normalizeStage('/reset'), 'Qualificação');
  assert.equal(normalizeStage('Fora de contexto'), 'Fora de contexto');
  assert.equal(normalizeStage('verificar sinal'), 'Verificar Sinal');
});

test('getStageLabel prioritizes tenant configured Kanban column titles', () => {
  const customColumns = [
    { id: 'sales_appraisal', automationKey: 'sales_appraisal', title: 'Avaliação VIP de Veículo' },
    { id: 'sales_new', automationKey: 'sales_new', title: 'Recepção e Entrada' },
  ];
  assert.equal(
    getStageLabel('sales_appraisal', { kanbanColumns: customColumns }),
    'Avaliação VIP de Veículo'
  );
  assert.equal(
    getStageLabel('sales_new', { kanbanColumns: customColumns }),
    'Recepção e Entrada'
  );
});

test('getStageLabel prioritizes tenantSettings if kanbanColumns is absent', () => {
  const tenantSettings = {
    sales: {
      stages: {
        sales_appraisal: { name: 'Avaliação Customizada' },
        custom_stage_x: { name: 'Etapa Customizada X' },
      },
    },
  };
  assert.equal(
    getStageLabel('sales_appraisal', { tenantSettings }),
    'Avaliação Customizada'
  );
  assert.equal(
    getStageLabel('custom_stage_x', { tenantSettings }),
    'Etapa Customizada X'
  );
});

test('getStageLabel preserves and normalizes legacy stages and prevents raw technical leaks', () => {
  assert.equal(getStageLabel('finalizado'), 'Finalizado');
  assert.equal(getStageLabel('Finalizada'), 'Finalizado');
  assert.equal(getStageLabel('qualificacao'), 'Qualificação');
  assert.equal(getStageLabel('aguardando_humano'), 'Atendimento humano');
  // Unknown snake_case keys get converted to Title Case
  assert.equal(getStageLabel('unmapped_partner_queue'), 'Unmapped Partner Queue');
});
