import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import { formatConversationPreview } from '../../src/utils/audioUtils.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('REGRESSAO: Kanban.jsx possui AST limpa com zero variaveis livres e todas as dependencias declaradas', () => {
  const filePath = path.join(__dirname, '../../src/features/kanban/components/Kanban.jsx');
  const code = fs.readFileSync(filePath, 'utf8');

  // Verifica explicitamente dependências críticas que poderiam vazar para o escopo global
  assert.match(code, /formatConversationPreview/, 'Kanban.jsx deve importar formatConversationPreview');
  assert.match(code, /useHorizontalMouseDragScroll/, 'Kanban.jsx deve importar useHorizontalMouseDragScroll');
  assert.match(code, /useKanbanDragAutoScroll/, 'Kanban.jsx deve importar useKanbanDragAutoScroll');
  assert.match(code, /useKanbanWheelScroll/, 'Kanban.jsx deve importar useKanbanWheelScroll');
  assert.match(code, /NoriaSelect/, 'Kanban.jsx deve importar NoriaSelect');

  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement', 'HTMLElement'
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

  assert.deepEqual(
    Array.from(undefinedRefs),
    [],
    `Kanban.jsx nao pode conter identificadores livres: ${Array.from(undefinedRefs).join(', ')}`
  );
});

test('App.jsx consome Kanban exclusivamente do modulo modularizado', () => {
  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const appCode = fs.readFileSync(appPath, 'utf8');

  assert.match(
    appCode,
    /import\s*\{[^}]*Kanban[^}]*\}\s*from\s*['"]\.\.\/features\/kanban\/components\/Kanban['"]/,
    'App.jsx deve importar Kanban de features/kanban/components/Kanban'
  );

  assert.doesNotMatch(
    appCode,
    /\bfunction\s+Kanban\s*\(/,
    'App.jsx nao deve conter a declaracao antiga de function Kanban'
  );
});

test('formatConversationPreview consumido pelo Kanban produz previews consistentes nos cards', () => {
  // Testa cenários reais de preview de cards no Kanban
  assert.equal(formatConversationPreview('Olá, gostaria de agendar uma consulta'), 'Olá, gostaria de agendar uma consulta');
  assert.equal(formatConversationPreview('[audio]'), 'Áudio');
  assert.equal(formatConversationPreview('[image]'), 'Imagem');
  assert.equal(formatConversationPreview('[image]', { caption: 'Foto do veículo' }), 'Foto do veículo');
  assert.equal(formatConversationPreview('/reset'), 'Conversa reiniciada');
  assert.equal(formatConversationPreview('[secretencrypted]'), '');
  assert.equal(formatConversationPreview(''), '');
});
