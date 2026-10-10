const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'app/src');
const archDir = path.join(root, 'app/tests/architecture');

if (!fs.existsSync(archDir)) {
  fs.mkdirSync(archDir, { recursive: true });
}

const batch1Files = [
  'app.test.js',
  'appStorage.test.js',
  'serviceExtraction6b13.test.js',
  'serviceExtraction6b15c.test.js',
  'serviceExtraction6b16.test.js',
  'serviceExtraction6b17.test.js',
  'serviceExtraction6b18.test.js',
  'serviceExtraction6b19.test.js',
  'serviceExtraction6b20.test.js',
  'serviceExtraction6b21.test.js',
  'serviceExtraction6b24.test.js',
  'serviceExtraction6b26.test.js',
  'serviceExtraction6b27.test.js',
  'serviceExtraction6b28.test.js',
  'serviceExtraction6b30.test.js',
  'serviceExtraction6b31.test.js',
  'serviceExtraction6b32.test.js',
  'serviceExtraction6b33.test.js',
  'serviceExtraction6b34.test.js',
];

console.log('Migrating Batch 1 (' + batch1Files.length + ' architecture files)...');

for (const f of batch1Files) {
  const srcFile = path.join(srcDir, f);
  const dstFile = path.join(archDir, f);
  
  if (!fs.existsSync(srcFile)) {
    console.log(`Skipping ${f}, not found in src/`);
    continue;
  }

  let content = fs.readFileSync(srcFile, 'utf8');

  // 1. Transform relative imports
  // from './dataService.js' -> from '../../src/dataService.js'
  // from './services/...' -> from '../../src/services/...'
  // from './features/...' -> from '../../src/features/...'
  // from './utils/...' -> from '../../src/utils/...'
  // from './app/...' -> from '../../src/app/...'
  content = content.replace(/from\s+['"]\.\/([^'"]+)['"]/g, "from '../../src/$1'");
  content = content.replace(/import\s*\(\s*['"]\.\/([^'"]+)['"]\s*\)/g, "import('../../src/$1')");

  // 2. Specific adjustments per file
  if (f === 'app.test.js') {
    content = content.replace("path.join(__dirname, 'app/App.jsx')", "path.join(__dirname, '../../src/app/App.jsx')");
    content = content.replace("path.join(__dirname, 'main.jsx')", "path.join(__dirname, '../../src/main.jsx')");
    content = content.replace("path.join(__dirname, 'app/appStorage.js')", "path.join(__dirname, '../../src/app/appStorage.js')");
  } else if (f === 'appStorage.test.js') {
    content = content.replace("path.join(__dirname, 'app/appStorage.js')", "path.join(__dirname, '../../src/app/appStorage.js')");
    content = content.replace("path.join(__dirname, 'app/App.jsx')", "path.join(__dirname, '../../src/app/App.jsx')");
  } else if (f === 'serviceExtraction6b26.test.js') {
    content = content.replace("path.join(__dirname, 'features/conversations/components')", "path.join(__dirname, '../../src/features/conversations/components')");
  } else if (f === 'serviceExtraction6b27.test.js') {
    content = content.replace("path.join(__dirname, 'features/conversations/components')", "path.join(__dirname, '../../src/features/conversations/components')");
  } else if (f === 'serviceExtraction6b28.test.js') {
    content = content.replace("path.join(__dirname, 'features/conversations/components')", "path.join(__dirname, '../../src/features/conversations/components')");
  } else if (f === 'serviceExtraction6b30.test.js') {
    content = content.replace("path.join(__dirname, 'app')", "path.join(__dirname, '../../src/app')");
  } else if (f === 'serviceExtraction6b31.test.js') {
    content = content.replace("path.join(__dirname, 'app')", "path.join(__dirname, '../../src/app')");
  } else if (f === 'serviceExtraction6b32.test.js') {
    content = content.replace("path.join(__dirname, 'app/App.jsx')", "path.join(__dirname, '../../src/app/App.jsx')");
    content = content.replace("path.join(__dirname, 'app/AppTopbar.jsx')", "path.join(__dirname, '../../src/app/AppTopbar.jsx')");
    // For now these 3 are still in app/src/; we will update to ../features/ in Batch 3
    content = content.replace("path.join(__dirname, 'mediaRenderer.test.js')", "path.join(__dirname, '../../src/mediaRenderer.test.js')");
    content = content.replace("path.join(__dirname, 'conversationsPresentation.test.js')", "path.join(__dirname, '../../src/conversationsPresentation.test.js')");
    content = content.replace("path.join(__dirname, 'kanban.test.js')", "path.join(__dirname, '../../src/kanban.test.js')");
  } else if (f === 'serviceExtraction6b33.test.js') {
    content = content.replace("path.join(__dirname, 'services/kanban/kanbanOrderValidation.js')", "path.join(__dirname, '../../src/services/kanban/kanbanOrderValidation.js')");
    content = content.replace("path.join(__dirname, 'dataService.js')", "path.join(__dirname, '../../src/dataService.js')");
  }

  fs.writeFileSync(dstFile, content, 'utf8');
  fs.unlinkSync(srcFile);
  console.log(`Moved & updated: ${f} -> app/tests/architecture/${f}`);
}

console.log('Batch 1 migration completed.');
