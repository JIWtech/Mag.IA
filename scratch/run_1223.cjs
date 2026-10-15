const { execSync } = require('child_process');
try {
  const out = execSync('node --test --test-name-pattern="catalog UX F" scripts/tests/test_whatsapp_sales.cjs', { encoding: 'utf8' });
  console.log(out);
} catch (err) {
  console.log('STDOUT:\n', err.stdout);
  console.log('STDERR:\n', err.stderr);
}
