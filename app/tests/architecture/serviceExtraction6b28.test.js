import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsPath = path.join(__dirname, '../../src/features/conversations/components');
const composerPath = path.join(componentsPath, 'ConversationComposer.jsx');
const conversationsPath = path.join(componentsPath, 'Conversations.jsx');

test('6B.28 extrai o composer preservando elementos, classes e refs no componente-pai', () => {
  assert.ok(fs.existsSync(composerPath), 'ConversationComposer deve existir');
  const composer = fs.readFileSync(composerPath, 'utf8');
  const conversations = fs.readFileSync(conversationsPath, 'utf8');

  assert.match(composer, /export function ConversationComposer\(/);
  assert.match(composer, /className="composer"/);
  assert.match(composer, /className="composer-textarea"/);
  assert.match(composer, /className="primary-button composer-send-btn"/);
  assert.match(composer, /className="composer-recording-bar"/);
  assert.match(composer, /ref=\{composerInputRef\}/);
  assert.match(composer, /ref=\{fileInputRef\}/);
  assert.match(composer, /ref=\{attachMenuRef\}/);
  assert.match(composer, /ref=\{emojiPickerRef\}/);
  assert.match(composer, /ref=\{attachBtnRef\}/);
  assert.match(composer, /ref=\{emojiBtnRef\}/);
  assert.match(conversations, /<ConversationComposer[\s\S]*draft=\{draft\}/);
  assert.doesNotMatch(conversations, /<div className="composer">/);
});

test('6B.28 composer não possui referências livres nem ciclo com Conversations', () => {
  assert.ok(fs.existsSync(composerPath), 'ConversationComposer deve existir');
  const composer = fs.readFileSync(composerPath, 'utf8');
  const ast = parser.parse(composer, { sourceType: 'module', plugins: ['jsx'] });
  const free = new Set();
  const globals = new Set(['String', 'Array', 'Boolean', 'undefined', 'Math']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], []);
  assert.doesNotMatch(composer, /from ['"]\.\/Conversations(?:\.jsx)?['"]/);
});

test('6B.28 contratos de comportamento: digitação, Enter vs Shift+Enter, bloqueio, áudio e anexos', () => {
  const composer = fs.readFileSync(composerPath, 'utf8');

  // Enter vs Shift+Enter
  assert.match(composer, /if\s*\(\s*event\.key\s*===\s*'Enter'\s*&&\s*!event\.shiftKey\s*\)/, 'Deve checar Enter sem Shift');
  assert.match(composer, /event\.preventDefault\?\.\(\)/, 'Deve prevenir default ao pressionar Enter simples');
  assert.match(composer, /sendManualReply\?\.\(\)/, 'Deve chamar sendManualReply ao pressionar Enter simples');

  // Envio bloqueado e prevenção de envio duplicado
  assert.match(composer, /disabled=\{sending\s*\|\|\s*\(!draft\.trim\(\)\s*&&\s*!attachment\)\}/, 'Envio deve ser desabilitado quando sending ou sem texto/anexo');

  // Anexos e mídias
  assert.match(composer, /className="composer-attachment-preview"/, 'Deve renderizar o container de preview do anexo');
  assert.match(composer, /formatFileSize\(attachment\.size\)/, 'Deve formatar o tamanho do anexo com formatFileSize');
  assert.match(composer, /onClick=\{handleRemoveAttachment\}/, 'Deve acionar handleRemoveAttachment para remoção');
  assert.match(composer, /className="attachment-audio-preview-player"/, 'Deve renderizar player de áudio para anexo sonoro');

  // Gravação de áudio
  assert.match(composer, /isRecording\s*\?/, 'Deve alternar entre modo de gravação e modo de texto');
  assert.match(composer, /className="composer-recording-bar"/, 'Deve renderizar a barra de gravação');
  assert.match(composer, /formatRecordingTimer\(recordingDuration\)/, 'Deve exibir tempo de gravação formatado');
  assert.match(composer, /onClick=\{cancelAudioRecording\}/, 'Botão de cancelar gravação deve invocar cancelAudioRecording');
  assert.match(composer, /onClick=\{stopAndSaveAudioRecording\}/, 'Botão de concluir gravação deve invocar stopAndSaveAudioRecording');

  // Popovers de emoji e anexo
  assert.match(composer, /showAttachMenu\s*&&[\s\S]*attachment-menu-popover/, 'Deve abrir popover de anexos');
  assert.match(composer, /showEmojiPicker\s*&&[\s\S]*emoji-picker-popover/, 'Deve abrir popover de emojis');

  // Status de IA e erros inline
  assert.match(composer, /className="composer-ai-hint"/, 'Deve exibir aviso quando IA estiver ativa');
  assert.match(composer, /sendError\s*&&[\s\S]*className="inline-error"/, 'Deve renderizar mensagens de erro inline');
});

test('6B.28 teste funcional com mocks: despacho de eventos de teclado, bloqueio de envio e botões', () => {
  const esbuild = createRequire(import.meta.url)('esbuild');
  const customRequire = createRequire(composerPath);

  const code = fs.readFileSync(composerPath, 'utf8');
  const compiled = esbuild.transformSync(code, { loader: 'jsx', format: 'cjs' });

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', compiled.code);
  fn(customRequire, mod, mod.exports);

  const { ConversationComposer } = mod.exports;

  // 1. Enter simples vs Shift+Enter
  let sentCount = 0;
  let prevented = false;
  let newDraft = '';

  const vnode = ConversationComposer({
    draft: 'Mensagem de teste',
    sending: false,
    setDraft: (val) => { newDraft = val; },
    sendManualReply: () => { sentCount += 1; },
  });

  const findElement = (node, predicate) => {
    if (!node) return null;
    if (predicate(node)) return node;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, predicate);
        if (found) return found;
      }
    }
    if (node.props?.children) {
      return findElement(node.props.children, predicate);
    }
    return null;
  };

  const textarea = findElement(vnode, n => n.type === 'textarea');
  assert.ok(textarea, 'textarea deve existir no VNode');

  // Disparo Enter simples
  textarea.props.onKeyDown({
    key: 'Enter',
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true, 'Enter simples deve prevenir default');
  assert.equal(sentCount, 1, 'Enter simples deve disparar sendManualReply');

  // Disparo Shift+Enter
  prevented = false;
  sentCount = 0;
  textarea.props.onKeyDown({
    key: 'Enter',
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, false, 'Shift+Enter não deve prevenir default');
  assert.equal(sentCount, 0, 'Shift+Enter não deve enviar mensagem');

  // Digitação no textarea
  const fakeEvent = { target: { value: 'Novo texto', scrollHeight: 50, style: {} } };
  textarea.props.onChange(fakeEvent);
  assert.equal(newDraft, 'Novo texto', 'onChange deve repassar novo texto para setDraft');
  assert.equal(fakeEvent.target.style.height, '50px', 'onChange deve ajustar altura do textarea');

  // 2. Envio bloqueado
  const vnodeDisabled = ConversationComposer({
    draft: '   ',
    attachment: null,
    sending: false,
  });
  const sendBtnDisabled = findElement(vnodeDisabled, n => n.props?.className?.includes('composer-send-btn'));
  assert.equal(sendBtnDisabled.props.disabled, true, 'Botão deve estar desabilitado quando vazio');

  const vnodeSending = ConversationComposer({
    draft: 'Texto',
    sending: true,
  });
  const sendBtnSending = findElement(vnodeSending, n => n.props?.className?.includes('composer-send-btn'));
  assert.equal(sendBtnSending.props.disabled, true, 'Botão deve estar desabilitado quando sending for true');

  // 3. Gravação de áudio
  let cancelFired = false;
  let saveFired = false;
  const vnodeRecording = ConversationComposer({
    isRecording: true,
    recordingDuration: 125,
    cancelAudioRecording: () => { cancelFired = true; },
    stopAndSaveAudioRecording: () => { saveFired = true; },
  });
  const timer = findElement(vnodeRecording, n => n.props?.className === 'recording-timer');
  assert.equal(timer?.props?.children, '02:05', 'Timer deve formatar 125s como 02:05');

  const cancelBtn = findElement(vnodeRecording, n => n.props?.className === 'recording-cancel-btn');
  cancelBtn.props.onClick();
  assert.equal(cancelFired, true, 'Botão cancelar deve disparar cancelAudioRecording');

  const finishBtn = findElement(vnodeRecording, n => n.props?.className === 'recording-finish-btn');
  finishBtn.props.onClick();
  assert.equal(saveFired, true, 'Botão concluir deve disparar stopAndSaveAudioRecording');

  // 4. Remoção de anexo
  let removeFired = false;
  const vnodeAttachment = ConversationComposer({
    attachment: { name: 'arquivo.pdf', size: 2048, category: 'document' },
    handleRemoveAttachment: () => { removeFired = true; },
  });
  const removeBtn = findElement(vnodeAttachment, n => n.props?.className === 'attachment-preview-remove');
  removeBtn.props.onClick();
  assert.equal(removeFired, true, 'Remover anexo deve acionar handleRemoveAttachment');
});
