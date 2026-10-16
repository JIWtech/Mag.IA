export function sentimentFromEvent(event, normalizeStage) {
  const norm = normalizeStage(event.stage);
  if (norm === 'Fora de contexto') return 'neutro';
  if (event.handoff || norm === 'Suporte técnico') return 'urgente';
  if (norm === 'Orçamento solicitado' || norm === 'Agendamento') return 'positivo';
  return 'neutro';
}

export function estimatedValue(event) {
  if (event.stage === 'Orçamento solicitado' || event.stage === 'Orcamento solicitado') return 2500;
  if (event.service === 'software_house') return 18000;
  if (event.service === 'trafego_pago' || event.service === 'social_media') return 3200;
  if (event.service === 'suporte_ti') return 450;
  return 0;
}
