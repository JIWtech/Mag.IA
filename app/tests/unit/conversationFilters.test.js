import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isConversationWaitingForFollowUp,
  formatWaitingDuration,
  matchesResponsibleFilter,
  matchesConversationTab,
  sortConversationsForTab,
  getConversationTabCounts,
  formatConversationCardOrigin,
  formatMediaPreviewWithIcon,
} from '../../src/dataService.js';

test('conversation filters: preserve follow-up, duration, and responsible contracts through the facade', () => {
  const waiting = {
    latestFollowUpAt: '2026-10-06T13:00:00.000Z',
    latestCustomerInboundAt: '2026-10-06T10:00:00.000Z',
  };
  const closed = { ...waiting, status: 'finalizado' };
  const ai = { status: 'ia_ativa', owner: 'Assistente IA', ownerKind: 'ai' };
  const human = { status: 'atendimento_humano', owner: 'Wesley', ownerId: 'agent-1', ownerKind: 'agent' };

  assert.equal(isConversationWaitingForFollowUp(waiting), true);
  assert.equal(isConversationWaitingForFollowUp(closed), false);
  assert.equal(formatWaitingDuration('2026-10-06T14:45:00.000Z', Date.parse('2026-10-06T15:00:00.000Z')), 'Aguardando cliente há 15m');
  assert.equal(formatWaitingDuration(undefined, Date.parse('2026-10-06T15:00:00.000Z')), 'Aguardando cliente');
  assert.equal(matchesResponsibleFilter(ai, 'ia'), true);
  assert.equal(matchesResponsibleFilter(human, 'humano'), true);
  assert.equal(matchesResponsibleFilter(human, 'AGENT-1'), true);
  assert.equal(matchesResponsibleFilter({}, 'ia'), true);
});

test('conversation filters: preserve tab, count, and sorting contracts through the facade', () => {
  const active = { id: 'active', status: 'ia_ativa', unread: 1, lastActivityAt: '2026-10-06T13:00:00.000Z' };
  const followUp = { id: 'follow-up', status: 'ia_ativa', waitingForFollowUp: true, waitingSince: '2026-10-06T12:00:00.000Z', lastActivityAt: '2026-10-06T14:00:00.000Z' };
  const closed = { id: 'closed', status: 'finalizado', waitingForFollowUp: true, unread: 3, lastActivityAt: '2026-10-06T15:00:00.000Z' };
  const sameTimeA = { id: 'same-a', lastActivityAt: '2026-10-06T10:00:00.000Z' };
  const sameTimeB = { id: 'same-b', lastActivityAt: '2026-10-06T10:00:00.000Z' };

  assert.equal(matchesConversationTab(active, 'ativas'), true);
  assert.equal(matchesConversationTab(followUp, 'follow_up'), true);
  assert.equal(matchesConversationTab(closed, 'encerradas'), true);
  assert.equal(matchesConversationTab(closed, 'nao_lidas'), false);
  assert.deepEqual(getConversationTabCounts([active, followUp, closed]), {
    ativas: 1,
    naoLidas: 1,
    followUp: 1,
    encerradas: 1,
    activeCount: 1,
    unreadCount: 1,
    closedCount: 1,
    followUpCount: 1,
  });
  assert.deepEqual(sortConversationsForTab([sameTimeA, sameTimeB], 'ativas').map(({ id }) => id), ['same-a', 'same-b']);
  assert.deepEqual(sortConversationsForTab([followUp, { ...active, waitingSince: '2026-10-06T11:00:00.000Z' }], 'follow_up').map(({ id }) => id), ['follow-up', 'active']);
  assert.deepEqual(sortConversationsForTab(null, 'ativas'), []);
});

test('conversation filters: preserve card-origin and media-preview fallbacks through the facade', () => {
  assert.equal(formatConversationCardOrigin({ waitingForFollowUp: true, lastMessageSenderType: 'ai' }), 'Follow-up');
  assert.equal(formatConversationCardOrigin({ lastMessageSenderType: 'agent' }), 'Você');
  assert.equal(formatConversationCardOrigin({}), 'Cliente');
  assert.deepEqual(formatMediaPreviewWithIcon('[image]: orçamento'), { icon: '📷', text: 'orçamento' });
  assert.deepEqual(formatMediaPreviewWithIcon('[document]'), { icon: '📄', text: 'Documento' });
  assert.deepEqual(formatMediaPreviewWithIcon(null), { icon: null, text: '' });
});
