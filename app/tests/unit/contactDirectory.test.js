import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactAvatarIndex, buildContactDirectory } from '../../src/dataService.js';

test('contact directory: creates tenant-scoped and fallback entries while isolating another tenant', () => {
  const directory = buildContactDirectory([
    {
      id: 'contact-a',
      tenant_id: 'tenant-a',
      source_channel: 'whatsapp',
      external_handle: '5511999999999',
      name: '  Alice  ',
      avatar_url: 'https://cdn.example.com/alice.png',
    },
    {
      id: 'contact-b',
      tenant_id: 'tenant-b',
      source_channel: 'whatsapp',
      external_handle: '5511999999999',
      name: 'Bob',
      avatar_url: 'https://cdn.example.com/bob.png',
    },
  ], 'tenant-a');

  assert.equal(directory.size, 2);
  assert.deepEqual(directory.get('tenant-a:whatsapp:5511999999999@s.whatsapp.net'), {
    id: 'contact-a',
    name: 'Alice',
    avatarUrl: 'https://cdn.example.com/alice.png',
  });
  assert.deepEqual(directory.get('whatsapp:5511999999999@s.whatsapp.net'), {
    id: 'contact-a',
    name: 'Alice',
    avatarUrl: 'https://cdn.example.com/alice.png',
  });
});

test('contact directory: scopes contacts without a tenant to the requested tenant and retains invalid-avatar contacts', () => {
  const directory = buildContactDirectory([
    {
      id: 'contact-c',
      source_channel: 'telegram',
      external_handle: 'chat-1',
      name: '   ',
      avatarUrl: 'http://cdn.example.com/insecure.png',
    },
  ], 'tenant-a');

  assert.deepEqual(directory.get('tenant-a:telegram:chat-1'), {
    id: 'contact-c',
    name: null,
    avatarUrl: null,
  });
  assert.deepEqual(directory.get('telegram:chat-1'), {
    id: 'contact-c',
    name: null,
    avatarUrl: null,
  });
});

test('contact avatar index: includes only contacts with valid avatar URLs', () => {
  const avatars = buildContactAvatarIndex([
    {
      tenant_id: 'tenant-a',
      source_channel: 'whatsapp',
      external_handle: '5511888888888',
      avatar_url: 'https://cdn.example.com/valid.png',
    },
    {
      tenant_id: 'tenant-a',
      source_channel: 'telegram',
      external_handle: 'chat-2',
      avatar_url: 'not-a-url',
    },
  ], 'tenant-a');

  assert.equal(avatars.size, 2);
  assert.equal(avatars.get('tenant-a:whatsapp:5511888888888@s.whatsapp.net'), 'https://cdn.example.com/valid.png');
  assert.equal(avatars.get('whatsapp:5511888888888@s.whatsapp.net'), 'https://cdn.example.com/valid.png');
});
