/**
 * Formata latitude e longitude para exibição amigável (ex: 22.9068° S, 43.1729° O).
 * @param {number|string} lat
 * @param {number|string} lng
 * @returns {string}
 */
export function formatCoordinates(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return '';
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  const latDir = nLat >= 0 ? 'N' : 'S';
  const lngDir = nLng >= 0 ? 'L' : 'O';
  const absLat = Math.abs(nLat).toFixed(4);
  const absLng = Math.abs(nLng).toFixed(4);
  return `${absLat}° ${latDir}, ${absLng}° ${lngDir}`;
}

/**
 * Conjunto canônico de tipos/categorias de mídias reais suportadas.
 * 'text', 'conversation' ou nulos NUNCA devem ser tratados como mídia.
 */
export const REAL_MEDIA_KINDS = new Set([
  'image', 'photo',
  'audio', 'ptt', 'voice',
  'video', 'video_note', 'animation',
  'document', 'file',
  'sticker', 'figurinha',
  'product', 'produto',
]);

/**
 * Formata tamanho em bytes para representação legível (ex: 450 KB, 1.2 MB).
 * @param {number|string} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!bytes || Number.isNaN(Number(bytes)) || Number(bytes) <= 0) return '';
  const num = Number(bytes);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Retorna uma descrição amigável do tipo do arquivo baseada no MIME type ou extensão.
 * @param {string} mimeType
 * @param {string} [fileName]
 * @returns {string}
 */
export function formatFriendlyMimeType(mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const ext = String(fileName || '').split('.').pop()?.toLowerCase();

  if (mime.includes('pdf') || ext === 'pdf') return 'PDF';
  if (mime.includes('word') || mime.includes('document') || ext === 'docx' || ext === 'doc') return 'Word';
  if (mime.includes('sheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls') return 'Excel';
  if (mime.includes('presentation') || mime.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return 'PowerPoint';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || ext === 'zip' || ext === 'rar') return 'Arquivo Compactado';
  if (mime.includes('csv') || ext === 'csv') return 'CSV';
  if (mime.includes('text') || ext === 'txt') return 'Texto';
  return ext ? ext.toUpperCase() : 'Documento';
}

/**
 * Formata segundos para o padrão legível de player de áudio (ex: 0:04, 0:17, 1:03, 12:45).
 * Trata valores inválidos (NaN, Infinity, negativos, nulos) retornando sempre '0:00'.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatAudioTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Calcula a porcentagem de progresso da reprodução de forma segura (0 a 100).
 *
 * @param {number} currentTime
 * @param {number} duration
 * @returns {number}
 */
export function calculateAudioProgress(currentTime, duration) {
  if (typeof currentTime !== 'number' || typeof duration !== 'number') return 0;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  const ratio = currentTime / duration;
  return Math.min(100, Math.max(0, ratio * 100));
}

/**
 * Dicionário centralizado de placeholders técnicos e seus rótulos amigáveis.
 */
export const TECHNICAL_MEDIA_LABELS = {
  // Áudio / Voz
  '[audio]': 'Áudio',
  '[áudio]': 'Áudio',
  '[ptt]': 'Áudio',
  '[audio recebido]': 'Áudio',
  '[áudio recebido]': 'Áudio',
  '[voice]': 'Áudio',

  // Imagem
  '[image]': 'Imagem',
  '[imagem]': 'Imagem',
  '[photo]': 'Imagem',
  '[foto]': 'Imagem',
  '[imagem recebida]': 'Imagem',
  '[foto recebida]': 'Imagem',

  // Vídeo
  '[video]': 'Vídeo',
  '[vídeo]': 'Vídeo',
  '[vídeo recebido]': 'Vídeo',
  '[video recebido]': 'Vídeo',

  // Figurinha / Sticker
  '[sticker]': 'Figurinha',
  '[figurinha]': 'Figurinha',
  '[figurinha recebida]': 'Figurinha',

  // Documento / Arquivo
  '[document]': 'Documento',
  '[documento]': 'Documento',
  '[arquivo]': 'Documento',
  '[documento recebido]': 'Documento',
  '[arquivo recebido]': 'Documento',

  // Contato
  '[contact]': 'Contato',
  '[contato]': 'Contato',

  // Produto
  '[product]': 'Produto',
  '[produto]': 'Produto',

  // Álbum
  '[album]': 'Álbum',
  '[álbum]': 'Álbum',

  // Localização
  '[location]': 'Localização',
  'location': 'Localização',
  '[localizacao]': 'Localização',
  '[localização]': 'Localização',
  '[localização recebida]': 'Localização',
};

/**
 * Mapeamento de placeholders técnicos por tipo/categoria de mídia.
 */
export const PLACEHOLDERS_BY_KIND = {
  audio: ['[audio]', '[áudio]', '[audio recebido]', '[áudio recebido]', '[voice]', '[ptt]'],
  image: ['[image]', '[imagem]', '[photo]', '[foto]', '[imagem recebida]', '[foto recebida]'],
  video: ['[video]', '[vídeo]', '[vídeo recebido]', '[video recebido]'],
  document: ['[document]', '[documento]', '[arquivo]', '[documento recebido]', '[arquivo recebido]'],
  sticker: ['[sticker]', '[figurinha]', '[figurinha recebida]'],
  contact: ['[contact]', '[contato]'],
  product: ['[product]', '[produto]'],
  album: ['[album]', '[álbum]'],
  location: ['[location]', 'location', '[localização]', '[localizacao]', '[localização recebida]'],
};

/**
 * Normaliza um texto que seja estritamente um placeholder técnico para seu rótulo amigável.
 * Se for um texto legítimo que apenas contenha colchetes (ex: "Eu uso [audio] como nome da variável"),
 * o texto original é preservado integralmente.
 *
 * Casos especiais:
 * - [secretencrypted] -> retorna ''
 * - reaction / [reaction] -> retorna ''
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeTechnicalMediaPlaceholder(text) {
  if (typeof text !== 'string') return text || '';
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Casos especiais que não devem poluir a interface
  if (lower === '[secretencrypted]') {
    return '';
  }
  if (lower === 'reaction' || lower === '[reaction]') {
    return '';
  }

  // Correspondência integral case-insensitive de placeholder técnico
  if (Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, lower)) {
    return TECHNICAL_MEDIA_LABELS[lower];
  }

  return text;
}

/**
 * Detecta se o texto da mensagem é estritamente um placeholder técnico de mídia.
 * Quando há mídia real correspondente, o placeholder não deve ser exibido na bolha,
 * preservando apenas captions reais (ex: "Olha esse áudio").
 *
 * Se não houver mídia (histórico antigo), retorna false para que a mensagem seja tratada
 * pelo fallback amigável de exibição (normalizeTechnicalMediaPlaceholder).
 *
 * @param {string} text
 * @param {Object} [media]
 * @returns {boolean}
 */
export function isTechnicalMediaPlaceholder(text, media) {
  if (!text || !media) return false;
  const raw = String(text).trim().toLowerCase();
  const kind = String(media.kind || media.category || '').toLowerCase();

  const placeholders = PLACEHOLDERS_BY_KIND[kind] || [];
  return placeholders.includes(raw);
}

/**
 * Formata o preview da mensagem para a sidebar, Kanban e tooltips.
 * - Converte '/reset' para 'Conversa reiniciada'.
 * - Oculta metadados técnicos como '[secretencrypted]' e 'reaction'.
 * - Prioriza a legenda real da mídia se informada.
 * - Converte placeholders técnicos como '[audio]' para 'Áudio', '[image]' para 'Imagem', etc.
 * - Preserva mensagens legítimas de texto.
 *
 * @param {string} message
 * @param {Object} [media]
 * @returns {string}
 */
export function formatConversationPreview(message, media = null) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (lower === '/reset' || lower === 'reset') {
    return 'Conversa reiniciada';
  }
  if (lower === '[secretencrypted]' || lower === 'reaction' || lower === '[reaction]') {
    return '';
  }

  // Se houver caption real na mídia e o texto for um placeholder técnico:
  const caption = String(media?.caption || '').trim();
  if (caption && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase())) {
    return caption;
  }

  return normalizeTechnicalMediaPlaceholder(text);
}
