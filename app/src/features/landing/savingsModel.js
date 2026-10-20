// Modelo da simulação de economia da landing page.
// Todas as premissas ficam aqui para que a interface (sliders, valores, barras
// e CTA) leia um único estado e uma única fórmula.

const readPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const SAVINGS_ASSUMPTIONS = Object.freeze({
  // Encargos trabalhistas, benefícios e infraestrutura sobre o salário bruto (CLT).
  laborCostMultiplier: 1.75,
  // Parcela do atendimento repetitivo assumida pela IA. Igual ao teto comunicado
  // na página ("até 60% de redução potencial"); não é garantia de resultado.
  automatableShare: 0.6,
  // Horas diárias que cada atendente gasta com perguntas repetidas.
  repetitiveHoursPerAttendant: 4.5,
  // Custo mensal da NORIA, quando configurado (VITE_NORIA_MONTHLY_COST).
  // Sem valor configurado, a simulação mostra a economia bruta e avisa isso.
  noriaMonthlyCost: readPositiveNumber(env.VITE_NORIA_MONTHLY_COST),
});

export const SLIDER_LIMITS = Object.freeze({
  attendants: { min: 1, max: 12, step: 1 },
  salary: { min: 1500, max: 6000, step: 100 },
});

// Cenários da demonstração automática: exemplos de interação, não dados comerciais.
export const DEMO_SCENARIOS = Object.freeze([
  { attendants: 2, salary: 2400 },
  { attendants: 3, salary: 3000 },
  { attendants: 5, salary: 3500 },
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function computeSavings({ attendants, salary }, assumptions = SAVINGS_ASSUMPTIONS) {
  const people = clamp(Math.round(Number(attendants) || 0), SLIDER_LIMITS.attendants.min, SLIDER_LIMITS.attendants.max);
  const grossSalary = clamp(Number(salary) || 0, SLIDER_LIMITS.salary.min, SLIDER_LIMITS.salary.max);

  const costPerAttendant = Math.round(grossSalary * assumptions.laborCostMultiplier);
  const manualMonthly = people * costPerAttendant;
  const automatedMonthly = Math.round(manualMonthly * assumptions.automatableShare);
  const noriaMonthly = assumptions.noriaMonthlyCost ?? null;
  const withNoriaMonthly = manualMonthly - automatedMonthly + (noriaMonthly ?? 0);
  const savingsMonthly = Math.max(0, manualMonthly - withNoriaMonthly);

  return {
    attendants: people,
    salary: grossSalary,
    costPerAttendant,
    manualMonthly,
    manualYearly: manualMonthly * 12,
    withNoriaMonthly,
    noriaMonthly,
    includesNoriaCost: noriaMonthly !== null,
    savingsMonthly,
    savingsYearly: savingsMonthly * 12,
    savingsShare: manualMonthly > 0 ? savingsMonthly / manualMonthly : 0,
    repetitiveHoursPerDay: people * assumptions.repetitiveHoursPerAttendant,
  };
}

// Maior custo manual possível nos limites dos sliders: escala comum das barras.
export function maxManualMonthly(assumptions = SAVINGS_ASSUMPTIONS) {
  return SLIDER_LIMITS.attendants.max * Math.round(SLIDER_LIMITS.salary.max * assumptions.laborCostMultiplier);
}
