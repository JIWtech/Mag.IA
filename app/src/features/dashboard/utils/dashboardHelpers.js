import React from 'react';
import {
  MessageSquare,
  Mic,
  Video,
  ImageIcon,
  FileText,
  MapPin,
  UserRound,
  Sparkles,
  Paperclip,
} from 'lucide-react';

export const statusLabels = {
  ia_ativa: 'Bot ativo',
  atendimento_humano: 'Atendimento humano',
  aguardando_cliente: 'Aguardando cliente',
  finalizada: 'Finalizada',
  finalizado: 'Finalizada',
  erro: 'Atenção',
  bloqueada: 'Bloqueada',
};

export function getConversationLastMessageOrigin(item) {
  if (!item) return null;
  if (item.lastMessageSender) return item.lastMessageSender;
  const messages = item.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
      if (lastMsg.from === 'ai' || lastMsg.sender_type === 'bot') return 'IA';
      if (lastMsg.from === 'agent' || lastMsg.sender_type === 'agent') {
        return lastMsg.sent_by || item.owner || 'Atendente';
      }
      if (lastMsg.from === 'system' || lastMsg.sender_type === 'system') return 'Sistema';
      if (lastMsg.from === 'contact' || lastMsg.sender_type === 'contact') return 'Cliente';
    }
  }
  return null;
}

export function getConversationLastMessageMeta(item) {
  if (!item) return { type: 'text', label: '', icon: React.createElement(MessageSquare, { size: 13 }) };

  const lastMsg = Array.isArray(item.messages) && item.messages.length > 0
    ? item.messages[item.messages.length - 1]
    : null;

  const rawText = String(item.lastMessage || lastMsg?.text || '').trim();
  const lower = rawText.toLowerCase();

  // 1. Áudio
  if (
    lastMsg?.media?.kind === 'audio' ||
    lastMsg?.media?.category === 'audio' ||
    ['[audio]', '[áudio]', 'áudio', 'audio', '[voice]', '[ptt]', '[áudio recebido]', '[audio recebido]'].includes(lower) ||
    lower.startsWith('áudio') || lower.startsWith('audio')
  ) {
    return { type: 'audio', label: 'Áudio', icon: React.createElement(Mic, { size: 13 }) };
  }

  // 2. Vídeo
  if (
    lastMsg?.media?.kind === 'video' ||
    lastMsg?.media?.category === 'video' ||
    ['[video]', '[vídeo]', 'vídeo', 'video', '[vídeo recebido]', '[video recebido]'].includes(lower)
  ) {
    return { type: 'video', label: 'Vídeo', icon: React.createElement(Video, { size: 13 }) };
  }

  // 3. Imagem
  if (
    lastMsg?.media?.kind === 'image' ||
    lastMsg?.media?.category === 'image' ||
    ['[image]', '[imagem]', '[photo]', '[foto]', 'imagem', 'foto', '[imagem recebida]', '[foto recebida]'].includes(lower)
  ) {
    return { type: 'image', label: 'Imagem', icon: React.createElement(ImageIcon, { size: 13 }) };
  }

  // 4. Documento
  if (
    lastMsg?.media?.kind === 'document' ||
    lastMsg?.media?.category === 'document' ||
    ['[document]', '[documento]', '[arquivo]', 'documento', 'arquivo', '[documento recebido]', '[arquivo recebido]'].includes(lower) ||
    lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.xlsx')
  ) {
    return { type: 'document', label: 'Documento', icon: React.createElement(FileText, { size: 13 }) };
  }

  // 5. Localização
  if (
    Boolean(lastMsg?.location) ||
    ['[location]', 'location', '[localização]', '[localizacao]', 'localização', 'localizacao', '[localização recebida]'].includes(lower)
  ) {
    return { type: 'location', label: 'Localização', icon: React.createElement(MapPin, { size: 13 }) };
  }

  // 6. Contato
  if (
    ['[contact]', '[contato]', 'contato'].includes(lower) ||
    lastMsg?.media?.kind === 'contact'
  ) {
    return { type: 'contact', label: 'Contato', icon: React.createElement(UserRound, { size: 13 }) };
  }

  // 7. Sticker
  if (
    lastMsg?.media?.kind === 'sticker' ||
    ['[sticker]', '[figurinha]', 'figurinha', 'sticker', '[figurinha recebida]'].includes(lower)
  ) {
    return { type: 'sticker', label: 'Sticker', icon: React.createElement(Sparkles, { size: 13 }) };
  }

  // 8. Anexo genérico
  if (Boolean(lastMsg?.media)) {
    return { type: 'attachment', label: 'Anexo', icon: React.createElement(Paperclip, { size: 13 }) };
  }

  // 9. Texto comum
  return { type: 'text', label: '', icon: React.createElement(MessageSquare, { size: 13 }) };
}
