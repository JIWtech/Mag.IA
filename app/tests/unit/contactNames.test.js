import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrustedContactName, getUsefulTrustedContactName, isUsefulContactName } from '../../src/dataService.js';

test('contact names: trusts only inbound contact names and trims accepted values', () => {
  const inbound = { direction: 'inbound', sender_type: 'contact', contact_name: '  Áurea  ' };
  assert.equal(getTrustedContactName(inbound), 'Áurea');
  assert.equal(getTrustedContactName({ ...inbound, direction: 'outbound' }), '');
  assert.equal(getTrustedContactName({ ...inbound, sender_type: 'agent' }), '');
  assert.equal(getTrustedContactName({}), '');
});

test('contact names: rejects generic, JID and telephone-like names while retaining emoji and accented names', () => {
  assert.equal(isUsefulContactName('unknown'), false);
  assert.equal(isUsefulContactName('  .  '), false);
  assert.equal(isUsefulContactName('5511999999999', '5511999999999'), false);
  assert.equal(isUsefulContactName('5511999999999@s.whatsapp.net'), false);
  assert.equal(isUsefulContactName('🧋', '5511999999999'), true);
  assert.equal(isUsefulContactName('  Áurea  ', '5511999999999'), true);
  assert.equal(isUsefulContactName(undefined), false);
});

test('contact names: returns a useful trusted name only for complete inbound-contact events', () => {
  const valid = { direction: 'inbound', sender_type: 'contact', contact_name: '  Ana Maria ', contact_handle: '5511888888888' };
  assert.equal(getUsefulTrustedContactName(valid), 'Ana Maria');
  assert.equal(getUsefulTrustedContactName({ ...valid, contact_name: '5511888888888' }), '');
  assert.equal(getUsefulTrustedContactName({ ...valid, direction: 'outbound' }), '');
  assert.equal(getUsefulTrustedContactName(valid), getUsefulTrustedContactName(valid));
});
