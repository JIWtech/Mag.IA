export const KANBAN_OWNER_FILTERS = Object.freeze({
  ALL: 'todos',
  AI: 'ia',
});

export function kanbanAgentFilterValue(agentId) {
  return `agent:${String(agentId)}`;
}

export function matchesKanbanOwnerFilter(card, filterValue) {
  if (filterValue === KANBAN_OWNER_FILTERS.ALL) return true;
  if (filterValue === KANBAN_OWNER_FILTERS.AI) return card?.ownerKind === 'ai';

  if (!String(filterValue || '').startsWith('agent:')) return false;

  const agentId = String(filterValue).slice('agent:'.length);
  return Boolean(agentId)
    && card?.ownerKind === 'agent'
    && String(card?.ownerId || '') === agentId;
}
