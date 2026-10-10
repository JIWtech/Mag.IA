const fs = require('fs');
const path = require('path');

const mainPath = path.resolve(__dirname, '../app/src/main.jsx');
const appPath = path.resolve(__dirname, '../app/src/app/App.jsx');

const mainCode = fs.readFileSync(mainPath, 'utf8');

const startMarker = 'const menu = [';
const endMarker = 'function formatConversationPreview(message, media = null)';

const startIdx = mainCode.indexOf(startMarker);
const endIdx = mainCode.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  throw new Error('Markers not found in main.jsx!');
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

let appContent = `${appImports}\r\n${appBlock}\r\n\r\nexport { App, menu };\r\nexport default App;\r\n`;

// Ensure CRLF
appContent = appContent.replace(/\r?\n/g, '\r\n');

fs.writeFileSync(appPath, appContent, 'utf8');
console.log('Created app/src/app/App.jsx!');

// Update main.jsx:
// Replace the extracted block with a single empty line, and import App from './app/App'
let updatedMain = mainCode.slice(0, startIdx) + mainCode.slice(endIdx);
updatedMain = updatedMain.replace(
  "import { AppErrorBoundary } from './app/AppErrorBoundary';",
  "import { App } from './app/App';\r\nimport { AppErrorBoundary } from './app/AppErrorBoundary';"
);

// Ensure CRLF
updatedMain = updatedMain.replace(/\r?\n/g, '\r\n');

fs.writeFileSync(mainPath, updatedMain, 'utf8');
console.log('Updated app/src/main.jsx!');
