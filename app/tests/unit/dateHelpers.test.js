import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, compareDateLabel } from '../../src/utils/dateFormatting.js';
import { appointmentTimestamp, isMoreRecentRecord } from '../../src/utils/recordRecency.js';

test('date helpers preserve missing, invalid, ordering, and locale-sensitive contracts', () => {
  assert.equal(formatDate(null), 'Agora');
  assert.equal(formatDate(undefined), 'Agora');
  assert.equal(formatDate('2026-10-09T13:45:00.000Z'), new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date('2026-10-09T13:45:00.000Z')));
  assert.equal(Number.isNaN(Date.parse('not-a-date')), true);
  assert.equal(compareDateLabel('2026-10-09T13:45:00.000Z', '2026-10-09T13:45:00.000Z'), 0);
  assert.equal(compareDateLabel(null, '2026-10-09T13:45:00.000Z') < 0, true);
  assert.equal(compareDateLabel('not-a-date', null), 0);
});

test('record recency preserves timestamp precedence, invalid values, and ties', () => {
  assert.equal(appointmentTimestamp({ raw: { updated_at: 'updated', occurred_at: 'occurred' }, updatedAt: 'fallback' }), 'updated');
  assert.equal(appointmentTimestamp({ createdAt: 'created' }), 'created');
  assert.equal(appointmentTimestamp(null), '');
  assert.equal(isMoreRecentRecord({ created_at: '2026-10-10T00:00:00.000Z' }, { created_at: '2026-10-09T00:00:00.000Z' }), true);
  assert.equal(isMoreRecentRecord({ created_at: '2026-10-09T00:00:00.000Z' }, { created_at: '2026-10-09T00:00:00.000Z' }), false);
  assert.equal(isMoreRecentRecord({ created_at: 'invalid' }, { created_at: '2026-10-09T00:00:00.000Z' }), false);
  assert.equal(isMoreRecentRecord({ createdAt: '2026-10-10T00:00:00.000Z' }, { createdAt: 'invalid' }), true);
});
