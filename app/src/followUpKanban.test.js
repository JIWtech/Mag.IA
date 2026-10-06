import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban, getKanbanColumnKind } from './dataService.js';

const config = { columns: [
  { id: 'qualifying', name: 'Qualificacao IA', automation_key: 'sales_qualifying', position: 1 },
  { id: 'follow', name: 'Follow Ups', automation_key: 'follow_ups', position: 9 },
] };
const job = (id, step, status = 'pending', hour = 12) => ({
  id, step_key: step, status, channel_type: 'whatsapp', external_conversation_id: 'test@s.whatsapp.net',
  contact_name: 'Contato teste', due_at: `2026-10-06T${hour}:00:00Z`, created_at: '2026-10-06T09:00:00Z',
});
const cards = (jobs, tenant = 'wesley_automoveis') => eventsToKanban([], tenant, [], config, jobs)
  .find(c => c.automationKey === 'follow_ups').cards;

test('Genesis displays one operational card for the next active follow-up, not three duplicates', () => {
  const result = cards([job('later', '24h', 'pending', 15), job('first', '3h')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'follow-up-first');
  assert.equal(result[0].followUpLabel, '3h');
  assert.equal(result[0].isFollowUp, true);
  assert.equal(getKanbanColumnKind(config.columns[1]), 'special_view');
});

test('completed/cancelled jobs disappear and next pending step is shown', () => {
  assert.equal(cards([job('sent', '3h', 'sent'), job('next', '24h')])[0].followUpLabel, '1 dia');
  assert.equal(cards([job('sent', '24h', 'sent'), job('next', '15d')])[0].followUpLabel, '15 dias');
  for (const status of ['sent', 'cancelled', 'failed', 'uncertain']) assert.equal(cards([job(status, '15d', status)]).length, 0);
});

test('processing takes priority; separate contacts have separate cards', () => {
  const result = cards([job('pending', '3h'), job('active', '24h', 'processing', 15),
    { ...job('other', '15d'), external_conversation_id: 'other@s.whatsapp.net' }]);
  assert.equal(result.length, 2);
  assert.ok(result.some(c => c.id === 'follow-up-active' && c.followUpStatus === 'processing'));
});

test('Nubia keeps the same view; unrelated tenants remain excluded', () => {
  assert.equal(cards([job('nb', '3h')], 'clinica_nubia_oficial').length, 1);
  assert.equal(cards([job('other', '3h')], 'another_tenant').length, 0);
});
