import { getAuthClient } from '../../services/auth/authService.js';

export const INBOX_CONTRACT = 'noria_turn_inbox_v1';

export function notificationError(error) {
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    return 'A central de notificações aguarda a implantação do backend.';
  }
  if (error?.message?.includes('TURN_REVIEW_FORBIDDEN') || error?.code === '42501') {
    return 'Sua conta ainda não tem permissão para acompanhar incidentes desta empresa.';
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
    title: 'Incidente encerrado', status: 'Encerrado', kind: 'closed',
    description: 'O encerramento foi registrado. Consulte os detalhes para verificar a resolução.',
  };
  if (item.phase === 'uncertain') return {
    title: 'Confirmação de envio pendente', status: 'Entrega incerta', kind: 'uncertain',
    description: 'A mensagem aguarda reconciliação para evitar um envio duplicado.',
  };
  return {
    title: 'Revisão necessária', status: 'Em revisão', kind: 'review',
    description: 'O atendimento foi interrompido e uma mensagem foi preservada para análise.',
  };
}
