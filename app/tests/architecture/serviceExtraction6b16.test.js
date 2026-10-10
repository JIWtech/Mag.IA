import test from 'node:test';
import assert from 'node:assert/strict';

import { applyIncomingEventToConversations as applyFromFacade } from '../../src/dataService.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';

const event = (overrides = {}) => ({
  id: 'event-1',
  tenant_slug: 'tenant-a',
  channel_type: 'whatsapp',
  external_conversation_id: '5511999990001@s.whatsapp.net',
  contact_handle: '5511999990001',
  contact_name: 'Cliente A',
  direction: 'inbound',
  sender_type: 'contact',
  stage: 'Qualificação',
  service: 'geral',
  message_text: 'Olá',
  created_at: '2026-10-09T10:00:00.000Z',
  raw_payload: {},
  ...overrides,
});

test('6B.16: extracted incremental applier matches facade for creation, duplicate, out-of-order and tenant isolation', () => {
  const first = event();
  const duplicate = event();
  const older = event({ id: 'event-older', message_text: 'Mensagem antiga', created_at: '2026-10-09T09:00:00.000Z' });
  const foreign = event({ id: 'event-foreign', tenant_slug: 'tenant-b', external_conversation_id: '5511888880002@s.whatsapp.net' });

  const direct = [first, duplicate, older, foreign].reduce(
    (conversations, incoming) => applyIncomingEventToConversations(conversations, incoming, 'tenant-a'),
    [],
  );
  const facade = [first, duplicate, older, foreign].reduce(
    (conversations, incoming) => applyFromFacade(conversations, incoming, 'tenant-a'),
    [],
  );

  assert.deepEqual(direct, facade);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].messages.length, 2);
  assert.equal(direct[0].lastMessage, 'Olá');
  assert.equal(direct[0].unread, 2);
});

test('6B.16: extracted incremental applier preserves operational rejection, media enrichment, owner and read contracts', () => {
  const initial = applyIncomingEventToConversations([], event({ id: 'base', handoff: true, raw_payload: { assignee: { id: 'agent-1', name: 'Wesley' } } }), 'tenant-a');
  const enriched = event({
    id: 'media-1',
    direction: 'outbound', sender_type: 'agent', sent_by_user: 'Wesley', delivery_status: 'sent',
    message_text: '[image]', created_at: '2026-10-09T10:01:00.000Z',
    raw_payload: { media: { kind: 'image', origin: 'outbound', url: 'https://cdn.example.test/image.jpg' } },
  });
  const operational = event({ id: 'op-1', service: 'kanban_move', is_internal: true, created_at: '2026-10-09T10:02:00.000Z' });

  const direct = applyIncomingEventToConversations(initial, enriched, 'tenant-a', { markIncomingAsRead: true });
  const unchanged = applyIncomingEventToConversations(direct, operational, 'tenant-a');
  const facade = applyFromFacade(initial, enriched, 'tenant-a', { markIncomingAsRead: true });

  assert.deepEqual(direct, facade);
  assert.equal(direct[0].owner, 'Wesley');
  assert.equal(direct[0].messages.at(-1).media.kind, 'image');
  assert.equal(direct[0].unread, 1);
  assert.equal(unchanged, direct);
});
