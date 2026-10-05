const base = $('Enviar Fotos do Catalogo').item.json;
const sent = $json;
const externalMessageId = String(sent?.key?.id || sent?.message?.key?.id || sent?.id || base.messageId + ':reply');
return { json: { ...base, externalMessageId, direction: 'outbound', sender_type: 'assistant',
  messageText: base.responseText, delivery_status: 'sent', raw_payload: {
    provider: 'evolution_api', response: sent,
    conversation_session_id: base.conversation_session_id,
    conversation_closed_at: base.conversation_closed_at,
    product_media_delivery: base.product_media_delivery,
    product_media_matches: base.product_media_matches || [],
    catalog_diagnostics: base.catalog_diagnostics || null,
  } } };
