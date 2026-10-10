import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  displayContactPhone,
  displayContactName,
  contactKey,
  conversationToBroadcastContact,
  mergeBroadcastContacts,
} from '../../src/features/broadcasts/utils/broadcastImport.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('displayContactPhone formata numero brasileiro e remove sufixos de canal', () => {
  assert.equal(
    displayContactPhone({ phone: '5511999998888@s.whatsapp.net' }),
    '+55 11 99999-8888'
  );
  assert.equal(
    displayContactPhone({ external_conversation_id: '5521988887777@c.us' }),
    '+55 21 98888-7777'
  );
  assert.equal(
    displayContactPhone({ externalConversationId: 'telegram_user_123@telegram' }),
    'telegram_user_123'
  );
  assert.equal(displayContactPhone({}), 'Telefone não informado');
  assert.equal(displayContactPhone(null), 'Telefone não informado');
});

test('displayContactName exibe nome legivel ou faz fallback seguro para telefone', () => {
  assert.equal(
    displayContactName({ display_name: 'Maria Silva', phone: '5511999998888' }),
    'Maria Silva'
  );
  // Quando o nome for um JID técnico bruto, deve fazer fallback para o telefone formatado
  assert.equal(
    displayContactName({ display_name: '5511999998888@s.whatsapp.net', phone: '5511999998888' }),
    '+55 11 99999-8888'
  );
  // Quando o nome estiver ausente, deve fazer fallback para o telefone formatado
  assert.equal(
    displayContactName({ phone: '5511999998888' }),
    '+55 11 99999-8888'
  );
  // Quando ambos estiverem ausentes
  assert.equal(displayContactName({}), 'Telefone não informado');
});

test('REGRESSAO: Broadcasts.jsx possui todas as dependencias declaradas e importadas (sem ReferenceError)', () => {
  const filePath = path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx');
  const code = fs.readFileSync(filePath, 'utf8');

  // Verifica explicitamente que as dependencias essenciais estao presentes nos imports
  assert.match(code, /displayContactName/, 'Broadcasts.jsx deve conter displayContactName');
  assert.match(code, /displayContactPhone/, 'Broadcasts.jsx deve conter displayContactPhone');

  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement'
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
    `Broadcasts.jsx nao pode ter identificadores livres/indefinidos: ${Array.from(undefinedRefs).join(', ')}`
  );
});

test('REGRESSAO: todos os modulos UI e features modularizados possuem zero referencias indefinidas', () => {
  const filesToCheck = [
    'components/ui/Skeletons.jsx',
    'components/ui/ChannelIcon.jsx',
    'components/ui/ContactAvatar.jsx',
    'components/ui/PanelTitle.jsx',
    'components/ui/EmptyState.jsx',
    'components/ui/Badge.jsx',
    'app/AppErrorBoundary.jsx',
    'features/auth/components/AuthShell.jsx',
    'features/auth/components/LoginPage.jsx',
    'features/dashboard/components/Dashboard.jsx',
    'features/broadcasts/components/Broadcasts.jsx',
    'features/appointments/components/Appointments.jsx',
    'features/settings/components/SettingsPage.jsx',
    'features/kanban/hooks/useKanbanScroll.js',
    'features/kanban/components/Funnel.jsx',
    'features/kanban/components/Kanban.jsx',
  ];

  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement'
  ]);

  for (const relPath of filesToCheck) {
    const fullPath = path.join(__dirname, '../../src', relPath);
    if (!fs.existsSync(fullPath)) continue;
    const code = fs.readFileSync(fullPath, 'utf8');
    const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
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
      `${relPath} possui identificadores livres: ${Array.from(undefinedRefs).join(', ')}`
    );
  }
});
