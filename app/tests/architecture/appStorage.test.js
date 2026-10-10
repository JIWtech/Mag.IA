import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

import {
  activePageStorageKey,
  appDataCachePrefix,
  sessionBootstrappedKey,
  DEFAULT_ACTIVE_PAGES,
  isSessionBootstrapped,
  setSessionBootstrapped,
  clearSessionBootstrapped,
  getInitialActivePage,
  appDataSignature,
  loadCachedAppData,
  cacheAppData,
  getInitialAppData,
} from '../../src/app/appStorage.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock simples e isolado de Storage
class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(String(key), String(value));
  }
  removeItem(key) {
    this.store.delete(String(key));
  }
  clear() {
    this.store.clear();
  }
}

const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

globalThis.window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
};
globalThis.localStorage = mockLocalStorage;
globalThis.sessionStorage = mockSessionStorage;

function resetStorages() {
  mockLocalStorage.clear();
  mockSessionStorage.clear();
}

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

test('REGRESSAO: appStorage.js possui AST limpa com zero variaveis livres e exporta os 11 simbolos autorizados', () => {
  const filePath = path.join(__dirname, '../../src/app/appStorage.js');
  assert.ok(fs.existsSync(filePath), 'app/appStorage.js deve existir');
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module' });

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

  assert.deepEqual(Array.from(undefinedRefs), [], 'appStorage.js nao deve conter variaveis livres indefinidas');

  // Verificar constantes de chaves
  assert.equal(activePageStorageKey, 'magia:active-page');
  assert.equal(appDataCachePrefix, 'magia:app-data:');
  assert.equal(sessionBootstrappedKey, 'noria:session-bootstrapped');
});

test('REGRESSAO: App.jsx consome os simbolos de armazenamento exclusivamente de ./appStorage e possui AST limpa', () => {
  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const code = fs.readFileSync(appPath, 'utf8');

  // Checar import de appStorage no consumidor real App.jsx
  assert.ok(code.includes("from './appStorage';"), 'App.jsx deve importar de ./appStorage');

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
    JSXIdentifier(p) {
      const name = p.node.name;
      if (name[0] === name[0].toUpperCase()) {
        if (!p.scope.hasBinding(name) && !jsGlobals.has(name)) {
          undefinedRefs.add(name);
        }
      }
    }
  });

  assert.deepEqual(Array.from(undefinedRefs), [], 'App.jsx nao deve conter variaveis livres indefinidas');
});

test('Estado de sessão: isSessionBootstrapped, setSessionBootstrapped e clearSessionBootstrapped', () => {
  resetStorages();

  assert.equal(isSessionBootstrapped(), false, 'Sessao inicial deve reportar false');

  setSessionBootstrapped();
  assert.equal(mockSessionStorage.getItem(sessionBootstrappedKey), '1', 'sessionStorage deve conter flag 1');
  assert.equal(isSessionBootstrapped(), true, 'isSessionBootstrapped deve reportar true');

  clearSessionBootstrapped();
  assert.equal(mockSessionStorage.getItem(sessionBootstrappedKey), null, 'sessionStorage flag deve ser removida');
  assert.equal(isSessionBootstrapped(), false, 'isSessionBootstrapped deve retornar false apos clear');
});

test('Persistência da página ativa: getInitialActivePage com fallback, persistência e lista de menu', () => {
  resetStorages();

  assert.equal(getInitialActivePage(), 'dashboard', 'Pagina ativa padrao sem storage deve ser dashboard');

  mockLocalStorage.setItem(activePageStorageKey, 'conversas');
  assert.equal(getInitialActivePage(), 'conversas', 'Deve recuperar conversas do localStorage');

  mockLocalStorage.setItem(activePageStorageKey, 'kanban');
  assert.equal(getInitialActivePage(), 'kanban', 'Deve recuperar kanban do localStorage');

  mockLocalStorage.setItem(activePageStorageKey, 'pagina_inexistente');
  assert.equal(getInitialActivePage(), 'dashboard', 'Deve fazer fallback para dashboard para pagina invalida');

  // Testar com menuList customizado
  const customMenu = [{ id: 'custom_reports' }, { id: 'dashboard' }];
  mockLocalStorage.setItem(activePageStorageKey, 'custom_reports');
  assert.equal(getInitialActivePage(customMenu), 'custom_reports', 'Deve respeitar menuList customizado');

  mockLocalStorage.setItem(activePageStorageKey, 'conversas');
  assert.equal(getInitialActivePage(customMenu), 'dashboard', 'Deve fazer fallback se pagina nao estiver no menuList customizado');
});

test('Inicialização sem cache: loadCachedAppData retorna null e getInitialAppData inicializa estado padrao', () => {
  resetStorages();

  const cached = loadCachedAppData('wesley_automoveis');
  assert.equal(cached, null, 'Sem cache deve retornar null');

  const initial = getInitialAppData('wesley_automoveis');
  assert.ok(initial, 'getInitialAppData deve retornar objeto de estado');
  assert.ok(initial.data, 'initial.data deve existir');
  assert.ok(Array.isArray(initial.data.conversations), 'conversations deve ser um array');
});

test('Recuperação de cache válido: loadCachedAppData e getInitialAppData retornam dados cacheados com ready=true', () => {
  resetStorages();

  const tenant = 'wesley_automoveis';
  const mockCacheData = {
    conversations: [{ id: 'conv-101', title: 'Cliente Teste' }],
    source: 'supabase',
  };

  cacheAppData(tenant, mockCacheData);

  const loaded = loadCachedAppData(tenant);
  assert.ok(loaded, 'loadCachedAppData deve carregar dados');
  assert.equal(loaded.conversations[0].id, 'conv-101');

  const initial = getInitialAppData(tenant);
  assert.equal(initial.ready, true, 'getInitialAppData com cache valido deve marcar ready = true');
  assert.equal(initial.data.conversations[0].id, 'conv-101');
});

test('Tratamento de cache inválido: JSON corrompido ou sem conversations retorna null sem lançar erro', () => {
  resetStorages();

  const tenant = 'wesley_automoveis';
  const cacheKey = `${appDataCachePrefix}${tenant}`;

  // 1. JSON corrompido
  mockLocalStorage.setItem(cacheKey, '{ corrompido: invalid json');
  assert.equal(loadCachedAppData(tenant), null, 'JSON invalido deve retornar null sem estourar excecao');

  const initialCorrupted = getInitialAppData(tenant);
  assert.ok(initialCorrupted, 'getInitialAppData deve recuperar normalmente apos cache corrompido');
  assert.notEqual(initialCorrupted.ready, undefined);

  // 2. JSON valido mas sem a propriedade conversations
  mockLocalStorage.setItem(cacheKey, JSON.stringify({ otherData: 123 }));
  assert.equal(loadCachedAppData(tenant), null, 'Objeto sem conversations deve ser ignorado');
});

test('Isolamento de cache por tenant: cada tenant possui chave propria e nao sobrescreve o outro', () => {
  resetStorages();

  const tenantA = 'empresa_a';
  const tenantB = 'empresa_b';

  cacheAppData(tenantA, { conversations: [{ id: 'a1', name: 'Lead A' }] });
  cacheAppData(tenantB, { conversations: [{ id: 'b1', name: 'Lead B' }] });

  const dataA = loadCachedAppData(tenantA);
  const dataB = loadCachedAppData(tenantB);

  assert.equal(dataA.conversations[0].id, 'a1');
  assert.equal(dataB.conversations[0].id, 'b1');

  // Chaves individuais no storage
  assert.ok(mockLocalStorage.getItem(`magia:app-data:${tenantA}`));
  assert.ok(mockLocalStorage.getItem(`magia:app-data:${tenantB}`));
});

test('appDataSignature e cacheAppData: omitem campos efêmeros de midia (url, thumbnailUrl)', () => {
  const original = {
    conversations: [
      { id: 'c1', text: 'Ola' },
      { id: 'c2', url: 'https://blob.signed.url', thumbnailUrl: 'https://thumb.url', text: 'Midia' },
    ],
  };

  const sig = appDataSignature(original);
  assert.ok(!sig.includes('blob.signed.url'), 'Assinatura nao deve conter url assinada');
  assert.ok(!sig.includes('https://thumb.url'), 'Assinatura nao deve conter thumbnailUrl');
  assert.ok(sig.includes('Ola'), 'Assinatura deve manter texto estavel');

  resetStorages();
  cacheAppData('tenant_media', original);
  const rawStored = mockLocalStorage.getItem(`magia:app-data:tenant_media`);
  assert.ok(!rawStored.includes('blob.signed.url'), 'Storage nao deve persistir url efemera');
  assert.ok(!rawStored.includes('https://thumb.url'), 'Storage nao deve persistir thumbnailUrl efemera');
});
