const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../../n8n/code/command_router.js'), 'utf8');
const workflow = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../../n8n/workflows/magia_command_router.json'), 'utf8'));

test('catalog refresh keeps the provider integration server-side and tenant-scoped', () => {
  assert.match(code, /validateUserSession\(\)/);
  assert.match(code, /assertTenantMember\(user\.id, tenant\.id/);
  assert.match(code, /tenant_id=eq\.'/);
  assert.match(code, /type=eq\.whatsapp/);
  assert.match(code, /status=eq\.active/);
  assert.match(code, /Instancia nao pertence ao tenant/);
  assert.match(code, /evolution\.instance !== instance/);
  assert.match(code, /claim_whatsapp_catalog_sync/);
  assert.doesNotMatch(code, /EVOLUTION_API_KEY[^\n]*return/);
});

test('catalog refresh handles envelopes, pagination, partial results and endpoint failures', () => {
  assert.match(code, /unwrapCatalogPayload/);
  assert.match(code, /for \(let page = 1; page <= 20/);
  assert.match(code, /hasNext.*has_more.*nextPage/s);
  assert.match(code, /catalog\.found\.size < productIds\.length/);
  assert.match(code, /business\/getCollections/);
  assert.match(code, /CATALOG_PROVIDER_AUTH_FAILED/);
  assert.match(code, /CATALOG_PROVIDER_ENDPOINT_UNSUPPORTED/);
  assert.match(code, /CATALOG_PROVIDER_UNAVAILABLE/);
  assert.match(code, /const missing = productIds\.filter/);
  assert.match(code, /if \(!catalog\.found\.size && !catalog\.firstError\) throw collectionsError/);
  assert.match(code, /outcome: rows\.length \? 'products_found' : 'product_not_found'/);
});

test('a catalog cache write contains only provider-confirmed product fields', () => {
  assert.match(code, /productIds\.includes\(String\(product\?\.productId \|\| product\?\.id/);
  assert.match(code, /safeCatalogImage/);
  assert.match(code, /price_evidence_source: 'evolution_getCatalog'/);
  assert.doesNotMatch(code, /inventory.*price/i);
});

test('generated command-router workflow embeds the exact source code', () => {
  const node = workflow.nodes.find((entry) => entry.name === 'Executar Comando');
  assert.ok(node, 'command-router node must exist');
  assert.equal(String(node.parameters?.jsCode || '').replace(/\r\n/g, '\n').trim(), code.replace(/\r\n/g, '\n').trim());
});
