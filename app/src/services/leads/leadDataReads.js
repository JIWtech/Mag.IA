import { canonicalKanbanKey } from '../kanban/kanbanHelpers.js';

export async function loadSalesLeads(supabase, tenantId) {
  const { data, error } = await supabase
    .from('sales_leads')
    .select('id, tenant_id, channel_type, chat_id, stage_key, ai_locked, revision, state, product, hot, interest_registered, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Sales leads fallback:', error.message);
    return [];
  }
  return data || [];
}

export function buildSalesLeadIndex(salesLeads = [], canonicalConversationKey, isMoreRecentRecord) {
  const index = new Map();
  for (const lead of salesLeads) {
    if (!lead?.chat_id) continue;
    const key = canonicalConversationKey(lead.channel_type, lead.chat_id, lead.id);
    const current = index.get(key);
    if (!current || isMoreRecentRecord(lead, current)) index.set(key, lead);
  }
  return index;
}

export function resolveSalesControlMode(salesLead) {
  if (!salesLead) return null;
  const stage = canonicalKanbanKey(salesLead.stage_key);
  if (salesLead.ai_locked === true || stage === 'sales_human') return 'human';
  if (salesLead.ai_locked === false && ['sales_new', 'sales_qualifying', 'sales_hot'].includes(stage)) return 'ai';
  return 'none';
}
