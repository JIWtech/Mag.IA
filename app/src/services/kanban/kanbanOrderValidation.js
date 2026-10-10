import { canonicalKanbanKey } from './kanbanHelpers.js';

// A IA somente pode permutar as chaves das colunas já existentes. Esta validação
// é executada antes de a proposta chegar à UI e antes de qualquer persistência.
export function validateKanbanOrderProposal(columns = [], proposal = {}) {
  const current = (columns || []).map((column) => canonicalKanbanKey(
    column.automationKey || column.automation_key || column.id,
  )).filter(Boolean);
  const suggested = Array.isArray(proposal?.orderedAutomationKeys)
    ? proposal.orderedAutomationKeys.map(canonicalKanbanKey).filter(Boolean)
    : [];
  const currentSet = new Set(current);
  const suggestedSet = new Set(suggested);
  const valid = current.length > 0
    && suggested.length === current.length
    && suggestedSet.size === suggested.length
    && [...currentSet].every((key) => suggestedSet.has(key));

  return {
    valid,
    orderedAutomationKeys: valid ? suggested : [],
    reasoning: typeof proposal?.reasoning === 'string' ? proposal.reasoning.trim() : '',
  };
}

export default validateKanbanOrderProposal;
