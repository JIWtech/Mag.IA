import { conversationPhoneFallback } from './contactPhones.js';

/**
 * Classifica um contato ou conversa em:
 * - 'commercial': Número comercial / Telefone Fixo / Conta Business
 * - 'saved': Contato salvo na agenda com nome reconhecido
 * - 'customer': Cliente / Lead convencional
 *
 * @param {Object} conversationOrEvent
 * @param {Object} [context]
 * @returns {{ category: 'commercial'|'saved'|'customer', label: string }}
 */
export function resolveContactCategory(conversationOrEvent = {}, context = {}) {
  const payload = conversationOrEvent.raw_payload || conversationOrEvent.raw || {};

  // 1. Tag explícita já atribuída pelo n8n / backend
  const explicitCategory = String(
    conversationOrEvent.contactCategory ||
    conversationOrEvent.contact_category ||
    payload.contact_category ||
    ''
  ).toLowerCase().trim();

  if (explicitCategory === 'commercial') {
    return { category: 'commercial', label: 'Número comercial' };
  }
  if (explicitCategory === 'saved') {
    return { category: 'saved', label: 'Contato salvo' };
  }
  if (explicitCategory === 'customer') {
    return { category: 'customer', label: 'Cliente' };
  }

  // 2. Análise de número comercial / fixo
  const phone = conversationPhoneFallback(conversationOrEvent)
    || String(conversationOrEvent.phone || conversationOrEvent.externalConversationId || '').replace(/\D/g, '');
  const digits = String(phone || '').replace(/\D/g, '');

  // Telefone fixo no Brasil: 55 + DDD (2 dígitos) + 8 dígitos iniciando em 2, 3, 4 ou 5
  // Exemplo: 552126832762 (DDD 21, 2683-2762)
  const isBrazilLandline = (digits.startsWith('55') && digits.length === 12 && ['2', '3', '4', '5'].includes(digits[4]))
    || (digits.length === 10 && ['2', '3', '4', '5'].includes(digits[2]));

  const isBusinessAccount = Boolean(
    payload.isBusiness ||
    payload.isEnterprise ||
    payload.verifiedName ||
    payload.businessProfile ||
    conversationOrEvent.service === 'non_customer' ||
    conversationOrEvent.ai_provider === 'non_customer_suppression'
  );

  if (isBrazilLandline || isBusinessAccount) {
    return { category: 'commercial', label: 'Número comercial' };
  }

  // 3. Análise de contato salvo na agenda do telefone / chip da loja
  // O sinal 'isMyContact' vem do WhatsApp quando o número está salvo na agenda do aparelho.
  // IMPORTANTE: Ter um pushName ("Marcio Silva", "Jaciely Ester") NÃO significa que a loja o salvou,
  // apenas que o próprio cliente definiu um nome no perfil pessoal dele do WhatsApp.
  const isSavedInPhonebook = Boolean(
    payload.isMyContact === true ||
    payload.contact?.isMyContact === true ||
    payload.isSavedContact === true ||
    payload.provider_event?.isMyContact === true ||
    conversationOrEvent.is_saved_contact === true ||
    conversationOrEvent.metadata?.is_saved_contact === true ||
    (conversationOrEvent.contact_is_saved === true && !conversationOrEvent.contact_name?.startsWith('+'))
  );

  if (isSavedInPhonebook) {
    return { category: 'saved', label: 'Contato salvo' };
  }

  // 4. Padrão: Cliente
  return { category: 'customer', label: 'Cliente' };
}
