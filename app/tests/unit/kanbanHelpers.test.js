import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Facade import (only authorized public exports from dataService.js)
import {
  emptyKanban as emptyKanbanFacade,
  getKanbanColumnKind as getKanbanColumnKindFacade,
  getStageTone,
  getStageLabel,
} from '../../src/dataService.js';

// 2. Direct module import (target of extraction)
import {
  emptyKanban,
  getKanbanColumnKind,
  canonicalKanbanKey,
  normalizeKey,
  OFFICIAL_KANBAN_COLUMNS,
  KANBAN_KEY_ALIASES,
} from '../../src/services/kanban/kanbanHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('emptyKanban: returns exactly the 5 official columns with empty cards arrays', () => {
  const kanban = emptyKanban();
  assert.equal(Array.isArray(kanban), true);
  assert.equal(kanban.length, 5);

  assert.deepEqual(kanban, [
    { id: 'novas_conversas', title: 'Novas conversas', automationKey: 'novas_conversas', cards: [] },
    { id: 'conversas_andamento', title: 'Conversas em andamento', automationKey: 'conversas_andamento', cards: [] },
    { id: 'conversas_humanos', title: 'Conversas com humanos', automationKey: 'conversas_humanos', cards: [] },
    { id: 'verificar_sinal', title: 'Verificar Sinal', automationKey: 'verificar_sinal', cards: [] },
    { id: 'agendamentos', title: 'Agendamentos', automationKey: 'agendamentos', cards: [] },
  ]);
});

test('emptyKanban: returns independent instances on each call without shared state', () => {
  const first = emptyKanban();
  const second = emptyKanban();

  assert.notEqual(first, second, 'emptyKanban deve gerar novos arrays');
  assert.notEqual(first[0], second[0], 'Objetos de coluna devem ser cópias novas');
  assert.notEqual(first[0].cards, second[0].cards, 'Arrays de cards devem ser independentes');

  first[0].cards.push({ id: 'card-1' });
  assert.equal(second[0].cards.length, 0);
});

test('normalizeKey: strips accents, symbols, leading/trailing underscores and downcases', () => {
  assert.equal(normalizeKey('Conversas em Andamento!'), 'conversas_em_andamento');
  assert.equal(normalizeKey('Diagnóstico & Proposta'), 'diagnostico_proposta');
  assert.equal(normalizeKey('  __Sinal Pago___ '), 'sinal_pago');
  assert.equal(normalizeKey('Follow-Up'), 'follow_up');
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('canonicalKanbanKey: maps known aliases to canonical keys and keeps unknown keys as normalized', () => {
  // Operational aliases
  assert.equal(canonicalKanbanKey('sinal_pago'), 'verificar_sinal');
  assert.equal(canonicalKanbanKey('agendamento'), 'agendamentos');
  assert.equal(canonicalKanbanKey('agendamento_confirmado'), 'agendamentos');
  assert.equal(canonicalKanbanKey('agenda'), 'agendamentos');
  assert.equal(canonicalKanbanKey('aguardando_atendimento'), 'aguardando_humano');
  assert.equal(canonicalKanbanKey('qualificacao'), 'conversas_andamento');
  assert.equal(canonicalKanbanKey('venda_concluida'), 'finalizadas');
  assert.equal(canonicalKanbanKey('abandonadas'), 'conversas_abandonadas');
  assert.equal(canonicalKanbanKey('patio'), 'novas_conversas');

  // Genesis sales stages (pass-through as normalized keys)
  assert.equal(canonicalKanbanKey('sales_new'), 'sales_new');
  assert.equal(canonicalKanbanKey('sales_qualifying'), 'sales_qualifying');
  assert.equal(canonicalKanbanKey('sales_hot'), 'sales_hot');
  assert.equal(canonicalKanbanKey('sales_closed'), 'sales_closed');

  // Unknown key passthrough
  assert.equal(canonicalKanbanKey('etapa_customizada_cliente'), 'etapa_customizada_cliente');
  assert.equal(canonicalKanbanKey(''), '');
});

test('getKanbanColumnKind: classifies special views vs normal stages according to canonical keys', () => {
  // Special views
  assert.equal(getKanbanColumnKind({ automationKey: 'verificar_sinal' }), 'special_view');
  assert.equal(getKanbanColumnKind({ automationKey: 'sinal_pago' }), 'special_view');
  assert.equal(getKanbanColumnKind({ id: 'agendamentos' }), 'special_view');
  assert.equal(getKanbanColumnKind({ automation_key: 'conversas_abandonadas' }), 'special_view');
  assert.equal(getKanbanColumnKind({ id: 'follow_ups' }), 'special_view');
  assert.equal(getKanbanColumnKind({ automationKey: 'follow_ups' }), 'special_view');

  // Stages
  assert.equal(getKanbanColumnKind({ automationKey: 'novas_conversas' }), 'stage');
  assert.equal(getKanbanColumnKind({ automationKey: 'conversas_andamento' }), 'stage');
  assert.equal(getKanbanColumnKind({ automationKey: 'conversas_humanos' }), 'stage');
  assert.equal(getKanbanColumnKind({ automationKey: 'sales_new' }), 'stage');
  assert.equal(getKanbanColumnKind({ automationKey: 'sales_hot' }), 'stage');
  assert.equal(getKanbanColumnKind({}), 'stage');
  assert.equal(getKanbanColumnKind(), 'stage');
});

test('dataService facade: preserves identical exports and behavior for emptyKanban and getKanbanColumnKind', () => {
  assert.deepEqual(emptyKanbanFacade(), emptyKanban());
  assert.equal(getKanbanColumnKindFacade({ automationKey: 'sinal_pago' }), 'special_view');
  assert.equal(getKanbanColumnKindFacade({ automationKey: 'novas_conversas' }), 'stage');
  assert.equal(getKanbanColumnKindFacade({}), 'stage');
});

test('integration: canonicalKanbanKey continues to support getStageTone and getStageLabel correctly', () => {
  assert.equal(getStageTone('sinal_pago'), 'slate');
  assert.equal(getStageTone('sales_closed'), 'green');
  assert.equal(getStageTone('sales_new'), 'blue');
  assert.equal(getStageLabel('sales_appraisal', { tenantSlug: 'wesley_automoveis' }), 'Avaliacao de retoma - Compra');
});

test('kanbanHelpers.js: is a clean self-contained module with zero external imports and no circular dependencies', () => {
  const modulePath = path.resolve(__dirname, '../../src/services/kanban/kanbanHelpers.js');
  assert.equal(fs.existsSync(modulePath), true, 'O módulo kanbanHelpers.js deve existir');

  const content = fs.readFileSync(modulePath, 'utf8');
  assert.equal(content.includes('dataService'), false, 'kanbanHelpers.js jamais deve importar dataService');
  assert.equal(content.includes('import '), false, 'kanbanHelpers.js é puramente autocontido e não requer imports externos');
});
