const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// Let's inspect test 1223 directly:
const content = fs.readFileSync('scripts/tests/test_whatsapp_sales.cjs', 'utf8');
// Find test('catalog UX F'
const idx = content.indexOf("test('catalog UX F");
console.log(content.slice(idx, idx + 800));
