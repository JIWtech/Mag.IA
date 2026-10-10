const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'app/src');
const featDir = path.join(root, 'app/tests/features');
const archDir = path.join(root, 'app/tests/architecture');

if (!fs.existsSync(featDir)) {
  fs.mkdirSync(featDir, { recursive: true });
}

const batch3Files = [
  'audioPlayer.test.js',
  'broadcasts.test.js',
  'chatTimeline.test.js',
  'closedConversationsTab.test.js',
  'contactPresentation.test.js',
  'conversationsPresentation.test.js',
  'followUpConversations.test.js',
  'kanban.test.js',
  'kanbanScroll.test.js',
  'mediaPresentation.test.js',
  'mediaRenderer.test.js',
  'schedulingLinks.test.js',
  'senderIdentity.test.js',
  'settings.test.js',
  'tenantAccess.test.js',
];

console.log('Migrating Batch 3 (' + batch3Files.length + ' feature test files)...');

for (const f of batch3Files) {
  const srcFile = path.join(srcDir, f);
  const dstFile = path.join(featDir, f);

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
  if (f === 'broadcasts.test.js') {
    content = content.replace("path.join(__dirname, 'features/broadcasts/components/Broadcasts.jsx')", "path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx')");
    content = content.replace("path.join(__dirname, relPath)", "path.join(__dirname, '../../src', relPath)");
  } else if (f === 'conversationsPresentation.test.js') {
    content = content.replace("path.join(__dirname, 'app/App.jsx')", "path.join(__dirname, '../../src/app/App.jsx')");
    content = content.replace("path.join(__dirname, 'main.jsx')", "path.join(__dirname, '../../src/main.jsx')");
    content = content.replace("path.join(__dirname, relPath)", "path.join(__dirname, '../../src', relPath)");
    content = content.replaceAll("path.join(__dirname, 'features/", "path.join(__dirname, '../../src/features/");
  } else if (f === 'kanban.test.js') {
    content = content.replace("path.join(__dirname, 'features/kanban/components/Kanban.jsx')", "path.join(__dirname, '../../src/features/kanban/components/Kanban.jsx')");
    content = content.replace("path.join(__dirname, 'app/App.jsx')", "path.join(__dirname, '../../src/app/App.jsx')");
  } else if (f === 'kanbanScroll.test.js') {
    content = content.replace("path.join(__dirname, 'features/kanban/hooks/useKanbanScroll.js')", "path.join(__dirname, '../../src/features/kanban/hooks/useKanbanScroll.js')");
    content = content.replace("path.join(__dirname, 'features/kanban/components/Kanban.jsx')", "path.join(__dirname, '../../src/features/kanban/components/Kanban.jsx')");
    content = content.replace("path.join(__dirname, 'main.jsx')", "path.join(__dirname, '../../src/main.jsx')");
  } else if (f === 'mediaRenderer.test.js') {
    content = content.replaceAll("new URL('./", "new URL('../../src/");
  } else if (f === 'schedulingLinks.test.js') {
    content = content.replace(
      "path.resolve(__dirname, 'services/appointments/schedulingLinks.js')",
      "path.resolve(__dirname, '../../src/services/appointments/schedulingLinks.js')"
    );
  }

  fs.writeFileSync(dstFile, content, 'utf8');
  fs.unlinkSync(srcFile);
  console.log(`Moved & updated: ${f} -> app/tests/features/${f}`);
}

// Update cross-test references in serviceExtraction6b32.test.js
const test6b32Path = path.join(archDir, 'serviceExtraction6b32.test.js');
if (fs.existsSync(test6b32Path)) {
  let content6b32 = fs.readFileSync(test6b32Path, 'utf8');
  content6b32 = content6b32.replace("path.join(__dirname, '../../src/mediaRenderer.test.js')", "path.join(__dirname, '../features/mediaRenderer.test.js')");
  content6b32 = content6b32.replace("path.join(__dirname, '../../src/conversationsPresentation.test.js')", "path.join(__dirname, '../features/conversationsPresentation.test.js')");
  content6b32 = content6b32.replace("path.join(__dirname, '../../src/kanban.test.js')", "path.join(__dirname, '../features/kanban.test.js')");
  fs.writeFileSync(test6b32Path, content6b32, 'utf8');
  console.log('Updated cross-test references in serviceExtraction6b32.test.js to ../features/');
}

console.log('Batch 3 migration completed.');
