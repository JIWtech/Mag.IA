const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Supabase environment unavailable');
const headers = { apikey: key, Authorization: 'Bearer ' + key };
// A registered but pending channel must never fall back to another tenant's legacy flow.
if (input.tenant_resolution?.source === 'env_fallback' && input.instance) {
  const registered = await this.helpers.httpRequest({method:'GET',
    url:base+'/rest/v1/channels?select=id,status,config&external_id=eq.'+encodeURIComponent(input.instance)+'&type=eq.whatsapp&limit=2',
    headers,json:true,timeout:5000});
  if (registered.some(row=>row.config?.onboarding_package||row.config?.transport_guard))
    throw new Error('Registered channel not resolved as active; do not use fallback');
}
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
if ((settings.contact_exclusion_enabled === true || settings.contact_exclusion_enabled === 'true') && !useCore) {
  throw new Error('Contact exclusions require the guarded conversation core; legacy fallback blocked');
}
if (useCore && (tenant.status !== 'active' || input.tenant_resolution?.source === 'env_fallback')) {
  throw new Error('Core requires active tenant resolved by channel instance');
}
return { json: { ...input, tenant_id: tenant.id, use_conversation_core: useCore,
  core_sales: settings.conversation_capability === 'sales_v1',
  core_quiet_ms: Math.max(3000, Math.min(Number(settings.debounce_window_ms) || 8000, 12000)),
  core_fragment_ms: Math.max(3000, Math.min(Number(settings.fragment_debounce_window_ms) || 12000, 45000)),
} };
