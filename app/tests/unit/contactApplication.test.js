import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContactAvatars,
  applyContactAvatarsToBroadcastContacts,
  applyContactDirectory,
  resolveContactAvatarState,
} from '../../src/dataService.js';

test('contact application: favors the tenant-scoped directory entry and falls back to the unscoped entry', () => {
  const index = new Map([
    ['tenant-a:whatsapp:5511999999999@s.whatsapp.net', { name: 'Alice tenant A', avatarUrl: 'https://cdn.example.com/alice-a.png' }],
    ['whatsapp:5511999999999@s.whatsapp.net', { name: 'Alice fallback', avatarUrl: 'https://cdn.example.com/alice-fallback.png' }],
  ]);
  const [scoped] = applyContactDirectory([{
    id: 'event-a', tenant_id: 'tenant-a', channel_type: 'whatsapp', external_conversation_id: '5511999999999', contact_name: 'Known inbound name',
  }], index);
  const [fallback] = applyContactDirectory([{
    id: 'event-b', tenant_id: 'tenant-b', channel_type: 'whatsapp', external_conversation_id: '5511999999999',
  }], index);

  assert.equal(scoped.avatar_url, 'https://cdn.example.com/alice-a.png');
  assert.equal(scoped.contact_name_canonical, 'Alice tenant A');
  assert.equal(fallback.avatar_url, 'https://cdn.example.com/alice-fallback.png');
  assert.equal(fallback.contact_name_canonical, 'Alice fallback');
});

test('contact application: keeps channels and WhatsApp LIDs isolated and leaves missing contacts unchanged', () => {
  const index = new Map([
    ['whatsapp:123456789@lid', { name: 'Lid contact', avatarUrl: 'https://cdn.example.com/lid.png' }],
    ['telegram:123456789@lid', { name: 'Telegram contact', avatarUrl: 'https://cdn.example.com/telegram.png' }],
  ]);
  const events = [
    { id: 'lid', channel_type: 'whatsapp', external_conversation_id: '123456789@lid' },
    { id: 'telegram', channel_type: 'telegram', external_conversation_id: '123456789@lid' },
    { id: 'missing', channel_type: 'whatsapp', external_conversation_id: 'not-found', avatar_url: 'https://cdn.example.com/existing.png' },
  ];
  const applied = applyContactAvatars(events, index, 'tenant-missing');

  assert.equal(applied[0].contact_name_canonical, 'Lid contact');
  assert.equal(applied[1].contact_name_canonical, 'Telegram contact');
  assert.equal(applied[2].avatar_url, 'https://cdn.example.com/existing.png');
  assert.notEqual(applied, events);
});

test('contact application: enriches broadcast recipients without dropping fields and clears unresolved avatar URLs', () => {
  const index = new Map([
    ['tenant-a:whatsapp:5511888888888@s.whatsapp.net', { name: 'Broadcast Alice', avatarUrl: 'https://cdn.example.com/broadcast.png' }],
  ]);
  const contacts = [
    { id: 'recipient-a', tenant_id: 'tenant-a', channel_type: 'whatsapp', external_conversation_id: '5511888888888', segment: 'vip' },
    { id: 'recipient-b', tenant_id: 'tenant-b', channelType: 'telegram', externalConversationId: 'chat-2', avatarUrl: 'https://cdn.example.com/stale.png', segment: 'new' },
  ];
  const applied = applyContactAvatarsToBroadcastContacts(contacts, index);

  assert.deepEqual(applied[0], { ...contacts[0], name: 'Broadcast Alice', avatarUrl: 'https://cdn.example.com/broadcast.png' });
  assert.deepEqual(applied[1], { ...contacts[1], avatarUrl: null });
  assert.deepEqual(applyContactAvatarsToBroadcastContacts([], index, 'tenant-a'), []);
});

test('contact application: avatar state preserves failures for the same valid URL and resets them for a changed or invalid URL', () => {
  assert.deepEqual(resolveContactAvatarState(), { failed: false, url: null, shouldRenderImage: false });
  assert.deepEqual(resolveContactAvatarState({
    currentFailed: true,
    prevUrl: 'https://cdn.example.com/a.png',
    nextUrl: 'https://cdn.example.com/a.png',
  }), { failed: true, url: null, shouldRenderImage: false });
  assert.deepEqual(resolveContactAvatarState({
    currentFailed: true,
    prevUrl: 'https://cdn.example.com/a.png',
    nextUrl: 'https://cdn.example.com/b.png',
  }), { failed: false, url: 'https://cdn.example.com/b.png', shouldRenderImage: true });
  assert.deepEqual(resolveContactAvatarState({ currentFailed: true, prevUrl: 'https://cdn.example.com/a.png', nextUrl: 'http://invalid.example.com/a.png' }), {
    failed: false, url: null, shouldRenderImage: false,
  });
});
