import { canonicalKanbanKey } from './kanbanHelpers.js';

// Vocabulário visual canônico compartilhado pelo Kanban e pelas telas de conversa.
// Cada significado comercial tem uma cor exclusiva; etapas equivalentes entre
// pipelines (ex.: novas_conversas e sales_new) compartilham a mesma cor.
// Chaveado pela etapa operacional, nunca pelo responsável ou ciclo de vida.
export const STAGE_TONES = Object.freeze({
  blue: '#60a5fa',
  cyan: '#22d3ee',
  orange: '#fb923c',
  yellow: '#facc15',
  violet: '#a78bfa',
  lime: '#a3e635',
  pink: '#f472b6',
  indigo: '#818cf8',
  teal: '#2dd4bf',
  green: '#4ade80',
  red: '#f87171',
  slate: '#94a3b8',
});

const TONE_BY_STAGE = Object.freeze({
  sales_new: 'blue',
  novas_conversas: 'blue',

  sales_qualifying: 'cyan',
  conversas_andamento: 'cyan',
  conversas_ia: 'cyan',

  sales_hot: 'orange',
  interesse_compra: 'orange',

  sales_appraisal: 'yellow',
  produtos_apresentados: 'yellow',

  sales_financing: 'violet',

  verificar_sinal: 'lime',
  aguardando_finalizacao: 'lime',

  sales_human: 'pink',
  conversas_humanos: 'pink',
  aguardando_humano: 'pink',
  com_humano: 'pink',

  agendamentos: 'indigo',

  sales_after_sales: 'teal',

  sales_closed: 'green',
  finalizadas: 'green',

  conversas_abandonadas: 'red',
});

export function getStageTone(stageKeyOrName) {
  const key = canonicalKanbanKey(String(stageKeyOrName || '').trim());
  return TONE_BY_STAGE[key] || 'slate';
}
