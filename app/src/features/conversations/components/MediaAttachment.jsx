import React, { useState, useRef, useEffect } from 'react';
import {
  Loader2,
  Image as ImageIcon,
  Music2,
  Video,
  FileText,
  Sparkles,
  CircleDollarSign,
  Maximize2,
  Download,
  ExternalLink,
} from 'lucide-react';
import { ProductAttachment } from './ProductAttachment.jsx';
import { AudioRecoveryNotice } from './AudioRecoveryNotice.jsx';
import { TranscribedAudioCard } from './TranscribedAudioCard.jsx';
import { MediaCaption } from './MediaCaption.jsx';
import { MediaMeta } from './MediaMeta.jsx';
import { MediaViewer } from './MediaViewer.jsx';
import { AudioMessagePlayer } from '../../../components/AudioMessagePlayer.jsx';
import {
  REAL_MEDIA_KINDS,
  mediaSourceChanged,
  unavailableMediaLabel,
  formatFriendlyMimeType,
  formatFileSize,
} from '../../../utils/audioUtils.js';

export function MediaAttachment({ media, audioTranscription, onMediaLoad, onRetry, caption = '', meta = null, gallery = null }) {
  if (!media) return null;
  const kind = String(media.kind || media.category || '').toLowerCase();
  if (!kind || kind === 'text' || kind === 'conversation' || kind === 'none' || !REAL_MEDIA_KINDS.has(kind)) {
    return null;
  }

  const [viewerKind, setViewerKind] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const imageSource = `${media.thumbnailUrl || media.url || ''}\u0000${media.url || ''}`;
  const previousImageSourceRef = useRef(imageSource);

  useEffect(() => {
    if (!mediaSourceChanged(previousImageSourceRef.current, imageSource)) return;
    previousImageSourceRef.current = imageSource;
    setImageError(false);
    setImageLoaded(false);
    setViewerKind(null);
  }, [imageSource]);

  const config = {
    image: { label: 'Imagem', icon: ImageIcon },
    audio: { label: 'Áudio', icon: Music2 },
    video: { label: 'Vídeo', icon: Video },
    document: { label: 'Documento', icon: FileText },
    sticker: { label: 'Figurinha', icon: Sparkles },
    product: { label: 'Produto', icon: CircleDollarSign },
  }[kind] || { label: 'Arquivo', icon: FileText };
  const Icon = config.icon;

  if (kind === 'product') {
    return <ProductAttachment media={media} caption={caption} meta={meta} />;
  }

  if (kind === 'audio') {
    if (media.url) {
      const canRetry = media.status === 'stored' && media.bucket && media.storagePath;
      return <AudioMessagePlayer media={media} onLoad={onMediaLoad} onRetry={canRetry ? onRetry : undefined} />;
    }
    // Caso A: stored com storagePath mas sem URL -> resolving / retry
    if (media.status === 'stored' && media.bucket && media.storagePath) {
      if (media.loadState === 'retryable_error') {
        return <AudioRecoveryNotice state="retryable_error" onRetry={onRetry} />;
      }
      return <AudioRecoveryNotice state="resolving" />;
    }
    // Caso B: pending -> preparando
    if (media.status === 'pending' || media.loadState === 'resolving') {
      return <AudioRecoveryNotice state="resolving" />;
    }
    // Caso C: erro com retry
    if (['store_failed', 'storage_error', 'persistence_error', 'verification_failed', 'download_failed'].includes(media.status) || media.loadState === 'retryable_error') {
      return <AudioRecoveryNotice state="retryable_error" onRetry={media.bucket && media.storagePath ? onRetry : undefined} />;
    }
    // Caso D: transcrição válida
    const trans = audioTranscription || (media.transcription?.text ? media.transcription : null) || (media.transcript ? { text: media.transcript } : null);
    if (trans?.text) {
      return <TranscribedAudioCard transcription={trans} />;
    }
    // Caso E: indisponível compacto
    return <AudioRecoveryNotice state="missing_source" />;
  }

  if (media.status === 'pending' || media.loadState === 'resolving') {
    return (
      <div className="media-placeholder media-placeholder-loading" role="status" aria-live="polite">
        <Loader2 size={20} className="audio-spinner" aria-hidden="true" />
        <span>Preparando {config.label.toLowerCase()}â€¦</span>
      </div>
    );
  }

  if (['store_failed', 'storage_error', 'persistence_error', 'skipped_too_large'].includes(media.status)) {
    return (
      <div className="media-placeholder" title={unavailableMediaLabel(kind)}>
        <Icon size={20} />
        <span>{unavailableMediaLabel(kind)}</span>
      </div>
    );
  }

  if ((kind === 'image' || kind === 'sticker') && media.url) {
    if (imageError) {
      return (
        <div className="media-placeholder" title="Não foi possível carregar a imagem original">
          <Icon size={20} />
          <span>{media?.fileName || config.label}</span>
          <small>Falha no carregamento</small>
        </div>
      );
    }

    const hasRealCaption = Boolean(caption);
    const accessibleAlt = hasRealCaption ? caption : '';

    return (
      <div className={`media-message ${kind === 'sticker' ? 'is-sticker' : ''} ${hasRealCaption ? 'has-caption' : 'is-media-only'}`}>
        <button
          className={`media-image-button ${!imageLoaded ? 'is-loading' : ''}`}
          type="button"
          onClick={() => imageLoaded && setViewerKind(kind)}
          aria-label={hasRealCaption ? `Ampliar ${kind === 'sticker' ? 'figurinha' : 'imagem'}: ${accessibleAlt}` : `Ampliar ${kind === 'sticker' ? 'figurinha' : 'imagem'}`}
        >
          <div className={`media-image-container ${imageLoaded ? 'is-loaded' : ''}`}>
            {!imageLoaded && (
              <div className="media-image-skeleton" aria-hidden="true">
                <ImageIcon size={24} className="media-image-skeleton-icon" />
              </div>
            )}
            <img
              className={`media-image ${imageLoaded ? 'is-loaded' : 'is-loading'}`}
              src={media.thumbnailUrl || media.url}
              alt={accessibleAlt || (kind === 'sticker' ? 'Figurinha' : '')}
              decoding="async"
              onLoad={() => {
                setImageLoaded(true);
                if (typeof onMediaLoad === 'function') onMediaLoad();
              }}
              onError={() => {
                setImageError(true);
              }}
            />
          </div>
        </button>
        {hasRealCaption && <MediaCaption caption={caption} meta={meta} />}
        {!hasRealCaption && <MediaMeta meta={meta} overlay />}
        {viewerKind && <MediaViewer kind={viewerKind} src={media.url} alt={accessibleAlt || config.label} gallery={gallery?.items || []} initialIndex={gallery?.index || 0} onClose={() => setViewerKind(null)} />}
      </div>
    );
  }

  if (kind === 'video' && media.url) {
    return (
      <div className={`media-message media-video-message ${caption ? 'has-caption' : 'is-media-only'}`}>
        <div className="media-video-wrap">
          <video className="media-video" controls preload="metadata" poster={media.thumbnailUrl || undefined} src={media.url}>Seu navegador não suporta vídeo.</video>
          <button type="button" className="media-expand-button" aria-label="Abrir vídeo ampliado" onClick={() => setViewerKind('video')}><Maximize2 size={16} /></button>
          {!caption && <MediaMeta meta={meta} overlay />}
        </div>
        {caption && <MediaCaption caption={caption} meta={meta} />}
        {viewerKind && <MediaViewer kind="video" src={media.url} poster={media.thumbnailUrl} alt="Vídeo" onClose={() => setViewerKind(null)} />}
      </div>
    );
  }

  if (kind === 'document') {
    const fileName = media.fileName || 'Documento';
    const friendlyType = formatFriendlyMimeType(media.mimeType, fileName);
    const friendlySize = formatFileSize(media.size);
    const metaText = [friendlyType, friendlySize].filter(Boolean).join(' • ');

    if (media.url) {
      return (
        <div className="document-attachment">
          <div className="document-attachment-icon-wrapper">
            <FileText size={22} className="document-attachment-icon" />
          </div>
          <div className="document-attachment-info">
            <div className="document-attachment-filename" title={fileName}>{fileName}</div>
            {metaText && <div className="document-attachment-meta">{metaText}</div>}
          </div>
          <a
            className="document-attachment-action"
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            download={fileName}
            aria-label={`Baixar documento ${fileName}`}
          >
            <Download size={16} />
          </a>
        </div>
      );
    }

    return (
      <div className="document-attachment is-pending" title="O documento ainda está sendo processado">
        <div className="document-attachment-icon-wrapper">
          <FileText size={22} className="document-attachment-icon" />
        </div>
        <div className="document-attachment-info">
          <div className="document-attachment-filename" title={fileName}>{fileName}</div>
          <div className="document-attachment-meta">
            {metaText ? `${metaText} • ` : ''}Documento
          </div>
        </div>
      </div>
    );
  }

  // Fallback somente para mídias reais desconhecidas com URL ou com status stored
  if (media?.url) {
    return (
      <a className="media-placeholder media-download" href={media.url} target="_blank" rel="noopener noreferrer">
        <Icon size={20} />
        <span>{media.fileName || config.label}</span>
        <ExternalLink size={15} />
      </a>
    );
  }

  return (
    <div className="media-placeholder" title="O arquivo original ainda não foi disponibilizado pelo canal">
      <Icon size={20} />
      <span>{media?.fileName || config.label}</span>
      <small>Prévia indisponível</small>
    </div>
  );
}
