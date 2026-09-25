const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Supabase environment unavailable');
const headers = { apikey: key, Authorization: 'Bearer ' + key };
const tenants = await this.helpers.httpRequest({ method: 'GET',
  url: base + '/rest/v1/tenants?select=id,status&slug=eq.' + encodeURIComponent(input.tenant_slug) + '&limit=1',
  headers, json: true, timeout: 5000 });
const tenant = tenants[0];
if (!tenant) return { json: { ...input, use_conversation_core: false } };
const rows = await this.helpers.httpRequest({ method: 'GET',
  url: base + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + tenant.id + '&limit=1',
  headers, json: true, timeout: 5000 });
const settings = rows[0]?.settings || {};
const useCore = settings.whatsapp_processing_mode === 'conversation_core_v1';
if (useCore && (tenant.status !== 'active' || input.tenant_resolution?.source === 'env_fallback')) {
  throw new Error('Core requires active tenant resolved by channel instance');
}
return { json: { ...input, tenant_id: tenant.id, use_conversation_core: useCore,
  core_quiet_ms: Math.max(3000, Math.min(Number(settings.debounce_window_ms) || 8000, 12000)),
  core_fragment_ms: Math.max(3000, Math.min(Number(settings.fragment_debounce_window_ms) || 12000, 45000)),
} };
