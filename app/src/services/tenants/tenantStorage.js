export const tenantStorageKey = 'magia:selected-tenant-slug';
export const defaultTenantSlug = null;

export function hasSupabaseConfig(supabaseUrl, supabaseAnonKey) {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getInitialTenantSlug(defaultSlug = defaultTenantSlug) {
  if (typeof window === 'undefined') return defaultSlug;
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant') || localStorage.getItem(tenantStorageKey) || defaultSlug;
}

export function persistTenantSlug(slug) {
  if (!slug || typeof localStorage === 'undefined') return;
  localStorage.setItem(tenantStorageKey, slug);
}
