import { canonicalKanbanKey } from './kanbanHelpers.js';

// Canonical visual vocabulary shared by Kanban and conversation surfaces.
// Keep this keyed by the operational stage, never by assignee/lifecycle text.
export function getStageTone(stageKeyOrName) {
  const key = canonicalKanbanKey(String(stageKeyOrName || '').trim());
  if (key === 'sales_closed') return 'green';
  if (key === 'sales_after_sales' || key === 'sales_new') return 'blue';
  if (key === 'sales_appraisal' || key === 'sales_hot') return 'amber';
  if (key === 'sales_financing' || key === 'sales_human') return 'violet';
  if (key === 'sales_qualifying') return 'cyan';
  return 'slate';
}
