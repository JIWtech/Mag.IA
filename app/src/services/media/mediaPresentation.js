export function mediaDisplayLabel(media = {}) {
  const kind = String(media.kind || media.category || '').toLowerCase();
  if (kind === 'document') return media.fileName || 'Documento';
  if (kind === 'image' || kind === 'photo') {
    return media.fileName === 'veiculo-catalogo.jpg' ? 'Foto do veículo' : 'Foto';
  }
  return { audio: 'Áudio', voice: 'Áudio', video: 'Vídeo', sticker: 'Figurinha', product: 'Produto' }[kind] || 'Anexo';
}

export function mediaPreview(media) {
  if (!media) return '';
  const labels = {
    image: '[imagem]',
    photo: '[imagem]',
    audio: '[audio]',
    voice: '[audio]',
    video: '[vídeo]',
    document: '[documento]',
    product: '[product]',
  };
  const kind = String(media.kind || media.category || '').toLowerCase();
  const caption = String(media.caption || '').trim();
  const usefulCaption = caption && caption !== media.fileName ? caption : '';
  return usefulCaption || (kind === 'document' ? media.fileName : '') || (media.fileName && ['image', 'photo', 'video', 'audio', 'voice', 'sticker'].includes(kind) ? mediaDisplayLabel(media) : '') || labels[kind] || `[${kind || 'anexo'}]`;
}

export function isGeneratedMediaLabel(text) {
  return /^\[(?:Imagem|Áudio|Video|Vídeo|Arquivo|Figurinha) recebida\]$/i.test(String(text || '').trim());
}
