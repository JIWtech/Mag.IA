const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '../app/src/main.jsx');
let content = fs.readFileSync(mainPath, 'utf8');

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

content = content.replace(
  "import { MediaAttachment } from './features/conversations/components/MediaAttachment';",
  "import { MediaAttachment } from './features/conversations/components/MediaAttachment';\r\n" + importStatement.trim()
);

const chunk1 = "const activePageStorageKey = 'magia:active-page';\r\nconst appDataCachePrefix = 'magia:app-data:';\r\nconst sessionBootstrappedKey = 'noria:session-bootstrapped';\r\n";
if (!content.includes(chunk1)) {
  throw new Error('chunk1 not found!');
}
content = content.replace(chunk1, '');

const chunk2Start = 'function isSessionBootstrapped() {';
const chunk2End = 'function formatCurrency(value) {';
const idxStart = content.indexOf(chunk2Start);
const idxEnd = content.indexOf(chunk2End);
if (idxStart === -1 || idxEnd === -1) {
  throw new Error('chunk2 boundaries not found!');
}
content = content.slice(0, idxStart) + content.slice(idxEnd);

const chunk3Start = 'function getInitialAppData(tenantSlug) {';
const chunk3End = 'function App() {';
const idx3Start = content.indexOf(chunk3Start);
const idx3End = content.indexOf(chunk3End);
if (idx3Start === -1 || idx3End === -1) {
  throw new Error('chunk3 boundaries not found!');
}
content = content.slice(0, idx3Start) + content.slice(idx3End);

// Verify CRLF preservation
if (!content.includes('\r\n')) {
  throw new Error('CRLF lost!');
}

fs.writeFileSync(mainPath, content, 'utf8');
console.log('app/src/main.jsx updated successfully!');
