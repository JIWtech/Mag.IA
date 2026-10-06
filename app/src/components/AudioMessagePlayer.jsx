import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Mic, AlertCircle, Loader2 } from 'lucide-react';
import { formatAudioTime, calculateAudioProgress, mediaSourceChanged } from '../audioUtils.js';

export { formatAudioTime, calculateAudioProgress };

/**
 * AudioMessagePlayer - Player de áudio customizado no estilo WhatsApp Web integrado ao NORIA.
 *
 * @param {Object} props
 * @param {Object} props.media - Metadados de mídia (kind, category, url, duration, mimeType, etc.)
 * @param {Function} [props.onLoad] - Callback executado quando os metadados do áudio forem carregados
 * @param {string} [props.className=''] - Classes CSS adicionais
 */
export function AudioMessagePlayer({
  media,
  onLoad,
  className = '',
}) {
  const audioRef = useRef(null);
  const timelineRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => {
    const raw = Number(media?.duration || media?.seconds || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  const src = media?.url || '';
  const previousSrcRef = useRef(src);
  const isPtt = Boolean(
    media?.ptt ||
    media?.category === 'ptt' ||
    media?.category === 'voice' ||
    media?.kind === 'voice' ||
    media?.mimeType?.includes('opus')
  );

  // Sincroniza duração se media.duration vier com atraso ou for atualizado
  useEffect(() => {
    const raw = Number(media?.duration || media?.seconds || 0);
    if (Number.isFinite(raw) && raw > 0) {
      setDuration((prev) => (prev > 0 ? prev : raw));
    }
  }, [media?.duration, media?.seconds]);

  // Uma URL assinada renovada representa uma nova tentativa de carregamento.
  // Preservamos duração/progresso, mas não deixamos o erro da URL anterior travar o player.
  useEffect(() => {
    if (!mediaSourceChanged(previousSrcRef.current, src)) return;
    previousSrcRef.current = src;
    setHasError(false);
    setIsLoading(false);
  }, [src]);

  // Sincroniza elemento de áudio real e eventos do ciclo de vida
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      onLoad?.();
    };

    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handlePlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleError = () => {
      setHasError(true);
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.pause();
    };
  }, [src, isSeeking, onLoad]);

  // Alterna play / pause
  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || hasError || !src) return;

    if (isPlaying) {
      audio.pause();
    } else {
      try {
        if (audio.ended || (duration > 0 && audio.currentTime >= duration)) {
          audio.currentTime = 0;
          setCurrentTime(0);
        }
        await audio.play();
      } catch (err) {
        console.warn('Audio play failed:', err);
        setIsPlaying(false);
      }
    }
  }, [isPlaying, hasError, src, duration]);

  // Cicla velocidade (1x -> 1.5x -> 2x -> 1x)
  const cycleSpeed = useCallback((e) => {
    e.stopPropagation();
    const speeds = [1, 1.5, 2];
    const nextIndex = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextRate = speeds[nextIndex];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }, [playbackRate]);

  // Cálculo de tempo proporcional na timeline
  const calculateSeekTime = useCallback((clientX) => {
    if (!timelineRef.current || duration <= 0) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  // Eventos de arraste e busca interativa (pointer events)
  const handlePointerDown = useCallback((e) => {
    if (hasError || duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    setIsSeeking(true);
    const newTime = calculateSeekTime(e.clientX);
    setSeekTime(newTime);
  }, [hasError, duration, calculateSeekTime]);

  const handlePointerMove = useCallback((e) => {
    if (!isSeeking) return;
    e.preventDefault();
    e.stopPropagation();
    const newTime = calculateSeekTime(e.clientX);
    setSeekTime(newTime);
  }, [isSeeking, calculateSeekTime]);

  const handlePointerUp = useCallback((e) => {
    if (!isSeeking) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    const finalTime = calculateSeekTime(e.clientX);
    setIsSeeking(false);
    setCurrentTime(finalTime);
    if (audioRef.current) {
      audioRef.current.currentTime = finalTime;
    }
  }, [isSeeking, calculateSeekTime]);

  // Acessibilidade por teclado (setas, home, end, space)
  const handleKeyDown = useCallback((e) => {
    if (duration <= 0) return;
    const step = e.shiftKey ? 1 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(duration, currentTime + step);
      setCurrentTime(next);
      if (audioRef.current) audioRef.current.currentTime = next;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(0, currentTime - step);
      setCurrentTime(next);
      if (audioRef.current) audioRef.current.currentTime = next;
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCurrentTime(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      setCurrentTime(duration);
      if (audioRef.current) audioRef.current.currentTime = duration;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
    }
  }, [duration, currentTime, togglePlay]);

  // Se houver erro ou ausência de URL, exibe estado de erro discreto
  if (hasError || !src) {
    return (
      <div className={`audio-player-error ${className}`} role="status">
        <AlertCircle size={16} className="audio-error-icon" aria-hidden="true" />
        <span className="audio-error-text">Áudio indisponível</span>
      </div>
    );
  }

  const activeTime = isSeeking ? seekTime : currentTime;
  const progressPercent = calculateAudioProgress(activeTime, duration);

  return (
    <div
      className={`audio-message-player ${isPtt ? 'is-ptt' : ''} ${className}`}
      role="region"
      aria-label={isPtt ? 'Mensagem de voz' : 'Mensagem de áudio'}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        style={{ display: 'none' }}
      />

      <button
        type="button"
        className={`audio-play-button ${isPlaying ? 'is-playing' : ''} ${isLoading ? 'is-loading' : ''}`}
        onClick={togglePlay}
        disabled={isLoading && !isPlaying}
        aria-label={isPlaying ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {isLoading && !isPlaying ? (
          <Loader2 size={18} className="audio-spinner" />
        ) : isPlaying ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" className="audio-play-icon" />
        )}
      </button>

      <div className="audio-player-body">
        <div
          ref={timelineRef}
          className={`audio-timeline ${isSeeking ? 'is-seeking' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Progresso do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(activeTime)}
          aria-valuetext={`${formatAudioTime(activeTime)} de ${formatAudioTime(duration)}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <div className="audio-track">
            <div
              className="audio-progress-bar"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className="audio-thumb"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="audio-player-meta">
          <div className="audio-time-display">
            <span className="audio-current-time">{formatAudioTime(activeTime)}</span>
            <span className="audio-time-separator">/</span>
            <span className="audio-duration-time">{formatAudioTime(duration)}</span>
          </div>

          <div className="audio-controls-right">
            {isPtt && (
              <span className="audio-ptt-badge" title="Mensagem de voz" aria-label="Mensagem de voz">
                <Mic size={12} className="audio-ptt-icon" />
              </span>
            )}
            <button
              type="button"
              className="audio-speed-btn"
              onClick={cycleSpeed}
              title={`Velocidade atual: ${playbackRate}x. Clique para alterar.`}
              aria-label={`Velocidade de reprodução: ${playbackRate}x`}
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
