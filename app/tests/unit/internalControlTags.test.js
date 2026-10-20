import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatConversationPreview,
  normalizeTechnicalMediaPlaceholder,
} from '../../src/utils/audioUtils.js';

test('bolha não exibe marcadores internos de handoff ou ação da IA', () => {
  assert.equal(
    normalizeTechnicalMediaPlaceholder('Vou encaminhar para um especialista. [HUMANO_SOLICITADO]'),
    'Vou encaminhar para um especialista.',
  );
  assert.equal(
    normalizeTechnicalMediaPlaceholder('[ACAO: AGENDAR_VISITA] Combinado, até amanhã.'),
    'Combinado, até amanhã.',
  );
  assert.equal(normalizeTechnicalMediaPlaceholder('[SEM_FALA_INTELIGIVEL]'), '');
});

test('prévia da lista também remove marcadores internos', () => {
  assert.equal(
    formatConversationPreview('Preciso entender o prazo. [humano_solicitado]'),
    'Preciso entender o prazo.',
  );
});

test('texto com colchetes comuns do cliente é preservado', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('Quero o modelo [preto] ou azul'), 'Quero o modelo [preto] ou azul');
});
