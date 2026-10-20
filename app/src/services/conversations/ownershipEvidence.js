import { asObject } from '../../utils/asObject.js';

const AI_SALES_STAGES = new Set(['sales_new', 'sales_qualifying', 'sales_hot']);

export function eventSessionId(event = {}) {
  const session = asObject(event.raw_payload)?.conversation_session_id;
  return typeof session === 'string' && session.trim() ? session.trim() : null;
}

export function isExplicitAiOwnershipTransition(event = {}) {
  return event.service === 'resume_ai' && event.handoff === false;
}

export function hasVerifiedSalesAiSnapshot(event = {}, stage = '') {
  const payload = asObject(event.raw_payload);
  const stageKey = String(payload.sales_stage || '').trim();
  const revision = payload.sales_revision;
  const stageText = String(stage || event.stage || '').toLowerCase();

  return event.handoff === false
    && event.ai_provider === 'sales_core'
    && eventSessionId(event) !== null
    && Number.isInteger(revision)
    && AI_SALES_STAGES.has(stageKey)
    && stageText !== 'atendimento humano'
    && stageText !== 'sales_human';
}

// A generic commercial message is not a transfer. A current human lock remains
// authoritative until an explicit resume or a new, independently confirmed AI
// session is loaded from sales_leads.
export function canEventMoveOwnershipToAi(conversation = {}, event = {}, stage = '') {
  if (isExplicitAiOwnershipTransition(event)) return true;
  if (conversation.status === 'atendimento_humano' || conversation.handoff === true) return false;
  if (!hasVerifiedSalesAiSnapshot(event, stage)) return false;
  const eventSession = eventSessionId(event);
  return !conversation.currentSessionId || conversation.currentSessionId === eventSession;
}
