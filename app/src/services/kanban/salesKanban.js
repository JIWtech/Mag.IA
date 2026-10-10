export function salesBoardEnabled(config) {
  return config?.board?.settings?.capability === 'sales_v1';
}

export function salesCards(columns, leads, stages) {
  const closedStage=Object.keys(stages||{}).find(key=>stages[key].closed);
  for (const column of columns) column.salesClosed=stages?.[column.automationKey]?.closed===true;
  for (const lead of leads || []) {
    const column = columns.find(c => c.automationKey === lead.stage_key);
    if (!column) continue;
    const product = lead.product;
    const amount = lead.deposit_cents == null ? '' : 'Entrada: ' + (lead.deposit_cents / 100).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
    column.cards.push({
      id: 'sales-' + lead.id, salesLeadId: lead.id, salesRevision: lead.revision,
      salesClosedStage:closedStage,
      externalConversationId: lead.chat_id, channel: 'WhatsApp', channelType: 'whatsapp',
      title: lead.state?.customer_name || lead.chat_id.split('@')[0],
      subtitle: [product ? `${product.name} ${product.year} (${product.color})` : [lead.state?.sell_brand,lead.state?.sell_model,lead.state?.sell_year].filter(Boolean).join(' '),amount].filter(Boolean).join(' - ') || 'Qualificacao comercial',
      stage: stages?.[lead.stage_key]?.name || column.title,targetColumnId:lead.stage_key,
      owner:lead.ai_locked?'Atendimento humano':'Assistente IA',
      aiReason:lead.ai_locked?'Aguardando atendimento humano':'IA em qualificacao',
      lastAt:new Date(lead.updated_at).toLocaleString('pt-BR'),
      hasSchedulingLink:false,
      salesDocuments:lead.documents||[],
    });
  }
  return columns;
}
