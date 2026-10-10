const fs = require('fs');
const path = require('path');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const mainPath = path.resolve(__dirname, '../app/src/main.jsx');
const mainCode = fs.readFileSync(mainPath, 'utf8');

// Lines 216 to 1149:
// Extract menu, mediaRetryDelays, withLocalMediaLoadState, hasResolvedMediaUrl, formatCurrency, and function App
const startMarker = 'const menu = [';
const endMarker = 'function formatConversationPreview(message, media = null)';

const startIdx = mainCode.indexOf(startMarker);
const endIdx = mainCode.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found!', { startIdx, endIdx });
  process.exit(1);
}

const appBlock = mainCode.slice(startIdx, endIdx).trim();

const appImports = `import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarDays,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  RefreshCcw,
  Settings,
  X,
} from 'lucide-react';
import { NoriaSelect } from '../components/NoriaSelect';
import {
  conversations,
  funnelStages,
  kanbanColumns,
  tenants as mockTenants,
} from '../mockData';
import {
  getCurrentSession,
  isAuthRequired,
  signOut,
  subscribeToAuthState,
} from '../authService';
import { getIntegrationStatus, sendN8nCommand } from '../integration';
import {
  applyContactUpdateToConversations,
  applyConversationReadState,
  applyIncomingEventToConversations,
  applyIncomingEventToKanban,
  canonicalConversationKey,
  conversationReadKey,
  createDebouncedRealtimeRefresh,
  enrichSingleMediaEvent,
  getInitialTenantSlug,
  getLatestReadableEvent,
  getStageLabel,
  hasStoredMediaNeedingUrl,
  hasSupabaseConfig,
  isGenesisSalesTenant,
  loadAvailableTenants,
  loadClientData,
  loadTeamAgents,
  loadTenantSettings,
  markConversationRead,
  moveKanbanCard,
  persistTenantSlug,
  removeTeamAgent,
  saveTeamAgent,
  shouldAdvanceConversationRead,
  shouldRefreshConversationState,
  sortKanbanCardsByConversationActivity,
  subscribeToClientEvents,
  subscribeToContacts,
  subscribeToConversationReads,
  updateTeamAgentStatus,
  upsertConversationReadMarker,
} from '../dataService';
import { isTenantAuthorized } from '../tenantAccess';
import { Dashboard } from '../features/dashboard/components/Dashboard';
import { Funnel } from '../features/kanban/components/Funnel';
import { Conversations } from '../features/conversations/components/Conversations';
import { Kanban } from '../features/kanban/components/Kanban';
import { Broadcasts } from '../features/broadcasts/components/Broadcasts';
import { Appointments } from '../features/appointments/components/Appointments';
import { SettingsPage } from '../features/settings/components/SettingsPage';
import { AuthShell } from '../features/auth/components/AuthShell';
import { LoginPage } from '../features/auth/components/LoginPage';
import {
  activePageStorageKey,
  appDataCachePrefix,
  appDataSignature,
  cacheAppData,
  clearSessionBootstrapped,
  getInitialActivePage,
  getInitialAppData,
  isSessionBootstrapped,
  loadCachedAppData,
  setSessionBootstrapped,
} from './appStorage';
import noriaLogo from '../assets/noria_logo.png';
`;

// Export App as both named and default export
const appFileContent = `${appImports}\r\n${appBlock}\r\n\r\nexport { App, menu };\r\nexport default App;\r\n`;

console.log('Validating App.jsx AST...');
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

try {
  const ast = parser.parse(appFileContent, { sourceType: 'module', plugins: ['jsx'] });
  console.log('App.jsx parsed successfully!');

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

  console.log('Undefined references in App.jsx:', Array.from(undefinedRefs));
} catch (e) {
  console.error('App.jsx AST error:', e);
}

// Test updating main.jsx
let updatedMain = mainCode.slice(0, startIdx) + mainCode.slice(endIdx);
updatedMain = updatedMain.replace(
  "import { AppErrorBoundary } from './app/AppErrorBoundary';",
  "import { App } from './app/App';\r\nimport { AppErrorBoundary } from './app/AppErrorBoundary';"
);

try {
  const astMain = parser.parse(updatedMain, { sourceType: 'module', plugins: ['jsx'] });
  console.log('updatedMain AST parsed successfully!');
  const undefinedRefsMain = new Set();
  traverse(astMain, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) {
        undefinedRefsMain.add(name);
      }
    },
    JSXIdentifier(p) {
      const name = p.node.name;
      if (name[0] === name[0].toUpperCase()) {
        if (!p.scope.hasBinding(name) && !jsGlobals.has(name)) {
          undefinedRefsMain.add(name);
        }
      }
    }
  });
  console.log('Undefined references in updatedMain:', Array.from(undefinedRefsMain));
  console.log('Original main lines:', mainCode.split(/\r?\n/).length);
  console.log('Updated main lines:', updatedMain.split(/\r?\n/).length);
  console.log('Lines reduced:', mainCode.split(/\r?\n/).length - updatedMain.split(/\r?\n/).length);
} catch (e) {
  console.error('updatedMain AST error:', e);
}
