const fs = require('fs');

// Patch n8n/code/whatsapp_conversation_core.generated.js to print error stack!
let code = fs.readFileSync('n8n/code/whatsapp_conversation_core.generated.js', 'utf8');
code = code.replace(
  "return { json: { ok: false, tenant_slug: tenantSlug, error: String(error.message || 'processing_failed').slice(0,300), delivery_uncertain: sendAttempted } };",
  "console.error('ERROR STACK IN RUN TURN:', error.stack);\nreturn { json: { ok: false, tenant_slug: tenantSlug, error: String(error.message || 'processing_failed').slice(0,300), delivery_uncertain: sendAttempted } };"
);
fs.writeFileSync('n8n/code/whatsapp_conversation_core.generated.js', code);

const { execSync } = require('child_process');
try {
  execSync('node --test --test-name-pattern="catalog UX F" scripts/tests/test_whatsapp_sales.cjs', { encoding: 'utf8', stdio: 'inherit' });
} catch (_) {}
