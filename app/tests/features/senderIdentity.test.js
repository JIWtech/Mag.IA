import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToConversations } from '../../src/dataService.js';

test('Genesis Automóveis: agent message with sent_by_user "Operador NORIA" does not produce "Recepção / Núbia"', () => {
  const events = [
    {
      id: 'evt-1',
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: 'chat-ian',
      contact_name: 'Ian Shtorache',
      contact_handle: '551199999999',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Operador NORIA',
      message_text: 'Ok, só um momento e já te respondo',
      stage: 'Atendimento humano',
      service: 'manual_reply',
      handoff: true,
      created_at: '2026-10-01T09:28:00Z',
      raw_payload: {},
    },
  ];

  const convs = eventsToConversations(events);
  assert.equal(convs.length, 1);
  const conv = convs[0];

  // Conversation owner should NOT be 'Recepção / Núbia'
  assert.notEqual(conv.owner, 'Recepção / Núbia');
  assert.ok(conv.owner === null || conv.owner === 'Sem responsável');

  // Message sent_by must preserve the actual sender from the event
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.messages[0].sent_by, 'Operador NORIA');
  assert.equal(conv.messages[0].from, 'agent');
  assert.equal(conv.messages[0].text, 'Ok, só um momento e já te respondo');
});

test('Genesis Automóveis: assigned attendant via assignee payload is respected without leaking Núbia', () => {
  const events = [
    {
      id: 'evt-assign',
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: 'chat-ian',
      contact_name: 'Ian Shtorache',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley Silva',
      message_text: 'Conversa atribuida a Wesley Silva',
      stage: 'Atendimento humano',
      service: 'assign_conversation',
      handoff: true,
      created_at: '2026-10-01T09:27:00Z',
      raw_payload: { assignee: { id: 'agent-1', name: 'Wesley Silva', role: 'Vendedor' } },
    },
    {
      id: 'evt-reply',
      tenant_id: '74b57037-9349-4a9e-889c-b65fb63c983a',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: 'chat-ian',
      contact_name: 'Ian Shtorache',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Wesley Silva',
      message_text: 'Olá Ian, tenho o Palio disponível!',
      stage: 'Atendimento humano',
      service: 'manual_reply',
      handoff: true,
      created_at: '2026-10-01T09:28:00Z',
      raw_payload: {},
    },
  ];

  const convs = eventsToConversations(events);
  assert.equal(convs.length, 1);
  const conv = convs[0];

  assert.equal(conv.owner, 'Wesley Silva');
  assert.notEqual(conv.owner, 'Recepção / Núbia');
  assert.equal(conv.messages[1].sent_by, 'Wesley Silva');
});

test('Clínica Núbia: attendant messages preserve Núbia identity', () => {
  const events = [
    {
      id: 'evt-nubia-1',
      tenant_slug: 'clinica_nubia',
      channel_type: 'whatsapp',
      external_conversation_id: 'chat-cliente',
      contact_name: 'Maria Silva',
      direction: 'outbound',
      sender_type: 'agent',
      sent_by_user: 'Núbia Santos',
      message_text: 'Olá Maria, horário confirmado!',
      stage: 'Atendimento humano',
      service: 'manual_reply',
      handoff: true,
      created_at: '2026-10-01T09:00:00Z',
      raw_payload: {},
    },
  ];

  const convs = eventsToConversations(events);
  assert.equal(convs.length, 1);
  const conv = convs[0];

  assert.equal(conv.owner, 'Núbia Santos');
  assert.equal(conv.messages[0].sent_by, 'Núbia Santos');
});

test('AI attendance sets owner to "Assistente IA"', () => {
  const events = [
    {
      id: 'evt-ai-1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: 'chat-novo',
      contact_name: 'Novo Cliente',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Quero comprar um carro',
      response_text: 'Olá! Como posso ajudar você hoje?',
      stage: 'Qualificação',
      service: 'general',
      handoff: false,
      created_at: '2026-10-01T08:00:00Z',
      raw_payload: {},
    },
  ];

  const convs = eventsToConversations(events);
  assert.equal(convs.length, 1);
  const conv = convs[0];

  assert.equal(conv.owner, 'Assistente IA');
  assert.equal(conv.status, 'ia_ativa');
});
