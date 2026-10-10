import test from 'node:test';
import assert from 'node:assert/strict';
import { contactAvatarKey, normalizeAvatarUrl } from '../../src/dataService.js';

test('contact identity: preserves accepted avatar URLs and invalid fallbacks through the facade', () => {
  assert.equal(normalizeAvatarUrl(' https://cdn.example.com/avatar.png?size=64 '), 'https://cdn.example.com/avatar.png?size=64');
  assert.equal(normalizeAvatarUrl('http://cdn.example.com/avatar.png'), null);
  assert.equal(normalizeAvatarUrl('/avatar.png'), null);
  assert.equal(normalizeAvatarUrl(''), null);
  assert.equal(normalizeAvatarUrl(null), null);
  assert.equal(normalizeAvatarUrl(undefined), null);
});

test('contact identity: preserves tenant, channel, WhatsApp and lid key composition through the facade', () => {
  const tenantA = contactAvatarKey('whatsapp', '5511999999999', 'tenant-a');
  assert.equal(tenantA, 'tenant-a:whatsapp:5511999999999@s.whatsapp.net');
  assert.notEqual(tenantA, contactAvatarKey('whatsapp', '5511999999999', 'tenant-b'));
  assert.notEqual(tenantA, contactAvatarKey('telegram', '5511999999999', 'tenant-a'));
  assert.equal(contactAvatarKey('whatsapp', '123456789@lid', 'tenant-a'), 'tenant-a:whatsapp:123456789@lid');
  assert.equal(contactAvatarKey(' WHATSAPP ', '5511999999999', 'tenant-a'), 'tenant-a: whatsapp :5511999999999');
  assert.equal(contactAvatarKey('', '', ''), 'telegram:');
});
