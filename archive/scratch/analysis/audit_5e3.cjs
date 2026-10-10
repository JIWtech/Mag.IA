const fs = require('fs');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

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

function auditFile(file, isJsx = false) {
  const content = fs.readFileSync(file, 'utf8');
  const plugins = isJsx ? ['jsx'] : [];
  const ast = parser.parse(content, { sourceType: 'module', plugins });
  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) {
        undefinedRefs.add(name);
      }
    },
    JSXIdentifier(p) {
      const name = p.node.name;
      if (name[0] === name[0].toUpperCase()) {
        if (!p.scope.hasBinding(name) && !jsGlobals.has(name)) {
          undefinedRefs.add(name);
        }
      }
    }
  });
  console.log(file + ' undefined refs: ' + JSON.stringify(Array.from(undefinedRefs)));
}

['app/src/main.jsx', 'app/src/app/App.jsx', 'app/src/app/appStorage.js', 'app/src/app/AppErrorBoundary.jsx'].forEach(f => auditFile(f, true));

// Check CSS order in main.jsx
const mainContent = fs.readFileSync('app/src/main.jsx', 'utf8');
const idxFont = mainContent.indexOf('@fontsource-variable/manrope');
const idxStyles = mainContent.indexOf('./styles.css');
const idxConv = mainContent.indexOf('./conversations.css');

console.log('CSS Order check:');
console.log('  fontsource index:', idxFont);
console.log('  styles.css index:', idxStyles);
console.log('  conversations.css index:', idxConv);
console.log('  Order correct (font < styles < conv):', (idxFont !== -1 && idxStyles !== -1 && idxConv !== -1 && idxFont < idxStyles && idxStyles < idxConv));

// Check circular dependencies
const appCode = fs.readFileSync('app/src/app/App.jsx', 'utf8');
const storageCode = fs.readFileSync('app/src/app/appStorage.js', 'utf8');
const ebCode = fs.readFileSync('app/src/app/AppErrorBoundary.jsx', 'utf8');

console.log('Circular dependencies:');
console.log('  App.jsx imports main:', appCode.includes('main'));
console.log('  appStorage.js imports main:', storageCode.includes('main'));
console.log('  AppErrorBoundary imports main:', ebCode.includes('main'));
console.log('  main.jsx lines:', mainContent.split(/\r?\n/).length);
