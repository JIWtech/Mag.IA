import React from 'react';
import { AlertTriangle, AlertCircle, Loader2 } from 'lucide-react';
import { resolveAudioNoticeState } from '../utils/chatTimelineHelpers.js';

export function AudioRecoveryNotice({ state = 'retryable_error', media, audioTranscription, onRetry }) {
  const resolvedState = media ? resolveAudioNoticeState(media, audioTranscription)?.type : null;
  const effectiveState = resolvedState || state;
  const isPreparing = effectiveState === 'resolving';
  const isMissingSource = effectiveState === 'missing_source' || effectiveState === 'unavailable_compact';

  if (isMissingSource) {
    return (
      <div className="audio-unavailable-compact" role="status" aria-label="Áudio indisponível">
        <AlertTriangle size={12} className="audio-unavailable-icon" aria-hidden="true" />
        <span className="audio-unavailable-text">Áudio indisponível</span>
      </div>
    );
  }

  const message = isPreparing
    ? 'Preparando áudio…'
    : 'Não foi possível carregar este áudio agora.';

  return (
    <div
      className={`audio-media-notice ${isPreparing ? 'is-loading' : 'is-error'}`}
      role={isPreparing ? 'status' : 'alert'}
      aria-live="polite"
    >
      {isPreparing
        ? <Loader2 size={14} className="audio-spinner" aria-hidden="true" />
        : <AlertCircle size={14} aria-hidden="true" />}
      <span>{message}</span>
      {!isPreparing && typeof onRetry === 'function' && (
        <button type="button" className="audio-retry-button" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
