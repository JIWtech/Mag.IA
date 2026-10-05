const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
const now = encodeURIComponent(new Date().toISOString());
const rows = await this.helpers.httpRequest({ method: 'GET',
  url: base + '/rest/v1/conversation_turn_queue?select=*,tenants(slug)'
    + '&channel_type=eq.whatsapp&phase=neq.uncertain&quiet_until=lte.' + now
    + '&or=(token.is.null,lease_until.lte.' + now + ')&and=(or(pending.neq.%5B%5D,claimed.neq.%5B%5D))&order=updated_at.asc&limit=30',
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 10000 });
return rows.filter(row => row.pending?.length || row.claimed?.length).map(row => ({ json: {
  tenant_id: row.tenant_id, tenant_slug: row.tenants.slug, remoteJid: row.chat_id, instance: row.instance_name,
  recovered: true,
} }));
