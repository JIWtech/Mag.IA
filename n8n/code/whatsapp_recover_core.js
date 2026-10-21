const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: 'Bearer ' + key };
// Light tick: the deployment check is cached for 10 minutes (it only changes with a deploy), and the queue read returns only the
// columns needed to re-dispatch. The server-side filter already guarantees pending or claimed messages, so rows are not re-filtered here.
const memory = $getWorkflowStaticData('global');
if (!(Number(memory.lifecycle_checked_at) > Date.now() - 600000)) {
  let readiness;
  try {
    readiness = await this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/rpc/magia_turn_lifecycle_status', headers, json: true, timeout: 10000 });
  } catch (error) {
    throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:' + String(error?.message || error).slice(0, 160));
  }
  if (readiness?.ready !== true || readiness.contract !== 'noria_turn_lifecycle_v1') {
    throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');
  }
  memory.lifecycle_checked_at = Date.now();
}
const now = encodeURIComponent(new Date().toISOString());
const rows = await this.helpers.httpRequest({ method: 'GET',
  url: base + '/rest/v1/conversation_turn_queue?select=tenant_id,chat_id,instance_name,tenants(slug)'
    + '&channel_type=eq.whatsapp&phase=in.(ready,processing,sending)&quiet_until=lte.' + now
    + '&and=(or(next_attempt_at.is.null,next_attempt_at.lte.' + now + '),or(pending.neq.%5B%5D,claimed.neq.%5B%5D))'
    + '&or=(token.is.null,lease_until.lte.' + now + ')&order=updated_at.asc&limit=30',
  headers, json: true, timeout: 10000 });
return rows.map(row => ({ json: {
  tenant_id: row.tenant_id, tenant_slug: row.tenants.slug, remoteJid: row.chat_id, instance: row.instance_name,
  recovered: true,
} }));
