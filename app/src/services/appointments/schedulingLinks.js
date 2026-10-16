export const TENANT_SCHEDULING_LINKS = {
  clinica_nubia: 'https://nbbronze.tuaagenda.app/',
};

export function getTenantSchedulingLink(tenantSlug) {
  return TENANT_SCHEDULING_LINKS[tenantSlug] || '';
}
