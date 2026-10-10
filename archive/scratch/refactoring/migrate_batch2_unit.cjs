const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'app/src');
const unitDir = path.join(root, 'app/tests/unit');

if (!fs.existsSync(unitDir)) {
  fs.mkdirSync(unitDir, { recursive: true });
}

const batch2Files = [
  'asObject.test.js',
  'contactApplication.test.js',
  'contactDirectory.test.js',
  'contactIdentity.test.js',
  'contactNames.test.js',
  'contactPayload.test.js',
  'contactPhones.test.js',
  'conversationDataReads.test.js',
  'conversationEvents.test.js',
  'conversationFilters.test.js',
  'conversationIdentity.test.js',
  'conversationLifecycle.test.js',
  'dataOperations.test.js',
  'dataService.test.js',
  'dateHelpers.test.js',
  'funnelHelpers.test.js',
  'kanbanFilters.test.js',
  'kanbanHelpers.test.js',
  'leadDataReads.test.js',
  'mediaUrlService.test.js',
  'productMediaHelpers.test.js',
  'readsService.test.js',
  'salesKanban.test.js',
  'tenantDataReads.test.js',
];

console.log('Migrating Batch 2 (' + batch2Files.length + ' unit test files)...');

for (const f of batch2Files) {
  const srcFile = path.join(srcDir, f);
  const dstFile = path.join(unitDir, f);

  if (!fs.existsSync(srcFile)) {
    console.log(`Skipping ${f}, not found in src/`);
    continue;
  }

  const rawLines = fs.readFileSync(srcFile, 'utf8').split('\n');
  const transformedLines = rawLines.map(line => {
    const trimmed = line.trim();
    // Only transform actual top-level import/export statements
    if (trimmed.startsWith('import ') || trimmed.startsWith('} from ') || trimmed.startsWith('export ') || trimmed.startsWith('const m = await import(') || trimmed.startsWith('import(')) {
      return line
        .replace(/from\s+['"]\.\/([^'"]+)['"]/g, "from '../../src/$1'")
        .replace(/import\s*\(\s*['"]\.\/([^'"]+)['"]\s*\)/g, "import('../../src/$1')");
    }
    return line;
  });

  let content = transformedLines.join('\n');

  // File-specific path fixes
  if (f === 'funnelHelpers.test.js') {
    content = content.replace(
      "path.resolve(__dirname, 'services/funnel/funnelHelpers.js')",
      "path.resolve(__dirname, '../../src/services/funnel/funnelHelpers.js')"
    );
  } else if (f === 'kanbanHelpers.test.js') {
    content = content.replace(
      "path.resolve(__dirname, 'services/kanban/kanbanHelpers.js')",
      "path.resolve(__dirname, '../../src/services/kanban/kanbanHelpers.js')"
    );
  }

  fs.writeFileSync(dstFile, content, 'utf8');
  fs.unlinkSync(srcFile);
  console.log(`Moved & updated: ${f} -> app/tests/unit/${f}`);
}

console.log('Batch 2 migration completed.');
