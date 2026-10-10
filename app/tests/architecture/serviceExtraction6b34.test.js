import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

import { markConversationRead } from '../../src/services/reads/conversationDataReads.js';
import { shouldRefreshConversationState, createDebouncedRealtimeRefresh } from '../../src/services/timeline/realtimeRefresh.js';
import { getInitialTenantSlug, persistTenantSlug, hasSupabaseConfig, defaultTenantSlug } from '../../src/services/tenants/tenantStorage.js';
import {
  statusLabels,
  getConversationLastMessageOrigin,
  getConversationLastMessageMeta,
} from '../../src/features/dashboard/utils/dashboardHelpers.js';
import * as dataService from '../../src/dataService.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('6B.34 markConversationRead normaliza canais, dispara RPC e trata retornos/erros', async () => {
  // 1. Chamada bem-sucedida via RPC
  let rpcCalledWith = null;
  const mockSupabase = {
    rpc: async (fn, params) => {
      rpcCalledWith = { fn, params };
      return { data: [{ last_read_event_id: 'ev-1', updated_at: '2026-10-09' }], error: null };
    },
  };

  const res = await markConversationRead(mockSupabase, {
    tenantId: 'tenant-123',
    channelType: 'WhatsApp',
    externalConversationId: '5511999998888',
    lastReadEventId: 'ev-1',
  });

  assert.equal(rpcCalledWith.fn, 'mark_conversation_read');
  assert.equal(rpcCalledWith.params.p_tenant_id, 'tenant-123');
  assert.equal(rpcCalledWith.params.p_channel_type, 'whatsapp');
  assert.equal(rpcCalledWith.params.p_external_conversation_id, '5511999998888@s.whatsapp.net');
  assert.equal(rpcCalledWith.params.p_last_read_event_id, 'ev-1');
  assert.deepEqual(res, { last_read_event_id: 'ev-1', updated_at: '2026-10-09' });

  // 2. Erro de RPC é propagado
  const failingSupabase = {
    rpc: async () => ({ data: null, error: new Error('Falha no banco') }),
  };
  await assert.rejects(
    async () => markConversationRead(failingSupabase, { tenantId: 't1' }),
    /Falha no banco/
  );

  // 3. Cliente ausente lança erro fechado
  await assert.rejects(
    async () => markConversationRead(null, { tenantId: 't1' }),
    /Supabase nao configurado/
  );
});

test('6B.34 shouldRefreshConversationState e createDebouncedRealtimeRefresh', async () => {
  // shouldRefreshConversationState
  assert.equal(shouldRefreshConversationState({ handoff: true }), true);
  assert.equal(shouldRefreshConversationState({ service: 'handoff_requested' }), true);
  assert.equal(shouldRefreshConversationState({ service: 'conversation_closed' }), true);
  assert.equal(shouldRefreshConversationState({ service: 'sales_stage_changed' }), true);
  assert.equal(shouldRefreshConversationState({ event_type: 'kanban_stage_changed' }), true);
  assert.equal(shouldRefreshConversationState({ text: 'Olá' }), false);
  assert.equal(shouldRefreshConversationState({}), false);

  // createDebouncedRealtimeRefresh
  let count = 0;
  const debounced = createDebouncedRealtimeRefresh(() => { count++; }, 30);
  debounced();
  debounced();
  debounced();
  assert.equal(count, 0, 'Não deve disparar sincronamente');

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(count, 1, 'Deve disparar apenas uma vez após o delay');

  // Cancelamento
  debounced();
  debounced.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(count, 1, 'Não deve disparar se cancelado');
});

test('6B.34 tenantStorage: getInitialTenantSlug, persistTenantSlug e hasSupabaseConfig', () => {
  // hasSupabaseConfig
  assert.equal(hasSupabaseConfig('https://example.supabase.co', 'anon-key-123'), true);
  assert.equal(hasSupabaseConfig('', 'anon-key-123'), false);
  assert.equal(hasSupabaseConfig('https://example.supabase.co', ''), false);
  assert.equal(hasSupabaseConfig(null, null), false);

  // getInitialTenantSlug requires an explicit fallback outside browser selection.
  assert.equal(defaultTenantSlug, null);
  assert.equal(getInitialTenantSlug(), null);
  assert.equal(getInitialTenantSlug('custom-fallback'), 'custom-fallback');
});

test('6B.34 dashboardHelpers: origem e metadata de mensagens recentes', () => {
  assert.equal(statusLabels.ia_ativa, 'Bot ativo');
  assert.equal(statusLabels.atendimento_humano, 'Atendimento humano');

  // getConversationLastMessageOrigin
  assert.equal(getConversationLastMessageOrigin(null), null);
  assert.equal(getConversationLastMessageOrigin({ lastMessageSender: 'Operador VIP' }), 'Operador VIP');
  assert.equal(getConversationLastMessageOrigin({ messages: [{ from: 'ai' }] }), 'IA');
  assert.equal(getConversationLastMessageOrigin({ messages: [{ from: 'agent', sent_by: 'Carlos' }] }), 'Carlos');
  assert.equal(getConversationLastMessageOrigin({ messages: [{ from: 'system' }] }), 'Sistema');
  assert.equal(getConversationLastMessageOrigin({ messages: [{ from: 'contact' }] }), 'Cliente');

  // getConversationLastMessageMeta
  const audioMeta = getConversationLastMessageMeta({ messages: [{ media: { kind: 'audio' } }] });
  assert.equal(audioMeta.type, 'audio');
  assert.equal(audioMeta.label, 'Áudio');

  const videoMeta = getConversationLastMessageMeta({ lastMessage: '[video]' });
  assert.equal(videoMeta.type, 'video');
  assert.equal(videoMeta.label, 'Vídeo');

  const docMeta = getConversationLastMessageMeta({ lastMessage: 'contrato.pdf' });
  assert.equal(docMeta.type, 'document');
  assert.equal(docMeta.label, 'Documento');

  const locationMeta = getConversationLastMessageMeta({ messages: [{ location: { lat: 10, lng: 20 } }] });
  assert.equal(locationMeta.type, 'location');
  assert.equal(locationMeta.label, 'Localização');

  const textMeta = getConversationLastMessageMeta({ lastMessage: 'Bom dia' });
  assert.equal(textMeta.type, 'text');
  assert.equal(textMeta.label, '');
});

test('6B.34 dataService.js preserva rigorosamente todos os 106 exports públicos após modularização', () => {
  const exportsList = Object.keys(dataService).sort();
  assert.equal(exportsList.length, 106, 'dataService deve preservar exatamente 106 exports públicos');

  // Verificação explícita dos símbolos delegados nesta etapa
  assert.ok(exportsList.includes('markConversationRead'));
  assert.ok(exportsList.includes('shouldRefreshConversationState'));
  assert.ok(exportsList.includes('createDebouncedRealtimeRefresh'));
  assert.ok(exportsList.includes('hasSupabaseConfig'));
  assert.ok(exportsList.includes('getInitialTenantSlug'));
  assert.ok(exportsList.includes('persistTenantSlug'));
  assert.ok(exportsList.includes('validateKanbanOrderProposal'));
});
