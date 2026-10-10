import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichCatalogReferrals } from '../../src/services/catalog/catalogReferrals.js';
import { buildEmptyClientData, buildLoadedClientData } from '../../src/services/clientData/clientDataTransforms.js';

function catalogEvent(productId, instance = 'genesis-main') {
  return { id: `event-${productId}`, raw_payload: { catalog_referral: { source: 'whatsapp_catalog_product', product_id: productId }, provider_instance: instance } };
}

function catalogClient({ product = { product_id: 'p-1', title: 'Produto', active: true }, channels = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const query = {
        select(value) { calls.push(['select', value]); return query; },
        eq(key, value) { calls.push(['eq', key, value]); return query; },
        limit(value) { calls.push(['limit', value]); return Promise.resolve({ data: channels, error: null }); },
        in(key, value) { calls.push(['in', key, value]); return Promise.resolve({ data: product ? [product] : [], error: null }); },
      };
      return query;
    },
  };
}

test('6B.20 catalogo consulta por tenant e instancia e reutiliza cache sem nova leitura', async () => {
  const client = catalogClient({ product: { product_id: '6b20-tenant-product', title: 'Carro', active: true } });
  const events = [catalogEvent('6b20-tenant-product')];
  const first = await enrichCatalogReferrals(events, 'tenant-genesis', client, 'wesley_automoveis');
  const second = await enrichCatalogReferrals(events, 'tenant-genesis', client, 'wesley_automoveis');

  assert.equal(first[0]._catalogProduct.title, 'Carro');
  assert.equal(second[0]._catalogProduct.title, 'Carro');
  assert.deepEqual(client.calls.filter(([kind]) => kind === 'from'), [['from', 'whatsapp_catalog_products']]);
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'tenant_id' && call[2] === 'tenant-genesis'));
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'instance_name' && call[2] === 'genesis-main'));
});

test('6B.20 catalogo falha fechado para instancia ambigua e preserva evento original', async () => {
  const client = catalogClient({ channels: [{ external_id: 'a' }, { external_id: 'b' }] });
  const input = [catalogEvent('ambiguous', null)];
  const result = await enrichCatalogReferrals(input, 'tenant-nubia', client, 'clinica_nubia_oficial');

  assert.equal(result[0], input[0]);
  assert.deepEqual(client.calls.filter(([kind]) => kind === 'from'), [['from', 'channels']]);
});

test('6B.20 agregacoes mantem vazio, leituras e resultado de evento sem mutar fallback', () => {
  const fallback = { conversations: [{ id: 'old' }], marker: 'preserved' };
  const empty = buildEmptyClientData({ fallback, tenantId: 'tenant-n', enabledChannels: ['whatsapp'], activeTenantSlug: 'clinica_nubia_oficial', appointments: [], broadcastContacts: [], broadcastCampaigns: [], conversationReads: [], teamAgents: [], kanbanConfig: null, followUpJobs: [], salesLeads: [] });
  assert.equal(empty.source, 'supabase_empty');
  assert.deepEqual(empty.conversations, []);
  assert.equal(fallback.conversations[0].id, 'old');

  const loaded = buildLoadedClientData({ fallback, tenantId: 'tenant-n', enabledChannels: ['whatsapp'], activeTenantSlug: 'clinica_nubia_oficial', userId: 'user-1', events: [{ id: 'event-1', tenant_slug: 'clinica_nubia_oficial', channel_type: 'whatsapp', external_conversation_id: 'chat-1', contact_name: 'Núbia', direction: 'inbound', sender_type: 'contact', message_text: 'Olá', stage: 'Qualificacao', created_at: '2026-10-09T10:00:00.000Z', raw_payload: {} }], appointments: [], broadcastContacts: [], broadcastCampaigns: [], conversationReads: [], teamAgents: [], kanbanConfig: null, followUpJobs: [], salesLeads: [], tenantSettings: {} });
  assert.equal(loaded.source, 'supabase');
  assert.equal(loaded.conversations.length, 1);
  assert.equal(loaded.kanbanColumns.flatMap((column) => column.cards).length, 1);
  assert.equal(loaded.funnelStages.length, 5);
});
