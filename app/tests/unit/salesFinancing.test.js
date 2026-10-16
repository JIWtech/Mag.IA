import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/dataService.js';
import { salesFinancingSummary } from '../../src/services/kanban/eventsToKanban.js';

const qualification = {
  rule: 'deposit_30_and_financing_documents_v1',
  status: 'documents_pending',
  deposit_cents: 1500000,
  minimum_deposit_cents: 1500000,
};

test('Genesis financing summaries describe qualification without exposing documents', () => {
  const lead = (status) => ({ state: { financing_qualification: { ...qualification, status } } });
  assert.match(salesFinancingSummary(lead('documents_pending'), 'wesley_automoveis'), /Documentação pendente/);
  assert.match(salesFinancingSummary(lead('deposit_insufficient'), 'wesley_automoveis'), /abaixo de 30%/);
  assert.match(salesFinancingSummary(lead('deposit_unknown'), 'wesley_automoveis'), /não informada/);
  assert.match(salesFinancingSummary(lead('ready'), 'wesley_automoveis'), /Entrada e documentos/);
  assert.equal(salesFinancingSummary(lead('ready'), 'clinica_nubia_oficial'), '');
  assert.equal(salesFinancingSummary({ state: {} }, 'wesley_automoveis'), '');
  assert.match(salesFinancingSummary({ state: { financing_qualification: { ...qualification, deposit_cents: 0 } } }, 'wesley_automoveis'), /0,00/);
});

test('persisted hot stages remain in the hot column under human control', () => {
  const event = {
    id: 'event',
    channel_type: 'whatsapp',
    external_conversation_id: 'test',
    direction: 'inbound',
    message_text: 'test',
    created_at: '2026-10-06T10:00:00Z',
  };
  const lead = {
    id: 'lead',
    channel_type: 'whatsapp',
    chat_id: 'test',
    stage_key: 'sales_hot',
    hot: true,
    ai_locked: true,
    state: { intent: 'buy', financing_qualification: { ...qualification, status: 'ready' } },
  };
  const columns = eventsToKanban([event], 'wesley_automoveis', [], { columns: [
    { id: 'hot', name: 'Leads quentes', automation_key: 'sales_hot', position: 1 },
    { id: 'qualifying', name: 'Qualificacao', automation_key: 'sales_qualifying', position: 2 },
  ] }, [], [lead]);
  const card = columns.find((column) => column.automationKey === 'sales_hot').cards[0];
  assert.equal(card.salesHot, true);
  assert.equal(card.salesAiLocked, true);
  assert.match(card.subtitle, /Entrada e documentos/);
  assert.equal(columns.find((column) => column.automationKey === 'sales_qualifying').cards.length, 0);
});
