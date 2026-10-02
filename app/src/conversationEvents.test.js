import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConversationEvents } from './conversationEvents.js';

const inbound = (extra = {}) => ({
  tenant_slug: 'loja', channel_type: 'whatsapp', external_conversation_id: 'chat1',
  id: 'in1', direction: 'inbound', external_message_id: 'msg1',
  message_text: 'Oi', response_text: 'Como posso ajudar?', created_at: '2026-09-21T12:00:00Z', ...extra,
});
const outbound = (extra = {}) => ({
  ...inbound(), id: 'out1', direction: 'outbound', external_message_id: 'msg1:reply',
  sender_type: 'assistant', message_text: 'Como posso ajudar?', response_text: null,
  created_at: '2026-09-21T12:00:02Z', ...extra,
});

test('shows one reply for an inbound response and its outbound event without mutating input', () => {
  const original = inbound();
  const result = prepareConversationEvents([outbound(), original]);
  assert.equal(result[1].response_text, null);
  assert.equal(original.response_text, 'Como posso ajudar?');
  assert.equal(result[0].message_text, original.response_text);
});
test('preserves legacy replies without a corresponding outbound', () => {
  assert.equal(prepareConversationEvents([inbound()])[0].response_text, 'Como posso ajudar?');
});
test('matches provider message IDs by text and time when no reply suffix exists', () => {
  assert.equal(prepareConversationEvents([outbound({ external_message_id: 'provider1' }), inbound()])[1].response_text, null);
});
test('never removes two genuine outbound messages with identical text', () => {
  const result = prepareConversationEvents([outbound(), outbound({ id: 'out2', external_message_id: 'msg2:reply' })]);
  assert.equal(result.length, 2);
});
test('does not match across tenants, channels, conversations, humans, or different requests', () => {
  for (const extra of [{ tenant_slug: 'outra' }, { channel_type: 'telegram' }, { external_conversation_id: 'chat2' }, { sender_type: 'agent' }]) {
    assert.ok(prepareConversationEvents([outbound(extra), inbound()])[1].response_text);
  }
  assert.ok(prepareConversationEvents([outbound({ external_message_id: 'other', request_id: 'r2' }), inbound({ request_id: 'r1' })])[1].response_text);
});
test('one outbound consumes only one inline reply; explicit links take precedence', () => {
  const result = prepareConversationEvents([inbound({ id: 'in2', external_message_id: 'msg2' }), inbound(), outbound()]);
  assert.ok(result[0].response_text);
  assert.equal(result[1].response_text, null);
});
test('deduplicates repeated event IDs while retaining opposite directions', () => {
  const result = prepareConversationEvents([inbound(), inbound(), outbound({ external_message_id: 'msg1' })]);
  assert.equal(result.length, 2);
});
test('keeps a reply if matching text is from a different time', () => {
  assert.ok(prepareConversationEvents([outbound({ external_message_id: 'other', created_at: '2026-09-22T12:00:00Z' }), inbound()])[1].response_text);
});
test('preserves human operator outbound messages (fromMe) and never dedupes them as inline replies', () => {
  const operatorEvent = outbound({
    id: 'op1',
    external_message_id: 'whatsapp_op_msg_123',
    sender_type: 'agent',
    message_text: 'Mensagem enviada pelo operador no celular WhatsApp',
    raw_payload: { fromMe: true, isFromMe: true },
  });
  const result = prepareConversationEvents([inbound(), operatorEvent]);
  assert.equal(result.length, 2);
  const opInResult = result.find((e) => e.id === 'op1');
  assert.ok(opInResult);
  assert.equal(opInResult.message_text, 'Mensagem enviada pelo operador no celular WhatsApp');
});
