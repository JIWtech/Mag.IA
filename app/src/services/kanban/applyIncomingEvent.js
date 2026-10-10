import { asObject } from '../../utils/asObject.js';
import { formatDate } from '../../utils/dateFormatting.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { TECHNICAL_MEDIA_LABELS } from '../../utils/audioUtils.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { normalizeStage, normalizeLocation, resolveConversationOwnerDetails } from '../conversations/conversationPresentation.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { isGeneratedMediaLabel, mediaPreview } from '../media/mediaPresentation.js';
import { extractPayloadAvatar } from '../contacts/contactPayload.js';
import { normalizeAvatarUrl } from '../contacts/contactIdentity.js';
import { cleanAgentName } from '../agents/agentNames.js';

export function applyIncomingEventToKanban(columns = [], event, tenantSlug = '', teamAgents = []) {
  if (!event || isInternalOperationalEvent(event) || !Array.isArray(columns)) return columns;
  const channelType = normalizeChannel(event.channel_type);
  const resolvedTenant = tenantSlug || event.tenant_slug || '';
  const canonicalKey = canonicalConversationKey(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle || event.id,
    resolvedTenant,
  );
  const conversationId = `conv-${canonicalKey}`;
  const legacyConversationId = `conv-${event.channel_type || 'unknown'}:${event.external_conversation_id || event.contact_handle || event.id}`;
  const normalizedExtId = normalizeExternalConversationId(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle,
  );
  const trimmedText = String(event.message_text || '').trim().toLowerCase();
  const service = String(event.service || '').toLowerCase();
  const payload = asObject(event.raw_payload);
  const isReaction = service === 'reaction'
    || String(payload?.messageType || '').toLowerCase() === 'reactionmessage'
    || String(payload?.event || '').toLowerCase() === 'messages.reaction'
    || Boolean(payload?.reaction)
    || Boolean(payload?.magia_normalized?.reaction)
    || trimmedText === 'reaction'
    || trimmedText === '[reaction]';
  const isSecret = trimmedText === '[secretencrypted]';

  const location = normalizeLocation(event.raw_payload, event);
  const media = normalizeMedia(event.raw_payload, event);
  const isLocation = Boolean(location)
    || trimmedText === '[location]'
    || trimmedText === 'location'
    || String(payload?.messageType || '').toLowerCase() === 'locationmessage';

  let text = '';
  if (isLocation) {
    text = location?.name || location?.address || 'Localização';
  } else {
    const caption = String(media?.caption || '').trim();
    const eventText = String(event.message_text || '').trim();
    const hasRealCaption = caption && !isGeneratedMediaLabel(caption) && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase());
    text = hasRealCaption ? caption : (eventText || media?.caption || '');
  }
  const lastAt = formatDate(event.created_at);

  let modified = false;
  const nextColumns = columns.map((col) => {
    let colModified = false;
    const nextCards = (col.cards || []).map((card) => {
      const matches =
        card.id === `card-${event.id}` ||
        card.id === conversationId ||
        card.id === legacyConversationId ||
        (card.canonicalKey && card.canonicalKey === canonicalKey) ||
        (normalizedExtId && card.normalizedExternalId && card.normalizedExternalId === normalizedExtId) ||
        (event.external_conversation_id && (card.externalConversationId === event.external_conversation_id || card.normalizedExternalId === normalizedExtId)) ||
        (event.contact_handle && card.contactHandle === event.contact_handle);
      if (matches) {
        colModified = true;
        modified = true;
        const incomingPayloadAvatar = extractPayloadAvatar(event);
        const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);

        const payload = asObject(event.raw_payload);
        const assignee = asObject(payload.assignee);
        const candidateAssignee = assignee.name || payload.assigned_to || (event.service === 'conversation_assigned' ? event.sent_by_user : null);
        const newAssigneeName = cleanAgentName(candidateAssignee);
        const hasExplicitAssignment = Boolean(newAssigneeName);

        const isHandoff = Boolean(event.handoff)
          || event.service === 'handoff_requested'
          || event.service === 'conversation_assigned'
          || normalizeStage(event.stage) === 'Atendimento humano'
          || payload?.kanban_transition?.to_column === 'sales_human'
          || payload?.kanban_transition?.to_column === 'com_humano'
          || payload?.kanban_transition?.to_column === 'conversas_humanos';

        let nextOwner = card.owner;
        let nextOwnerId = card.ownerId;
        let nextOwnerKind = card.ownerKind;

        if (hasExplicitAssignment) {
          nextOwner = newAssigneeName;
          nextOwnerId = assignee.id ? String(assignee.id) : null;
          nextOwnerKind = 'agent';
        } else if (isHandoff && (card.ownerKind === 'ai' || card.owner === 'Assistente IA')) {
          let activeAgents = Array.isArray(teamAgents) && teamAgents.length ? teamAgents : null;
          if (!activeAgents && typeof window !== 'undefined' && window.localStorage && resolvedTenant) {
            try {
              const cached = window.localStorage.getItem(`magia:team-agents:${resolvedTenant}`);
              if (cached) activeAgents = JSON.parse(cached);
            } catch (_) {}
          }
          const resolvedAgents = Array.isArray(activeAgents) ? activeAgents : [];
          const humanFallback = resolveConversationOwnerDetails({
            explicitOwner: null,
            activeAgents: resolvedAgents,
            isHumanControlled: true,
          });
          nextOwner = humanFallback.name;
          nextOwnerId = humanFallback.id;
          nextOwnerKind = humanFallback.kind;
        }

        return {
          ...card,
          subtitle: (isReaction || isSecret) ? card.subtitle : (text || mediaPreview(media) || card.subtitle),
          avatarUrl: incomingPayloadAvatar || card.avatarUrl || incomingEventAvatar || null,
          owner: nextOwner,
          ownerId: nextOwnerId,
          ownerKind: nextOwnerKind,
          lastAt: lastAt || card.lastAt,
          lastActivityAt: event.created_at || card.lastActivityAt,
        };
      }
      return card;
    });

    if (colModified) {
      return {
        ...col,
        cards: sortKanbanCardsByConversationActivity(nextCards),
      };
    }
    return col;
  });

  return modified ? nextColumns : columns;
}

export function sortKanbanCardsByConversationActivity(cards = []) {
  if (!Array.isArray(cards)) return [];
  return [...cards].sort((left, right) => {
    const leftAt = Date.parse(left?.lastActivityAt || '');
    const rightAt = Date.parse(right?.lastActivityAt || '');
    if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) return 0;
    return rightAt - leftAt;
  });
}
