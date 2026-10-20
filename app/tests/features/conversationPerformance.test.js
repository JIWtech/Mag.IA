import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { enrichMediaUrls, clearMediaUrlCache } from '../../src/services/media/mediaUrlService.js';
import { loadConversationFullHistory, buildConversationIdVariants } from '../../src/services/conversations/conversationHistoryReads.js';

test('initial loading does not wait on storage signing', async () => {
  clearMediaUrlCache();
  let requests = 0;
  const rows = [{ id: 'image-1', direction: 'inbound', raw_payload: { media: { kind: 'image', status: 'stored', bucket: 'channel-media', storagePath: 'tenant/photo.jpg' } } }];
  const result = await enrichMediaUrls(rows, { storage: { from() { requests++; throw new Error('must not request storage'); } } }, { cacheOnly: true });
  assert.equal(requests, 0);
  assert.equal(result[0], rows[0]);
});

test('history reads latest events scoped to the tenant without signing every attachment', async () => {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'in', 'order']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.limit = async count => { calls.push(['limit', count]); return { data: [], error: null }; };
  await loadConversationFullHistory('tenant-a', '5511999990001', { from: () => query });
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'tenant_slug' && call[2] === 'tenant-a'));
  assert.deepEqual(calls.find(call => call[0] === 'order'), ['order', 'created_at', { ascending: false }]);
  assert.deepEqual(buildConversationIdVariants('12345678901@lid'), ['12345678901@lid']);
  assert.deepEqual(buildConversationIdVariants('12345678901@g.us'), ['12345678901@g.us']);
  query.limit = async () => ({ data: null, error: new Error('offline') });
  await assert.rejects(loadConversationFullHistory('tenant-a', '5511999990001', { from: () => query }), /offline/);
});

test('current human lead keeps the same owner on its card and conversation', () => {
  const events = [{ id: 'in-1', tenant_slug: 'wesley_automoveis', channel_type: 'whatsapp', external_conversation_id: '5511999990001', direction: 'inbound', sender_type: 'contact', message_text: 'Tenho interesse', stage: 'sales_new', created_at: '2026-10-20T10:00:00Z', raw_payload: {} }];
  const agents = [{ id: 'agent-w', name: 'Wesley', is_active: true }];
  const lead = { id: 'lead-1', channel_type: 'whatsapp', chat_id: '5511999990001@s.whatsapp.net', stage_key: 'sales_human', ai_locked: true, updated_at: '2026-10-20T10:01:00Z', state: {} };
  const columns = eventsToKanban(events, 'wesley_automoveis', [], null, [], [lead], agents);
  const card = columns.flatMap(column => column.cards)[0];
  const conversation = eventsToConversations(events, 'wesley_automoveis', agents, columns)[0];
  assert.equal(card.salesLeadId, 'lead-1');
  assert.equal(conversation.status, 'atendimento_humano');
  assert.equal(conversation.owner, card.owner);
  assert.equal(conversation.ownerKind, card.ownerKind);
  assert.equal(conversation.ownerId, card.ownerId);
});
