export function createBroadcastOperations({ getClient, loadTenant, currentUserId }) {
async function upsertBroadcastContacts(activeTenantSlug, contacts) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const clean = contacts
    .map((contact) => ({
      tenant_id: tenant.id,
      name: contact.name || 'Contato',
      channel_type: contact.channelType || contact.channel_type || 'telegram',
      external_conversation_id: String(contact.externalConversationId || contact.external_conversation_id || '').trim(),
      phone: contact.phone || null,
      email: contact.email || null,
      source: contact.source || 'manual',
      tags: contact.tags || [],
      metadata: contact.metadata || {},
    }))
    .filter((contact) => contact.external_conversation_id);
  if (!clean.length) return [];
  const { data, error } = await supabase
    .from('broadcast_contacts')
    .upsert(clean, { onConflict: 'tenant_id,channel_type,external_conversation_id' })
    .select('*');
  if (error) throw error;
  return data || [];
}

async function createBroadcastCampaign(activeTenantSlug, campaign, recipients) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const userId = await currentUserId();
  const { data: campaignRow, error: campaignError } = await supabase
    .from('broadcast_campaigns')
    .insert({
      tenant_id: tenant.id,
      name: campaign.name,
      channel_type: campaign.channelType || 'telegram',
      message_text: campaign.messageText,
      status: 'sending',
      total_recipients: recipients.length,
      created_by: userId,
    })
    .select('*')
    .single();
  if (campaignError) throw campaignError;

  const recipientRows = recipients.map((recipient) => ({
    tenant_id: tenant.id,
    campaign_id: campaignRow.id,
    contact_id: recipient.id || null,
    channel_type: recipient.channel_type || recipient.channelType || campaign.channelType || 'telegram',
    external_conversation_id: String(recipient.external_conversation_id || recipient.externalConversationId || '').trim(),
    contact_name: recipient.name || recipient.contact_name || 'Contato',
    status: 'queued',
  })).filter((recipient) => recipient.external_conversation_id);

  if (recipientRows.length) {
    const { error: recipientsError } = await supabase
      .from('broadcast_campaign_recipients')
      .insert(recipientRows);
    if (recipientsError) throw recipientsError;
  }

  return campaignRow;
}

async function updateBroadcastCampaign(campaignId, patch) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const { data, error } = await supabase
    .from('broadcast_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateBroadcastRecipient(campaignId, externalConversationId, patch) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const { error } = await supabase
    .from('broadcast_campaign_recipients')
    .update(patch)
    .eq('campaign_id', campaignId)
    .eq('external_conversation_id', externalConversationId);
  if (error) throw error;
}
return { upsertBroadcastContacts, createBroadcastCampaign, updateBroadcastCampaign, updateBroadcastRecipient };
}
