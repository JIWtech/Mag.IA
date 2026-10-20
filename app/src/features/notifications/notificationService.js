import { getAuthClient } from '../../services/auth/authService.js';

export const INBOX_CONTRACT = 'noria_turn_inbox_v1';

export function notificationError(error) {
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    return 'O histórico de avisos de atendimento está temporariamente indisponível.';
  }
  if (error?.message?.includes('TURN_REVIEW_FORBIDDEN') || error?.code === '42501') {
    return 'Sua conta não tem acesso ao histórico de avisos desta empresa.';
  }
  return 'Não foi possível sincronizar as notificações. Tentaremos reconectar.';
}

export async function inboxRpc(name, params, signal) {
  const client = getAuthClient();
  if (!client) throw new Error('INBOX_NOT_CONFIGURED');
  const { data, error } = await client.rpc(name, params).abortSignal(signal);
  if (error) throw error;
  if (data?.contract !== INBOX_CONTRACT) throw new Error('INBOX_CONTRACT_MISMATCH');
  return data;
}

export function validateInboxPage(data, tenantId, pageSize = 100) {
  if (data?.tenant_id !== tenantId || !Array.isArray(data.items)
    || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0
    || typeof data.has_more !== 'boolean' || !Number.isFinite(Date.parse(data.as_of))
    || data.items.length > pageSize || new Set(data.items.map((item) => item.id)).size !== data.items.length
    || data.items.some((item) => item.tenant_id !== tenantId || !item.id
      || !Number.isSafeInteger(item.revision) || item.revision < 1
      || !Number.isSafeInteger(item.ticket_revision) || item.ticket_revision < 1
      || !['review', 'uncertain'].includes(item.phase)
      || (item.resolved_at !== null && !Number.isFinite(Date.parse(item.resolved_at)))
      || typeof item.unread !== 'boolean' || !Number.isFinite(Date.parse(item.created_at)))) {
    throw new Error('INBOX_CONTRACT_MISMATCH');
  }
  return data;
}

export function validateInboxRead(data, tenantId) {
  if (data?.tenant_id !== tenantId || data.read !== true
    || !Number.isSafeInteger(data.count) || data.count < 0
    || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0) {
    throw new Error('INBOX_READ_NOT_CONFIRMED');
  }
  return data;
}

export function incidentPresentation(item) {
  if (item.resolved_at) return {
    title: 'Pendência de atendimento resolvida', status: 'Resolvido', kind: 'closed',
    description: 'A pendência foi encerrada. Abra a conversa para acompanhar o atendimento.',
  };
  if (item.phase === 'uncertain') return {
    title: 'Confira o envio da mensagem', status: 'Precisa de atenção', kind: 'uncertain',
    description: 'A entrega ainda não foi confirmada. Confira a conversa antes de enviar novamente.',
  };
  return {
    title: 'Atendimento precisa da equipe', status: 'Precisa de atenção', kind: 'review',
    description: 'A IA não conseguiu continuar este atendimento. Abra a conversa para ajudar o cliente.',
  };
}
