import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTenantBySlug,
  loadAppointments,
  loadBroadcastCampaigns,
  loadBroadcastContacts,
  loadFollowUpJobs,
  loadKanbanConfig,
} from '../../src/services/tenants/tenantDataReads.js';

function fakeSupabase(responses) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const chain = {
        select(value) { query.calls.push(['select', value]); return chain; },
        eq(column, value) { query.calls.push(['eq', column, value]); return chain; },
        in(column, values) { query.calls.push(['in', column, values]); return chain; },
        order(column, options) { query.calls.push(['order', column, options]); return chain; },
        limit(value) { query.calls.push(['limit', value]); return chain; },
        maybeSingle() { query.calls.push(['maybeSingle']); return chain; },
        then(resolve, reject) { return Promise.resolve(responses[table] || { data: [], error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

test('tenant reads retain tenant filters, ordering, limits, and appointment mapping', async () => {
  const client = fakeSupabase({
    tenants: { data: { id: 'tenant-a', slug: 'alpha' }, error: null },
    appointments: { data: [{ id: 'appointment-a', tenant_id: 'tenant-a' }], error: null },
    broadcast_contacts: { data: [{ id: 'contact-a', tenant_id: 'tenant-a' }], error: null },
    broadcast_campaigns: { data: [{ id: 'campaign-a', tenant_id: 'tenant-a' }], error: null },
  });

  assert.equal((await findTenantBySlug(client, 'alpha')).id, 'tenant-a');
  assert.deepEqual(await loadAppointments(client, 'tenant-a', (row) => ({ ...row, mapped: true })), [{ id: 'appointment-a', tenant_id: 'tenant-a', mapped: true }]);
  assert.deepEqual(await loadBroadcastContacts(client, 'tenant-a'), [{ id: 'contact-a', tenant_id: 'tenant-a' }]);
  assert.deepEqual(await loadBroadcastCampaigns(client, 'tenant-a'), [{ id: 'campaign-a', tenant_id: 'tenant-a' }]);
  for (const query of client.queries) {
    assert.ok(query.calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a') || query.table === 'tenants');
  }
  assert.deepEqual(client.queries.find((query) => query.table === 'appointments').calls.find((call) => call[0] === 'limit'), ['limit', 200]);
  assert.deepEqual(client.queries.find((query) => query.table === 'broadcast_contacts').calls.find((call) => call[0] === 'limit'), ['limit', 500]);
  assert.deepEqual(client.queries.find((query) => query.table === 'broadcast_campaigns').calls.find((call) => call[0] === 'limit'), ['limit', 50]);
});

test('Kanban reads retain board and column isolation and fall back on errors', async () => {
  const client = fakeSupabase({
    kanban_boards: { data: { id: 'board-a', tenant_id: 'tenant-a' }, error: null },
    kanban_columns: { data: [{ id: 'column-a', tenant_id: 'tenant-a', board_id: 'board-a' }], error: null },
  });
  const config = await loadKanbanConfig(client, 'tenant-a');
  assert.equal(config.board.id, 'board-a');
  assert.equal(config.columns[0].board_id, 'board-a');
  assert.ok(client.queries[1].calls.some((call) => call.join('|') === 'eq|board_id|board-a'));

  const failing = fakeSupabase({ kanban_boards: { data: null, error: { message: 'unavailable' } } });
  assert.equal(await loadKanbanConfig(failing, 'tenant-a'), null);
});

test('follow-up reads stay tenant-scoped and are disabled outside the Nubia board', async () => {
  const client = fakeSupabase({ follow_up_jobs: { data: [{ id: 'job-a', tenant_id: 'tenant-a' }], error: null } });
  assert.deepEqual(await loadFollowUpJobs(client, 'tenant-a', 'other_tenant'), []);
  assert.equal(client.queries.length, 0);
  assert.deepEqual(await loadFollowUpJobs(client, 'tenant-a', 'clinica_nubia_oficial'), [{ id: 'job-a', tenant_id: 'tenant-a' }]);
  assert.ok(client.queries[0].calls.some((call) => call[0] === 'in' && call[1] === 'status'));
  assert.deepEqual(client.queries[0].calls.find((call) => call[0] === 'limit'), ['limit', 200]);
});
