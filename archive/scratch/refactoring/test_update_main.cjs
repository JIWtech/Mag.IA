const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const mainPath = path.resolve(__dirname, '../app/src/main.jsx');
const mainContent = fs.readFileSync(mainPath, 'utf8');

const importStatement = `import {
  activePageStorageKey,
  appDataCachePrefix,
  sessionBootstrappedKey,
  isSessionBootstrapped,
  setSessionBootstrapped,
  clearSessionBootstrapped,
  getInitialActivePage,
  appDataSignature,
  loadCachedAppData,
  cacheAppData,
  getInitialAppData,
} from './app/appStorage';
`;

let updated = mainContent.replace(
  "import { MediaAttachment } from './features/conversations/components/MediaAttachment';",
  "import { MediaAttachment } from './features/conversations/components/MediaAttachment';\r\n" + importStatement.trim()
);

const chunk1 = "const activePageStorageKey = 'magia:active-page';\r\nconst appDataCachePrefix = 'magia:app-data:';\r\nconst sessionBootstrappedKey = 'noria:session-bootstrapped';\r\n";
if (!updated.includes(chunk1)) {
  console.error('chunk1 not found exactly with CRLF!');
} else {
  console.log('chunk1 found!');
  updated = updated.replace(chunk1, '');
}

const chunk2Start = 'function isSessionBootstrapped() {';
const chunk2End = 'function formatCurrency(value) {';
const idxStart = updated.indexOf(chunk2Start);
const idxEnd = updated.indexOf(chunk2End);
console.log('chunk2 indices:', idxStart, idxEnd);
if (idxStart !== -1 && idxEnd !== -1) {
  updated = updated.slice(0, idxStart) + updated.slice(idxEnd);
  console.log('chunk2 removed successfully!');
}

const chunk3Start = 'function getInitialAppData(tenantSlug) {';
const chunk3End = 'function App() {';
const idx3Start = updated.indexOf(chunk3Start);
const idx3End = updated.indexOf(chunk3End);
console.log('chunk3 indices:', idx3Start, idx3End);
if (idx3Start !== -1 && idx3End !== -1) {
  updated = updated.slice(0, idx3Start) + updated.slice(idx3End);
  console.log('chunk3 removed successfully!');
}

console.log('Validating AST of updated main.jsx...');
try {
  const ast = parser.parse(updated, { sourceType: 'module', plugins: ['jsx'] });
  console.log('AST parsed successfully!');

  // Check undefined references
  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement', 'HTMLElement',
    'Image', 'URLSearchParams', 'MediaRecorder'
  ]);

  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) {
        undefinedRefs.add(name);
      }
    }
  });

  console.log('Undefined references in updated main.jsx:', Array.from(undefinedRefs));
  console.log('Original line count:', mainContent.split('\n').length);
  console.log('Updated line count:', updated.split('\n').length);
  console.log('Line reduction:', mainContent.split('\n').length - updated.split('\n').length);
} catch (e) {
  console.error('AST parsing failed:', e);
}
