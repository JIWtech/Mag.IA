import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConversationReadState,
  conversationReadKey,
  getLatestReadableEvent,
  isUnreadInboundEvent,
  shouldAdvanceConversationRead,
  upsertConversationReadMarker,
} from '../../src/dataService.js';

const marker = {
  tenant_id: 'tenant-a',
  user_id: 'user-a',
  channel_type: 'whatsapp',
  external_conversation_id: '5511999999999',
  last_read_event_id: 'read-1',
  last_read_at: '2026-10-01T10:00:00.000Z',
};

test('read helpers: keys preserve tenant, user, channel, and conversation isolation', () => {
  const base = conversationReadKey('tenant-a', 'user-a', 'whatsapp', '5511999999999');
  assert.notEqual(base, conversationReadKey('tenant-b', 'user-a', 'whatsapp', '5511999999999'));
  assert.notEqual(base, conversationReadKey('tenant-a', 'user-b', 'whatsapp', '5511999999999'));
  assert.notEqual(base, conversationReadKey('tenant-a', 'user-a', 'telegram', '5511999999999'));
  assert.notEqual(base, conversationReadKey('tenant-a', 'user-a', 'whatsapp', '5511988888888'));
  assert.equal(conversationReadKey('', '', '', ''), '::telegram:unknown');
});

test('read helpers: inbound eligibility preserves operational, duplicate, and read-at-arrival exclusions', () => {
  const inbound = { direction: 'inbound', sender_type: 'contact' };
  assert.equal(isUnreadInboundEvent(inbound), true);
  assert.equal(isUnreadInboundEvent({ ...inbound, direction: 'outbound' }), false);
  assert.equal(isUnreadInboundEvent({ ...inbound, sender_type: 'system' }), false);
  assert.equal(isUnreadInboundEvent({ direction: 'internal', sender_type: 'system', raw_payload: { event_type: 'kanban_stage_changed', is_internal: true } }), false);
  assert.equal(isUnreadInboundEvent(inbound, { eventAlreadyPresent: true }), false);
  assert.equal(isUnreadInboundEvent(inbound, { markIncomingAsRead: true }), false);
});

test('read helpers: select newest readable event and preserve temporal advance rules', () => {
  const latest = getLatestReadableEvent({ messages: [
    { eventId: 'old', createdAt: '2026-10-01T09:00:00.000Z' },
    { eventId: 'response-response', createdAt: '2026-10-01T11:00:00.000Z' },
    { eventId: 'new', createdAt: '2026-10-01T10:00:00.000Z' },
    { eventId: 'same-time', createdAt: '2026-10-01T10:00:00.000Z' },
  ] });
  assert.equal(latest.eventId, 'same-time');
  assert.equal(getLatestReadableEvent({ messages: [] }), null);
  assert.equal(shouldAdvanceConversationRead(null, latest), true);
  assert.equal(shouldAdvanceConversationRead(marker, { eventId: 'older', createdAt: '2026-10-01T09:00:00.000Z' }), false);
  assert.equal(shouldAdvanceConversationRead(marker, { eventId: 'read-1', createdAt: marker.last_read_at }), false);
  assert.equal(shouldAdvanceConversationRead(marker, { eventId: 'same-time-new-id', createdAt: marker.last_read_at }), true);
  assert.equal(shouldAdvanceConversationRead(marker, { eventId: 'invalid', createdAt: 'invalid' }), true);
});

test('read helpers: marker upsert rejects regressions and keeps independent marker records', () => {
  const stale = { ...marker, last_read_event_id: 'old', last_read_at: '2026-10-01T09:00:00.000Z' };
  const otherUser = { ...marker, user_id: 'user-b' };
  assert.deepEqual(upsertConversationReadMarker([marker], stale), [marker]);
  assert.deepEqual(upsertConversationReadMarker([marker], otherUser), [marker, otherUser]);
  assert.deepEqual(upsertConversationReadMarker([], marker), [marker]);
});

test('read helpers: applying markers recalculates unread without mutating source conversations', () => {
  const conversations = [{
    id: 'conversation-1',
    channelType: 'whatsapp',
    externalConversationId: '5511999999999',
    messages: [
      { from: 'contact', eventId: 'read-1', createdAt: '2026-10-01T10:00:00.000Z' },
      { from: 'contact', eventId: 'new-1', createdAt: '2026-10-01T10:01:00.000Z' },
      { from: 'agent', eventId: 'sent-1', createdAt: '2026-10-01T10:02:00.000Z' },
    ],
  }];
  const result = applyConversationReadState(conversations, [marker], 'tenant-a', 'user-a');
  assert.equal(result[0].unread, 1);
  assert.equal(conversations[0].unread, undefined);
  assert.equal(applyConversationReadState(conversations, [marker], 'tenant-b', 'user-a')[0].unread, 2);
});
