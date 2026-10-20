import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const jsGlobals = new Set([
  'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
  'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
  'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement', 'HTMLElement',
  'Image', 'MediaRecorder'
]);

const modularFiles = [
  'features/conversations/utils/mediaPresentation.js',
  'features/conversations/components/MediaMeta.jsx',
  'features/conversations/components/MediaCaption.jsx',
  'features/conversations/components/TranscribedAudioCard.jsx',
  'features/conversations/components/AudioRecoveryNotice.jsx',
  'features/conversations/components/MediaViewer.jsx',
  'features/conversations/components/ProductAttachment.jsx',
  'features/conversations/components/LocationAttachment.jsx',
  'features/conversations/components/MediaAttachment.jsx',
  'features/conversations/components/Conversations.jsx',
];

test('REGRESSAO: Todos os 10 modulos de apresentacao, midia e componente principal de Conversas possuem AST limpa sem variaveis livres', () => {
  modularFiles.forEach(relPath => {
    const filePath = path.join(__dirname, '../../src', relPath);
    assert.ok(fs.existsSync(filePath), `Arquivo deve existir: ${relPath}`);
    const code = fs.readFileSync(filePath, 'utf8');
    const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

    const undefinedRefs = new Set();
    traverse(ast, {
      ReferencedIdentifier(p) {
        const name = p.node.name;
        if (jsGlobals.has(name)) return;
        if (!p.scope.hasBinding(name)) {
          undefinedRefs.add(name);
        }
      },
      JSXOpeningElement(p) {
        const name = p.node.name.name;
        if (name && /^[A-Z]/.test(name)) {
          if (!p.scope.hasBinding(name) && !jsGlobals.has(name)) {
            undefinedRefs.add(name);
          }
        }
      }
    });

    assert.equal(
      undefinedRefs.size,
      0,
      `Arquivo ${relPath} nao pode conter identificadores livres indefinidos: ${Array.from(undefinedRefs).join(', ')}`
    );
  });
});

test('REGRESSAO: Componentes e helpers de Conversas sao consumidos exclusivamente dos modulos modulares pelos consumidores reais', () => {
  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const appCode = fs.readFileSync(appPath, 'utf8');

  const convPath = path.join(__dirname, '../../src/features/conversations/components/Conversations.jsx');
  const convCode = fs.readFileSync(convPath, 'utf8');

  const mediaAttachmentPath = path.join(__dirname, '../../src/features/conversations/components/MediaAttachment.jsx');
  const mediaAttachmentCode = fs.readFileSync(mediaAttachmentPath, 'utf8');

  const mainPath = path.join(__dirname, '../../src/main.jsx');
  const mainCode = fs.readFileSync(mainPath, 'utf8');

  // App.jsx consome Conversations modular
  assert.match(appCode, /from '\.\.\/features\/conversations\/components\/Conversations'/, 'App.jsx deve importar Conversations');

  // Conversations.jsx consome seus componentes e helpers modulares
  assert.match(convCode, /from '\.\/MediaAttachment(?:\.jsx)?'/, 'Conversations.jsx deve importar MediaAttachment');
  assert.match(convCode, /from '\.\/TranscribedAudioCard(?:\.jsx)?'/, 'Conversations.jsx deve importar TranscribedAudioCard');
  assert.match(convCode, /from '\.\/AudioRecoveryNotice(?:\.jsx)?'/, 'Conversations.jsx deve importar AudioRecoveryNotice');
  assert.match(convCode, /from '\.\/LocationAttachment(?:\.jsx)?'/, 'Conversations.jsx deve importar LocationAttachment');
  assert.match(convCode, /from '\.\.\/utils\/mediaPresentation(?:\.js)?'/, 'Conversations.jsx deve importar mediaPresentation');

  // MediaAttachment.jsx consome MediaViewer, ProductAttachment, MediaMeta e MediaCaption
  assert.match(mediaAttachmentCode, /from '\.\/MediaViewer(?:\.jsx)?'/, 'MediaAttachment.jsx deve importar MediaViewer');
  assert.match(mediaAttachmentCode, /from '\.\/ProductAttachment(?:\.jsx)?'/, 'MediaAttachment.jsx deve importar ProductAttachment');
  assert.match(mediaAttachmentCode, /from '\.\/MediaMeta(?:\.jsx)?'/, 'MediaAttachment.jsx deve importar MediaMeta');
  assert.match(mediaAttachmentCode, /from '\.\/MediaCaption(?:\.jsx)?'/, 'MediaAttachment.jsx deve importar MediaCaption');

  // Verifica que declarações antigas não foram duplicadas nem em main.jsx nem em App.jsx
  for (const code of [mainCode, appCode]) {
    assert.doesNotMatch(code, /function AudioRecoveryNotice\(/, 'AudioRecoveryNotice não pode estar declarada');
    assert.doesNotMatch(code, /export function TranscribedAudioCard\(/, 'TranscribedAudioCard não pode estar declarada');
    assert.doesNotMatch(code, /function MediaMeta\(/, 'MediaMeta não pode estar declarada');
    assert.doesNotMatch(code, /function MediaCaption\(/, 'MediaCaption não pode estar declarada');
    assert.doesNotMatch(code, /function resolveVisualMediaCaption\(/, 'resolveVisualMediaCaption não pode estar declarada');
    assert.doesNotMatch(code, /function consecutiveImageGallery\(/, 'consecutiveImageGallery não pode estar declarada');
    assert.doesNotMatch(code, /function formatProductPrice\(/, 'formatProductPrice não pode estar declarada');
    assert.doesNotMatch(code, /function MediaViewer\(/, 'MediaViewer não pode estar declarada');
    assert.doesNotMatch(code, /function ProductAttachment\(/, 'ProductAttachment não pode estar declarada');
    assert.doesNotMatch(code, /function LocationAttachment\(/, 'LocationAttachment não pode estar declarada');
    assert.doesNotMatch(code, /function MediaAttachment\(/, 'MediaAttachment não pode estar declarada');
    assert.doesNotMatch(code, /function Conversations\(/, 'Conversations não pode estar declarada');
  }
});

test('REGRESSAO: AudioRecoveryNotice consome resolveAudioNoticeState de chatTimelineHelpers', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/AudioRecoveryNotice.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /resolveAudioNoticeState/, 'AudioRecoveryNotice deve utilizar resolveAudioNoticeState');
  assert.match(code, /from '\.\.\/utils\/chatTimelineHelpers\.js'/, 'AudioRecoveryNotice deve importar de chatTimelineHelpers.js');
});

test('REGRESSAO: MediaCaption reutiliza MediaMeta modularizado', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/MediaCaption.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /import\s+\{\s*MediaMeta\s*\}\s+from\s+'\.\/MediaMeta\.jsx'/, 'MediaCaption deve importar MediaMeta');
  assert.match(code, /<MediaMeta meta=\{meta\} \/>/, 'MediaCaption deve renderizar MediaMeta');
});

test('REGRESSAO: ProductAttachment reutiliza formatProductPrice, MediaMeta e MediaCaption', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/ProductAttachment.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /import\s+\{\s*formatProductPrice\s*\}\s+from\s+'\.\.\/utils\/mediaPresentation\.js'/, 'ProductAttachment deve importar formatProductPrice');
  assert.match(code, /import\s+\{\s*MediaMeta\s*\}\s+from\s+'\.\/MediaMeta\.jsx'/, 'ProductAttachment deve importar MediaMeta');
  assert.match(code, /import\s+\{\s*MediaCaption\s*\}\s+from\s+'\.\/MediaCaption\.jsx'/, 'ProductAttachment deve importar MediaCaption');
  assert.match(code, /<MediaCaption caption=\{caption\} meta=\{meta\} \/>/, 'ProductAttachment deve renderizar MediaCaption');
  assert.match(code, /<MediaMeta meta=\{meta\} \/>/, 'ProductAttachment deve renderizar MediaMeta');
});

test('REGRESSAO: LocationAttachment consome formatCoordinates de audioUtils', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/LocationAttachment.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /import\s+\{\s*formatCoordinates\s*\}\s+from\s+'\.\.\/\.\.\/\.\.\/utils\/audioUtils\.js'/, 'LocationAttachment deve importar formatCoordinates');
  assert.match(code, /formatCoordinates\(latitude, longitude\)/, 'LocationAttachment deve formatar coordenadas');
});

test('REGRESSAO: MediaViewer implementa controles de zoom, fit e atalhos de teclado', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/MediaViewer.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /export function MediaViewer\(/, 'MediaViewer deve ser exportado');
  assert.match(code, /event\.key === 'Escape'/, 'MediaViewer deve suportar tecla Escape');
  assert.match(code, /event\.key === 'ArrowLeft' && canGoPrevious/, 'MediaViewer deve suportar seta para esquerda');
  assert.match(code, /event\.key === 'ArrowRight' && canGoNext/, 'MediaViewer deve suportar seta para direita');
  assert.match(code, /setImageZoom\(zoom \+ 0\.25\)/, 'MediaViewer deve ter controle de aumento de zoom');
  assert.match(code, /setImageZoom\(zoom - 0\.25\)/, 'MediaViewer deve ter controle de diminuição de zoom');
});

test('REGRESSAO: MediaAttachment reutiliza componentes modulares, player de áudio e audioUtils', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/MediaAttachment.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /export function MediaAttachment\(/, 'MediaAttachment deve ser exportada');
  assert.match(code, /import\s+\{\s*ProductAttachment\s*\}\s+from\s+'\.\/ProductAttachment\.jsx'/, 'MediaAttachment deve importar ProductAttachment');
  assert.match(code, /import\s+\{\s*AudioRecoveryNotice\s*\}\s+from\s+'\.\/AudioRecoveryNotice\.jsx'/, 'MediaAttachment deve importar AudioRecoveryNotice');
  assert.match(code, /import\s+\{\s*TranscribedAudioCard\s*\}\s+from\s+'\.\/TranscribedAudioCard\.jsx'/, 'MediaAttachment deve importar TranscribedAudioCard');
  assert.match(code, /import\s+\{\s*MediaCaption\s*\}\s+from\s+'\.\/MediaCaption\.jsx'/, 'MediaAttachment deve importar MediaCaption');
  assert.match(code, /import\s+\{\s*MediaMeta\s*\}\s+from\s+'\.\/MediaMeta\.jsx'/, 'MediaAttachment deve importar MediaMeta');
  assert.match(code, /import\s+\{\s*MediaViewer\s*\}\s+from\s+'\.\/MediaViewer\.jsx'/, 'MediaAttachment deve importar MediaViewer');
  assert.match(code, /import\s+\{\s*AudioMessagePlayer\s*\}\s+from\s+'\.\.\/\.\.\/\.\.\/components\/AudioMessagePlayer\.jsx'/, 'MediaAttachment deve importar AudioMessagePlayer');
  assert.match(code, /import\s+\{[\s\S]*REAL_MEDIA_KINDS[\s\S]*\}\s+from\s+'\.\.\/\.\.\/\.\.\/utils\/audioUtils\.js'/, 'MediaAttachment deve importar de audioUtils.js');
});

test('REGRESSAO: Conversations.jsx exporta componente principal e integra com modulos modulares', () => {
  const filePath = path.join(__dirname, '../../src/features/conversations/components/Conversations.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /export function Conversations\(/, 'Conversations deve ser exportada');
  assert.match(code, /import\s+\{\s*MediaAttachment\s*\}\s+from\s+'\.\/MediaAttachment\.jsx'/, 'Conversations deve importar MediaAttachment');
  assert.match(code, /import\s+\{\s*LocationAttachment\s*\}\s+from\s+'\.\/LocationAttachment\.jsx'/, 'Conversations deve importar LocationAttachment');
  assert.match(code, /import\s+\{\s*TranscribedAudioCard\s*\}\s+from\s+'\.\/TranscribedAudioCard\.jsx'/, 'Conversations deve importar TranscribedAudioCard');
  assert.match(code, /import\s+\{\s*AudioRecoveryNotice\s*\}\s+from\s+'\.\/AudioRecoveryNotice\.jsx'/, 'Conversations deve importar AudioRecoveryNotice');
  assert.match(code, /import\s+\{\s*MediaMeta\s*\}\s+from\s+'\.\/MediaMeta\.jsx'/, 'Conversations deve importar MediaMeta');
  assert.match(code, /import\s+\{\s*EmptyState\s*\}\s+from\s+'\.\.\/\.\.\/\.\.\/components\/ui\/EmptyState\.jsx'/, 'Conversations deve importar EmptyState');
  assert.match(code, /import\s+\{[\s\S]*groupTimelineMessages[\s\S]*\}\s+from\s+'\.\.\/utils\/chatTimelineHelpers\.js'/, 'Conversations deve importar de chatTimelineHelpers.js');
  assert.match(code, /import\s+\{[\s\S]*getStageLabel[\s\S]*\}\s+from\s+'\.\.\/\.\.\/\.\.\/dataService\.js'/, 'Conversations deve importar de dataService.js');
});


