import test from 'node:test';
import assert from 'node:assert/strict';

import { applyIncomingEventToKanban as applyFromFacade } from '../../src/dataService.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';

const event = (overrides = {}) => ({
  id: 'card-event-1', tenant_slug: 'wesley_automoveis', channel_type: 'whatsapp',
  external_conversation_id: '5511999990001@s.whatsapp.net', contact_handle: '5511999990001',
  direction: 'inbound', sender_type: 'contact', service: 'geral', stage: 'sales_new',
  message_text: 'Mensagem recente', created_at: '2026-10-09T10:00:00.000Z', raw_payload: {},
  ...overrides,
});

const columns = [{
  id: 'sales_new', cards: [{
    id: 'conv-whatsapp:5511999990001@s.whatsapp.net:wesley_automoveis',
    canonicalKey: 'whatsapp:5511999990001@s.whatsapp.net:wesley_automoveis',
    externalConversationId: '5511999990001@s.whatsapp.net', normalizedExternalId: '5511999990001',
    owner: 'Assistente IA', ownerKind: 'ai', subtitle: 'Anterior', lastActivityAt: '2026-10-09T09:00:00.000Z',
  }],
}];

test('6B.17: extracted Kanban applier matches facade for cards, duplicates, out-of-order and tenant isolation', () => {
  const sequence = [
    event(),
    event(),
    event({ id: 'card-event-old', message_text: 'Antiga', created_at: '2026-10-09T08:00:00.000Z' }),
    event({ id: 'card-event-foreign', tenant_slug: 'clinica_nubia_oficial', external_conversation_id: '5511888880002@s.whatsapp.net' }),
  ];
  const direct = sequence.reduce((state, incoming) => applyIncomingEventToKanban(state, incoming, 'wesley_automoveis'), columns);
  const facade = sequence.reduce((state, incoming) => applyFromFacade(state, incoming, 'wesley_automoveis'), columns);

  assert.deepEqual(direct, facade);
  assert.equal(direct[0].cards[0].subtitle, 'Antiga');
  assert.equal(direct[0].cards[0].lastActivityAt, '2026-10-09T08:00:00.000Z');
});

test('6B.17: extracted Kanban applier keeps human assignment, media preview and operational events contracts', () => {
  const assigned = event({
    id: 'card-assigned', direction: 'outbound', sender_type: 'agent', service: 'conversation_assigned', handoff: true,
    message_text: '[image]', raw_payload: { assignee: { id: 'agent-1', name: 'Wesley' }, media: { kind: 'image', origin: 'outbound', url: 'https://cdn.example.test/image.jpg' } },
  });
  const operational = event({ id: 'card-op', is_internal: true, service: 'kanban_move' });
  const direct = applyIncomingEventToKanban(columns, assigned, 'wesley_automoveis', [{ id: 'agent-1', name: 'Wesley', is_active: true }]);
  const unchanged = applyIncomingEventToKanban(direct, operational, 'wesley_automoveis');

  assert.deepEqual(direct, applyFromFacade(columns, assigned, 'wesley_automoveis', [{ id: 'agent-1', name: 'Wesley', is_active: true }]));
  assert.equal(direct[0].cards[0].owner, 'Wesley');
  assert.equal(direct[0].cards[0].ownerKind, 'agent');
  assert.equal(direct[0].cards[0].subtitle, '[image]');
  assert.equal(unchanged, direct);
});
