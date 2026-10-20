const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
// The recovery query uses v1 columns. Check without claiming or rewriting a lot.
let readiness;
try {
  readiness = await this.helpers.httpRequest({ method: 'GET',
    url: base + '/rest/v1/rpc/magia_turn_lifecycle_status',
    headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 10000 });
} catch (error) {
  throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:' + String(error?.message || error).slice(0, 160));
}
if (readiness?.ready !== true || readiness.contract !== 'noria_turn_lifecycle_v1') {
  throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');
}
const now = encodeURIComponent(new Date().toISOString());
const rows = await this.helpers.httpRequest({ method: 'GET',
  url: base + '/rest/v1/conversation_turn_queue?select=*,tenants(slug)'
    + '&channel_type=eq.whatsapp&phase=in.(ready,processing,sending)&quiet_until=lte.' + now
    + '&and=(or(next_attempt_at.is.null,next_attempt_at.lte.' + now + '),or(pending.neq.%5B%5D,claimed.neq.%5B%5D))'
    + '&or=(token.is.null,lease_until.lte.' + now + ')&order=updated_at.asc&limit=30',
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 10000 });
return rows.filter(row => row.pending?.length || row.claimed?.length).map(row => ({ json: {
  tenant_id: row.tenant_id, tenant_slug: row.tenants.slug, remoteJid: row.chat_id, instance: row.instance_name,
  recovered: true,
} }));
