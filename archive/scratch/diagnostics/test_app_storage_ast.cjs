const fs = require('fs');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const appStorageCandidate = `import { isAuthRequired } from '../authService.js';
import { emptyFunnel, emptyKanban, hasSupabaseConfig } from '../dataService.js';
import { conversations, funnelStages, kanbanColumns } from '../mockData.js';

export const activePageStorageKey = 'magia:active-page';
export const appDataCachePrefix = 'magia:app-data:';
export const sessionBootstrappedKey = 'noria:session-bootstrapped';

export const DEFAULT_ACTIVE_PAGES = [
  'dashboard',
  'conversas',
  'kanban',
  'disparos',
  'agendamentos',
  'configuracoes',
];

export function isSessionBootstrapped() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage?.getItem(sessionBootstrappedKey) === '1';
  } catch (e) {
    return false;
  }
}

export function setSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(sessionBootstrappedKey, '1');
    }
  } catch (e) {}
}

export function clearSessionBootstrapped() {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(sessionBootstrappedKey);
    }
  } catch (e) {}
}

export function getInitialActivePage(menuList = null) {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(activePageStorageKey) : null;
    if (Array.isArray(menuList)) {
      return menuList.some((item) => item?.id === stored) ? stored : 'dashboard';
    }
    return DEFAULT_ACTIVE_PAGES.includes(stored) ? stored : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export function appDataSignature(value) {
  return JSON.stringify(value, (key, entry) => (
    key === 'url' || key === 'thumbnailUrl' ? undefined : entry
  ));
}

export function loadCachedAppData(tenantSlug) {
  if (isAuthRequired()) return null;
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(\`\${appDataCachePrefix}\${tenantSlug}\`) : null;
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.conversations ? cached : null;
  } catch {
    return null;
  }
}

export function cacheAppData(tenantSlug, data) {
  if (isAuthRequired()) return;
  try {
    const serialized = JSON.stringify(data, (key, value) => (
      key === 'url' || key === 'thumbnailUrl' ? undefined : value
    ));
    if (serialized.length <= 2_000_000 && typeof window !== 'undefined') {
      localStorage.setItem(\`\${appDataCachePrefix}\${tenantSlug}\`, serialized);
    }
  } catch {
    // Cache local é opcional: quota cheia nunca deve afetar o painel.
  }
}

export function getInitialAppData(tenantSlug) {
  const cached = loadCachedAppData(tenantSlug);
  if (cached) return { data: cached, ready: true };
  if (hasSupabaseConfig()) {
    return {
      data: {
        conversations: [],
        kanbanColumns: emptyKanban(),
        funnelStages: emptyFunnel(),
        source: 'supabase',
        status: {
          source: 'supabase',
          botUsername: '',
          channel: '',
          supabase: true,
          ai: 'Regras e automações',
          latestAt: 'Sincronizando...',
          humanQueue: 0,
        },
        appointments: [],
        broadcastContacts: [],
        broadcastCampaigns: [],
        conversationReads: [],
        tenantId: null,
      },
      ready: false,
    };
  }
  return {
    data: {
      conversations,
      kanbanColumns,
      funnelStages,
      source: 'mock',
      status: null,
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
      conversationReads: [],
      tenantId: null,
    },
    ready: true,
  };
}
`;

const ast = parser.parse(appStorageCandidate, { sourceType: 'module' });

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

console.log('Undefined references in proposed appStorage.js:', Array.from(undefinedRefs));
