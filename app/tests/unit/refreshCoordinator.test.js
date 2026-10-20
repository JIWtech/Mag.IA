import test from 'node:test';
import assert from 'node:assert/strict';
import * as realtimeRefresh from '../../src/services/timeline/realtimeRefresh.js';

test('refresh coordinator skips a fresh visibility refresh and coalesces an in-flight refresh for the same tenant', async () => {
  assert.equal(typeof realtimeRefresh.createRefreshCoordinator, 'function');
  assert.equal(realtimeRefresh.VISIBILITY_REFRESH_STALE_AFTER_MS, 15 * 60 * 1000);

  let now = 1_000;
  const coordinator = realtimeRefresh.createRefreshCoordinator({
    now: () => now,
  });
  coordinator.markFresh('tenant-a');

  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
  now += 5 * 60 * 1000;
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
  now += 10 * 60 * 1000;
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), true);

  let resolveLoad;
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  const first = coordinator.run('tenant-a', load);
  const second = coordinator.run('tenant-a', load);

  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveLoad();
  await first;
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
});
