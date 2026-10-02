function chatKey(event) {
  return JSON.stringify([
    event.tenant_id || event.tenant_slug || '',
    (event.channel_type || '').toLowerCase(),
    event.external_conversation_id || event.contact_handle || event.id,
  ]);
}

// Older workflows stored a reply both on the inbound row and as an outbound event.
export function prepareConversationEvents(events) {
  const seen = new Set();
  const unique = events.filter((event) => {
    const identity = event.external_message_id
      ? `${chatKey(event)}:${event.direction}:${event.external_message_id}`
      : event.id;
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const outgoingByChat = new Map();
  for (const event of unique) {
    if (event.direction !== 'outbound' || ['agent', 'system', 'human', 'operator'].includes(event.sender_type)) continue;
    const key = chatKey(event);
    if (!outgoingByChat.has(key)) outgoingByChat.set(key, []);
    outgoingByChat.get(key).push(event);
  }

  const matched = new Set();
  const replies = unique.filter((event) => event.direction === 'inbound' && event.response_text);
  const represented = new Set();
  // Resolve explicit links before text matching, so a fallback cannot consume another reply.
  for (const inbound of replies) {
    const outgoing = outgoingByChat.get(chatKey(inbound)) || [];
    const match = outgoing.find((event) => !matched.has(event) && (
      (inbound.request_id && event.request_id === inbound.request_id)
      || (inbound.external_message_id && event.external_message_id === `${inbound.external_message_id}:reply`)
    ));
    if (match) {
      matched.add(match);
      represented.add(inbound);
    }
  }
  for (const inbound of replies) {
    if (represented.has(inbound)) continue;
    const outgoing = outgoingByChat.get(chatKey(inbound)) || [];
    const match = outgoing.find((event) => {
      if (matched.has(event)) return false;
      if (inbound.request_id && event.request_id && inbound.request_id !== event.request_id) return false;
      const elapsed = Date.parse(event.created_at) - Date.parse(inbound.created_at);
      return elapsed >= 0 && elapsed <= 5 * 60 * 1000
        && String(event.message_text || event.response_text || '').trim() === String(inbound.response_text).trim();
    });
    if (match) {
      matched.add(match);
      represented.add(inbound);
    }
  }
  return unique.map((event) => represented.has(event) ? { ...event, response_text: null } : event);
}
