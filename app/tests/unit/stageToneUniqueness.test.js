import test from 'node:test';
import assert from 'node:assert/strict';
import { getStageTone, STAGE_TONES } from '../../src/services/kanban/stageTone.js';

// Uma etapa por significado comercial; cada uma precisa de cor própria.
const DISTINCT_STAGES = [
  'sales_new',
  'sales_qualifying',
  'sales_hot',
  'sales_appraisal',
  'sales_financing',
  'verificar_sinal',
  'sales_human',
  'agendamentos',
  'sales_after_sales',
  'sales_closed',
  'conversas_abandonadas',
];

test('cada etapa comercial distinta recebe uma cor exclusiva', () => {
  const tones = DISTINCT_STAGES.map((stage) => getStageTone(stage));
  assert.equal(new Set(tones).size, tones.length, `cores repetidas: ${tones.join(', ')}`);
  assert.ok(!tones.includes('slate'), 'nenhuma etapa conhecida cai na cor neutra');
});

test('etapas equivalentes entre pipelines compartilham a mesma cor', () => {
  assert.equal(getStageTone('novas_conversas'), getStageTone('sales_new'));
  assert.equal(getStageTone('conversas_andamento'), getStageTone('sales_qualifying'));
  assert.equal(getStageTone('conversas_humanos'), getStageTone('sales_human'));
  assert.equal(getStageTone('finalizadas'), getStageTone('sales_closed'));
});

test('toda cor usada tem valor definido na paleta', () => {
  for (const stage of DISTINCT_STAGES) {
    assert.match(STAGE_TONES[getStageTone(stage)] || '', /^#[0-9a-f]{6}$/i);
  }
});
