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
  return media.caption || media.fileName || labels[media.kind] || labels[media.category] || `[${media.kind || 'anexo'}]`;
}

export function isGeneratedMediaLabel(text) {
  return /^\[(?:Imagem|Áudio|Video|Vídeo|Arquivo|Figurinha) recebida\]$/i.test(String(text || '').trim());
}
