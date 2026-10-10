import { isInternalOperationalEvent } from './eventClassification.js';

export function shouldRefreshConversationState(event = {}) {
  return Boolean(event.handoff)
    || isInternalOperationalEvent(event)
    || ['resume_ai', 'handoff_requested', 'conversation_assigned', 'conversation_closed', 'sales_stage_changed'].includes(event.service);
}

export function createDebouncedRealtimeRefresh(refresh, delay = 800) {
  let timer = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  };
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return schedule;
}
