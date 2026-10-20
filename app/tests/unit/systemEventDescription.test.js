import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSystemEvent } from '../../src/features/conversations/utils/chatTimelineHelpers.js';

test('evento genérico mostra o que aconteceu, nunca só "Evento do sistema"', () => {
  const event = describeSystemEvent({
    from: 'system',
    text: 'Conversa movida para Suporte técnico e atribuída para Equipe JIW.',
  });
  assert.equal(event.kind, 'stage');
  assert.equal(event.title, 'Conversa movida');
  assert.equal(event.detail, 'Para Suporte técnico e atribuída para Equipe JIW.');
});

test('mudança de etapa pelo Kanban vira título claro com a etapa de destino', () => {
  const event = describeSystemEvent({
    service: 'sales_stage_changed',
    text: '[Kanban] Etapa comercial alterada para: Financiamento',
  });
  assert.equal(event.kind, 'stage');
  assert.equal(event.title, 'Etapa comercial alterada');
  assert.equal(event.detail, 'Para Financiamento');
});

test('atribuição identifica o responsável', () => {
  const event = describeSystemEvent({ service: 'conversation_assigned', text: 'Conversa assumida por Wesley.' });
  assert.equal(event.kind, 'assigned');
  assert.equal(event.title, 'Atendimento atribuído');
  assert.equal(event.detail, 'Para Wesley');
});

test('eventos conhecidos têm tipo e título próprios', () => {
  assert.equal(describeSystemEvent({ service: 'conversation_closed', text: 'Atendimento encerrado pela interface' }).kind, 'closed');
  assert.equal(describeSystemEvent({ service: 'resume_ai', text: 'Retornado para atendimento da IA.' }).title, 'IA reativada');
  assert.equal(describeSystemEvent({ service: 'handoff_requested', text: '' }).title, 'Transferência para atendimento humano');
  assert.equal(describeSystemEvent({ text: 'Pagamento confirmado: sinal de R$ 500' }).detail, 'Sinal de R$ 500');
});

test('serviço desconhecido sem texto ainda informa o tipo do evento', () => {
  const event = describeSystemEvent({ service: 'sales_qualification', text: '' });
  assert.equal(event.kind, 'generic');
  assert.equal(event.title, 'Atualização do atendimento');
  assert.equal(event.detail, 'Sales qualification');
});
