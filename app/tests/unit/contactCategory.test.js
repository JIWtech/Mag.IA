import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContactCategory } from '../../src/services/contacts/contactCategory.js';

test('resolveContactCategory: identifica telefone fixo brasileiro como Número comercial', () => {
  // Número comercial de exemplo: +55 (21) 2683-2762
  const res = resolveContactCategory({
    externalConversationId: '552126832762@s.whatsapp.net',
    contact: '+55 (21) 2683-2762',
  });
  assert.equal(res.category, 'commercial');
  assert.equal(res.label, 'Número comercial');
});

test('resolveContactCategory: identifica conta comercial / business como Número comercial', () => {
  const res = resolveContactCategory({
    externalConversationId: '5511999998888@s.whatsapp.net',
    raw_payload: { isBusiness: true },
  });
  assert.equal(res.category, 'commercial');
  assert.equal(res.label, 'Número comercial');
});

test('resolveContactCategory: identifica supressão de não-cliente como Número comercial', () => {
  const res = resolveContactCategory({
    externalConversationId: '5511999998888@s.whatsapp.net',
    ai_provider: 'non_customer_suppression',
  });
  assert.equal(res.category, 'commercial');
  assert.equal(res.label, 'Número comercial');
});

test('resolveContactCategory: identifica contato salvo na agenda com sinal isMyContact', () => {
  const res = resolveContactCategory({
    externalConversationId: '5521996417001@s.whatsapp.net',
    contact: 'Sandrinho Irak',
    raw_payload: { isMyContact: true },
  });
  assert.equal(res.category, 'saved');
  assert.equal(res.label, 'Contato salvo');
});

test('resolveContactCategory: cliente com nome de perfil (pushName) permanece como Cliente', () => {
  const res = resolveContactCategory({
    externalConversationId: '5521975642131@s.whatsapp.net',
    contact: 'Marcio Silva',
    contact_name: 'Marcio Silva',
  });
  assert.equal(res.category, 'customer');
  assert.equal(res.label, 'Cliente');
});

test('resolveContactCategory: classifica celular comum de lead como Cliente', () => {
  const res = resolveContactCategory({
    externalConversationId: '5521996417001@s.whatsapp.net',
    contact: '+55 (21) 99641-7001',
  });
  assert.equal(res.category, 'customer');
  assert.equal(res.label, 'Cliente');
});

test('resolveContactCategory: respeita categoria explícita vinda do n8n / backend', () => {
  const resCommercial = resolveContactCategory({
    contactCategory: 'commercial',
  });
  assert.equal(resCommercial.category, 'commercial');

  const resSaved = resolveContactCategory({
    raw_payload: { contact_category: 'saved' },
  });
  assert.equal(resSaved.category, 'saved');

  const resCustomer = resolveContactCategory({
    contactCategory: 'customer',
  });
  assert.equal(resCustomer.category, 'customer');
});

test('contato comercial: suprime IA ativa e define etapa como Número comercial', async () => {
  const { deriveConversationPresentationState } = await import('../../src/features/conversations/utils/chatTimelineHelpers.js');
  const { eventsToConversations } = await import('../../src/services/conversations/eventsToConversations.js');

  const mockLandlineEvent = {
    id: 'comm-1',
    external_conversation_id: '552126832762@s.whatsapp.net',
    contact_name: '+55 (21) 2683-2762',
    channel_type: 'whatsapp',
    service: 'non_customer',
    stage: 'sales_new',
    message_text: '[template]',
    created_at: '2026-10-16T10:00:00Z',
  };

  const [conversation] = eventsToConversations([mockLandlineEvent], 'wesley_automoveis');
  assert.equal(conversation.contactCategory, 'commercial');
  assert.equal(conversation.stage, 'Número comercial');
  assert.equal(conversation.status, 'comercial');
  assert.equal(conversation.owner, null);

  const presentation = deriveConversationPresentationState(conversation);
  assert.equal(presentation.isAiActive, false);
  assert.equal(presentation.statusKind, 'commercial');
  assert.equal(presentation.stageLabel, 'Número comercial');
  assert.match(presentation.statusText, /IA desativada/i);
});
