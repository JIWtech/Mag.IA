export function getConversationActivityEpoch(conversation) {
  if (!conversation) return 0;
  const raw = conversation.lastActivityAt ?? conversation.updatedAt ?? conversation.createdAt;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string' && raw) {
    const epoch = Date.parse(raw);
    if (!Number.isNaN(epoch)) return epoch;
  }
  return 0;
}

export function sortConversationsByRecentActivity(conversations = []) {
  if (!Array.isArray(conversations)) return [];
  return [...conversations].sort((a, b) => {
    const epochA = getConversationActivityEpoch(a);
    const epochB = getConversationActivityEpoch(b);
    return epochB - epochA;
  });
}
