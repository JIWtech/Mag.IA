const { spawnSync } = require('node:child_process');
const path = require('node:path');

const tests = [
  'sales registers a hot interest using the configured percentage, no appointments',
  'selected vehicle and entry retain evidence across separate messages',
  'vehicle model shorthand and split variant evidence do not cause a handoff',
  'verified price at the end of a sentence is not treated as an invented value',
  'new messages or human transition discard all commercial side effects',
  'locked or disabled sales does not generate, download stock or respond to reset',
  'technical sales failures preserve their code without commercial handoff',
  'unbound invented price is repaired without weakening commercial validation',
  'ambiguous PCX in inventory without color or year clears candidate and continues qualifying without human handoff',
  'price changed during registration does not confirm an interest at stale price',
  'CPF/CNH required by tenant do not disappear behind a register action',
  'document extraction is saved privately, not in commercial model context',
  'unreadable documents never invent identity fields',
  'clear buy-and-sell qualifies trade-in and appraisal instead of immediate human handoff',
  'follow-up K: sales + interest_registered=true schedules 0 jobs',
  'financing amounts are deposits, never vehicle price discrepancies',
  'an explicit advertised vehicle price still triggers the price discrepancy guard',
  'a deposit does not create a discrepancy when the official vehicle price is absent',
  'a deposit above the vehicle price gets deposit-specific validation without handoff',
  'cash purchase remains distinct from financing deposit classification',
  'independent sale monetary expectation cannot become dealer price discrepancy',
  'buy and sell keeps both intents while a cash deposit stays separate from official price',
  'financing with pending documents asks for documents instead of inventing a price conflict',
  'follow-up M: handoff=true schedules 0 jobs even in sales',
  'follow-up N: failure scheduling follow-up after response was sent does not resend primary reply',
];

if (tests.length !== 25 || new Set(tests).size !== 25) throw new Error('Commercial gate must contain exactly 25 unique tests');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = `^(?:${tests.map(escape).join('|')})$`;
const file = path.join(__dirname, 'test_whatsapp_sales.cjs');
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', `--test-name-pattern=${pattern}`, file], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
