import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAgentName, resolveConversationDisplayName } from '../../src/dataService.js';

test('contact presentation preserves canonical, phone and LID fallbacks', () => {
  assert.equal(resolveConversationDisplayName({ contact_name_canonical: '  Ana  ', channel_type: 'whatsapp' }, 'Fallback'), 'Ana');
  assert.equal(resolveConversationDisplayName({ channel_type: 'whatsapp', external_conversation_id: '5511999999999' }, 'Fallback'), '+55 (11) 99999-9999');
  assert.equal(resolveConversationDisplayName({ channel_type: 'whatsapp', external_conversation_id: '123@lid' }, 'Fallback'), 'Contato WhatsApp');
});

test('agent names retain real names and reject technical or company identities', () => {
  assert.equal(cleanAgentName('  Carlos  '), 'Carlos');
  assert.equal(cleanAgentName('Operador NORIA'), '');
  assert.equal(cleanAgentName('Gênesis Automóveis'), '');
  assert.equal(cleanAgentName('5511999999999@s.whatsapp.net'), '');
});
