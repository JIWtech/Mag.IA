import test from 'node:test';
import assert from 'node:assert/strict';
import { asObject } from '../../src/utils/asObject.js';

test('asObject preserves plain-object identity and converts non-object inputs to empty objects', () => {
  const object = { nested: true };
  assert.equal(asObject(object), object);
  assert.deepEqual(asObject({}), {});
  assert.deepEqual(asObject(null), {});
  assert.deepEqual(asObject(undefined), {});
  assert.deepEqual(asObject([]), {});
  assert.deepEqual(asObject(7), {});
  assert.deepEqual(asObject(false), {});
  assert.deepEqual(asObject('{"ok":true}'), { ok: true });
  assert.deepEqual(asObject('invalid'), {});
});
