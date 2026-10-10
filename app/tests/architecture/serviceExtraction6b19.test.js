import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveKanbanCard } from '../../src/services/kanban/kanbanCardMovement.js';

function createSupabaseMock({ lead = { id: 'lead-1', revision: 4 }, leadError = null, rpc = { data: { id: 'lead-1', stage_key: 'sales_human', revision: 5, ai_locked: true }, error: null }, insertError = null } = {}) {
  const calls = [];
  const supabase = {
    calls,
    from(table) {
      calls.push(['from', table]);
      if (table === 'sales_leads') {
        const query = {
          select(value) { calls.push(['select', value]); return query; },
          eq(key, value) { calls.push(['eq', key, value]); return query; },
          async maybeSingle() { calls.push(['maybeSingle']); return { data: lead, error: leadError }; },
        };
        return query;
      }
      if (table === 'channel_events') {
        return {
          async insert(rows) { calls.push(['insert', rows]); return { error: insertError }; },
        };
      }
      throw new Error(`Tabela inesperada: ${table}`);
    },
    async rpc(name, payload) { calls.push(['rpc', name, payload]); return rpc; },
  };
  return supabase;
}

function movementWith(supabase, tenant = { id: 'tenant-1' }) {
  return createMoveKanbanCard({
    getClient: () => supabase,
    loadTenant: async (slug) => ({ ...tenant, slug }),
  });
}

const genesisCard = {
  id: 'card-1', externalConversationId: 'chat-1', channelType: 'whatsapp',
  targetColumnId: 'sales_new', salesStageKey: 'sales_new', owner: 'Ana', ownerKind: 'agent', ownerId: 'agent-1',
};

test('6B.19 Genesis consulta lead e chama RPC uma vez com tenant, conversa e revisao', async () => {
  const supabase = createSupabaseMock();
  const result = await movementWith(supabase)('wesley_automoveis', genesisCard, 'sales_human', null, { automationKey: 'sales_human', title: 'Atendimento humano' });

  assert.equal(result.length, 1);
  assert.equal(result[0].salesLeadId, 'lead-1');
  assert.equal(result[0].salesStageKey, 'sales_human');
  assert.deepEqual(supabase.calls, [
    ['from', 'sales_leads'], ['select', 'id, revision'], ['eq', 'tenant_id', 'tenant-1'], ['eq', 'channel_type', 'whatsapp'], ['eq', 'chat_id', 'chat-1'], ['maybeSingle'],
    ['rpc', 'magia_sales_move', { p_lead: 'lead-1', p_stage: 'sales_human', p_revision: 4 }],
  ]);
});

test('6B.19 Genesis fecha conversa em channel_events sem RPC', async () => {
  const supabase = createSupabaseMock();
  const result = await movementWith(supabase)('wesley_automoveis', genesisCard, 'conversation_closed');

  assert.equal(result[0].tenant_id, 'tenant-1');
  assert.equal(result[0].service, 'conversation_closed');
  assert.equal(supabase.calls.filter(([kind]) => kind === 'rpc').length, 0);
  assert.deepEqual(supabase.calls[0], ['from', 'channel_events']);
  assert.equal(supabase.calls[1][0], 'insert');
  assert.equal(supabase.calls[1][1].length, 1);
});

test('6B.19 Nubia grava um unico evento interno com tenant e transicao exatos', async () => {
  const supabase = createSupabaseMock();
  const result = await movementWith(supabase, { id: 'nubia-id' })('clinica_nubia_oficial', {
    id: 'nubia-card', externalConversationId: 'nubia-chat', channelType: 'whatsapp', stage: 'Qualificacao', targetColumnId: 'conversas_ia', title: 'Núbia',
  }, 'aguardando_humano');

  assert.equal(result.length, 1);
  assert.equal(result[0].tenant_slug, 'clinica_nubia_oficial');
  assert.equal(result[0].tenant_id, 'nubia-id');
  assert.equal(result[0].raw_payload.kanban_transition.to_column, 'aguardando_humano');
  assert.equal(supabase.calls.filter(([kind]) => kind === 'insert').length, 1);
  assert.equal(supabase.calls.filter(([kind]) => kind === 'rpc').length, 0);
});

test('6B.19 propaga falha e retorno inesperado da RPC sem escrita duplicada', async () => {
  const rpcError = new Error('rpc indisponivel');
  const failed = createSupabaseMock({ rpc: { data: null, error: rpcError } });
  await assert.rejects(() => movementWith(failed)('wesley_automoveis', { ...genesisCard, salesLeadId: 'lead-1', salesRevision: 4 }, 'sales_human'), rpcError);
  assert.equal(failed.calls.filter(([kind]) => kind === 'insert').length, 0);

  const unexpected = createSupabaseMock({ rpc: { data: { id: 'lead-1', stage_key: 'sales_new' }, error: null } });
  await assert.rejects(() => movementWith(unexpected)('wesley_automoveis', { ...genesisCard, salesLeadId: 'lead-1', salesRevision: 4 }, 'sales_human'), /não foi persistida/);
  assert.equal(unexpected.calls.filter(([kind]) => kind === 'insert').length, 0);
});

test('6B.19 propaga erros de leitura e escrita e rejeita lead ausente', async () => {
  const readError = new Error('leitura negada');
  await assert.rejects(() => movementWith(createSupabaseMock({ leadError: readError }))('wesley_automoveis', genesisCard, 'sales_human'), readError);
  await assert.rejects(() => movementWith(createSupabaseMock({ lead: null }))('wesley_automoveis', genesisCard, 'sales_human'), /Lead comercial não encontrado/);

  const insertError = new Error('escrita negada');
  await assert.rejects(() => movementWith(createSupabaseMock({ insertError }))('clinica_nubia_oficial', { id: 'card', stage: 'Qualificacao' }, 'finalizadas'), insertError);
});
