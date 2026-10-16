import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalConversationKey,
  normalizeExternalConversationId,
} from '../../src/dataService.js';

test('conversation identity: preserves channel normalization through canonical keys', () => {
  assert.equal(
    canonicalConversationKey(' WHATSAPP ', '5511999999999'),
    ' whatsapp ::5511999999999',
  );
  assert.equal(
    canonicalConversationKey(undefined, 'Chat-ABC'),
    'telegram::chat-abc',
  );
  assert.equal(
    canonicalConversationKey('manual', 'case-42'),
    'manual::case-42',
  );
});

test('conversation identity: preserves external identifiers and fallbacks through the facade', () => {
  assert.equal(normalizeExternalConversationId('whatsapp', '5511999999999@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
  assert.equal(normalizeExternalConversationId('whatsapp', '123456789@lid'), '123456789@lid');
  assert.equal(normalizeExternalConversationId('whatsapp', null, '5511988888888@s.whatsapp.net'), '5511988888888@s.whatsapp.net');
  assert.equal(normalizeExternalConversationId('instagram_direct', ' Profile.Name '), 'profile.name');
  assert.equal(normalizeExternalConversationId('whatsapp', undefined), '');

  // Normalização do 9º dígito em celulares brasileiros (12 dígitos para 13 dígitos)
  assert.equal(normalizeExternalConversationId('whatsapp', '552187654321@s.whatsapp.net'), '5521987654321@s.whatsapp.net');
  assert.equal(normalizeExternalConversationId('whatsapp', '552187654321'), '5521987654321@s.whatsapp.net');
  assert.equal(normalizeExternalConversationId('whatsapp', '5521987654321'), '5521987654321@s.whatsapp.net');

  // Telefones fixos (dígito 2, 3, 4, 5) NÃO recebem o nono dígito
  assert.equal(normalizeExternalConversationId('whatsapp', '552126832762@s.whatsapp.net'), '552126832762@s.whatsapp.net');
});
