import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPhoneFallback, formatWhatsAppPhone } from '../../src/dataService.js';

test('contact phones: formats Brazilian, partial, punctuated, and empty values', () => {
  assert.equal(formatWhatsAppPhone('5521992988071'), '+55 (21) 99298-8071');
  assert.equal(formatWhatsAppPhone('(21) 99298-8071'), '+21992988071');
  assert.equal(formatWhatsAppPhone('123'), '+123');
  assert.equal(formatWhatsAppPhone(null), '');
  assert.equal(formatWhatsAppPhone(undefined), '');
});

test('contact phones: finds WhatsApp numbers but excludes LIDs and other channels', () => {
  assert.equal(conversationPhoneFallback({ channel_type: 'whatsapp', external_conversation_id: '5511999999999@s.whatsapp.net' }), '5511999999999');
  assert.equal(conversationPhoneFallback({ channel: 'whatsapp', contact_handle: '5511888888888' }), '5511888888888');
  assert.equal(conversationPhoneFallback({ channel_type: 'whatsapp', external_conversation_id: '123456789@lid' }), '');
  assert.equal(conversationPhoneFallback({ channel_type: 'telegram', external_conversation_id: '5511999999999' }), '');
  assert.equal(conversationPhoneFallback({}), '');
});
