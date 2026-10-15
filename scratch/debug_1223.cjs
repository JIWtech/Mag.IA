const fs = require('fs');

// Patch test_whatsapp_sales.cjs temporarily to log selected in test 1223
let testCode = fs.readFileSync('scripts/tests/test_whatsapp_sales.cjs', 'utf8');
testCode = testCode.replace(
  "assert.equal(selected.saved[0].p_state.product_id,catalogPayload.catalog_item_ids[1]);",
  "console.log('SELECTED RESULT:', JSON.stringify(selected.result), 'SAVED LENGTH:', selected.saved.length, 'SENT:', selected.sent, 'CALLS:', selected.calls.map(c=>c.url));\nassert.equal(selected.saved[0]?.p_state?.product_id,catalogPayload.catalog_item_ids[1]);"
);
fs.writeFileSync('scripts/tests/test_whatsapp_sales.cjs', testCode);

const { execSync } = require('child_process');
try {
  const out = execSync('node --test --test-name-pattern="catalog UX F" scripts/tests/test_whatsapp_sales.cjs', { encoding: 'utf8' });
  console.log(out);
} catch (err) {
  console.log('STDOUT:\n', err.stdout);
  console.log('STDERR:\n', err.stderr);
}

// Restore test_whatsapp_sales.cjs
const { execSync: exec2 } = require('child_process');
exec2('git checkout HEAD -- scripts/tests/test_whatsapp_sales.cjs');
