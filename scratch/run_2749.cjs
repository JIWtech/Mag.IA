const fs = require('fs');
const path = require('path');

// Run node with --test on just the 2749 test by filtering!
const { execSync } = require('child_process');
try {
  const out = execSync('node --test --test-name-pattern="Genesis classifica leilao" scripts/tests/test_whatsapp_sales.cjs', { encoding: 'utf8' });
  console.log(out);
} catch (err) {
  console.log('STDOUT:\n', err.stdout);
  console.log('STDERR:\n', err.stderr);
}
