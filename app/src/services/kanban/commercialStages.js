export const GENESIS_SALES_STAGE_DEFAULT_NAMES = {
  sales_new: 'Patio - Novos contatos',
  sales_qualifying: 'IA - Qualificacao automotiva',
  sales_hot: 'Leads quentes - Venda',
  sales_appraisal: 'Avaliacao de retoma - Compra',
  sales_financing: 'Fila de financiamento',
  sales_after_sales: 'Pos-venda - Manutencao',
  sales_human: 'Atendimento humano',
  sales_closed: 'Negocio fechado',
};

const GENESIS_TENANT_SLUG = 'wesley_automoveis';
const GENESIS_SALES_STAGES = [
  { key: 'sales_new', navigationLabel: 'Novos contatos' },
  { key: 'sales_qualifying', navigationLabel: 'Qualificação IA' },
  { key: 'sales_hot', navigationLabel: 'Leads quentes' },
  { key: 'sales_human', navigationLabel: 'Atendimento humano' },
  { key: 'sales_appraisal', navigationLabel: 'Avaliação de retoma' },
  { key: 'sales_financing', navigationLabel: 'Financiamento' },
  { key: 'sales_closed', navigationLabel: 'Negócio fechado' },
  { key: 'sales_after_sales', navigationLabel: 'Pós-venda' },
];
export const GENESIS_SALES_STAGE_KEYS = new Set(GENESIS_SALES_STAGES.map((stage) => stage.key));
export const GENESIS_SALES_STAGE_BY_KEY = new Map(GENESIS_SALES_STAGES.map((stage, index) => [stage.key, { ...stage, index }]));

export function isGenesisSalesTenant(tenantSlug) {
  return String(tenantSlug || '').trim().toLowerCase() === GENESIS_TENANT_SLUG;
}
