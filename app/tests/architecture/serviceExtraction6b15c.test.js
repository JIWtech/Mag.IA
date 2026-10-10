import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENESIS_SALES_STAGE_DEFAULT_NAMES,
  getStageLabel,
  findKanbanColumn,
} from '../../src/services/kanban/stageResolution.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';

test('6B.15C: stage resolvers preserve tenant-specific commercial labels and configured columns', () => {
  assert.equal(getStageLabel('sales_appraisal', { tenantSlug: 'wesley_automoveis' }), 'Avaliacao de retoma - Compra');
  assert.equal(getStageLabel('sales_new', { tenantSlug: 'clinica_nubia_oficial' }), 'Sales New');
  assert.equal(
    getStageLabel('sales_appraisal', {
      tenantSlug: 'clinica_nubia_oficial',
      kanbanColumns: [{ id: 'column-42', automationKey: 'sales_appraisal', title: 'Avaliação Núbia' }],
    }),
    'Avaliação Núbia',
  );
  assert.equal(findKanbanColumn([{ boardColumnId: 'board-42', title: 'Qualificação' }], 'board-42')?.title, 'Qualificação');
  assert.equal(GENESIS_SALES_STAGE_DEFAULT_NAMES.sales_closed, 'Negocio fechado');
});

test('6B.15C: conversation builder preserves Genesis and Núbia isolation with literal fixtures', () => {
  const genesis = eventsToConversations([{
    id: 'genesis-1', tenant_slug: 'wesley_automoveis', channel_type: 'whatsapp',
    external_conversation_id: '5511999990001@s.whatsapp.net', contact_handle: '5511999990001',
    contact_name: 'Cliente Genesis', direction: 'inbound', sender_type: 'contact',
    stage: 'sales_appraisal', service: 'sales', message_text: 'Tenho um carro para troca',
    created_at: '2026-10-09T10:00:00.000Z', raw_payload: {},
  }], 'wesley_automoveis');
  const nubia = eventsToConversations([{
    id: 'nubia-1', tenant_slug: 'clinica_nubia_oficial', channel_type: 'whatsapp',
    external_conversation_id: '5511999990001@s.whatsapp.net', contact_handle: '5511999990001',
    contact_name: 'Paciente Núbia', direction: 'inbound', sender_type: 'contact',
    stage: 'sales_appraisal', service: 'agendamento', message_text: 'Quero agendar',
    created_at: '2026-10-09T10:01:00.000Z', raw_payload: {},
  }], 'clinica_nubia_oficial');

  assert.equal(genesis.length, 1);
  assert.equal(genesis[0].stage, 'Avaliacao de retoma - Compra');
  assert.equal(genesis[0].tenantSlug, 'wesley_automoveis');
  assert.equal(nubia.length, 1);
  assert.equal(nubia[0].stage, 'Sales Appraisal');
  assert.equal(nubia[0].tenantSlug, 'clinica_nubia_oficial');
  assert.notEqual(genesis[0].canonicalKey, nubia[0].canonicalKey);
});
