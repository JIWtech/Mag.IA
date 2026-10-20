import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Mic, AlertCircle, Loader2, Volume1, Volume2, VolumeX } from 'lucide-react';
import { formatAudioTime, calculateAudioProgress, mediaSourceChanged } from '../utils/audioUtils.js';
import {
  AUDIO_PLAYBACK_EVENT,
  AUDIO_PLAYBACK_RATES,
  AUDIO_PREFERENCES_EVENT,
  loadAudioPreferences,
  saveAudioPreferences,
} from '../utils/audioPreferences.js';

const WAVEFORM_BARS = 40;

// Forma de onda decorativa e estável por áudio (derivada da URL), no estilo WhatsApp.
function buildWaveform(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: WAVEFORM_BARS }, (_, index) => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5;
    const noise = ((hash >>> 0) % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((index / WAVEFORM_BARS) * Math.PI);
    return Math.round((0.22 + noise * 0.78 * envelope) * 100);
  });
}

let playerSequence = 0;

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
  onRetry,
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
  const [preferences, setPreferences] = useState(() => loadAudioPreferences());
  const { volume, playbackRate } = preferences;
  const playerIdRef = useRef(null);
  if (playerIdRef.current === null) {
    playerSequence += 1;
    playerIdRef.current = playerSequence;
  }
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
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
    setIsRetrying(false);
    setIsLoading(false);
  }, [src]);

  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const isSeekingRef = useRef(isSeeking);
  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  const retryAudio = useCallback(async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    setHasError(false);
    setIsLoading(true);
    try {
      if (onRetry) await onRetry();
      if (audioRef.current) {
        audioRef.current.load();
      }
    } catch (err) {
      console.warn('Audio retry failed:', err);
      setHasError(true);
    } finally {
      setIsRetrying(false);
      setIsLoading(false);
    }
  }, [isRetrying, onRetry]);

  // Sincroniza elemento de áudio real e eventos do ciclo de vida
  // O efeito depende ESTRITAMENTE de `src`, garantindo que re-renderizações do pai
  // (ex: chegada de novas mensagens no chat) ou ações de arraste na timeline (isSeeking)
  // NUNCA pausem ou reiniciem o áudio que está tocando.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      onLoadRef.current?.();
    };

    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      if (!isSeekingRef.current) {
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

    const handleError = (e) => {
      console.warn('Audio element error:', audio.error?.code, audio.error?.message, e);
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
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, src]);

  // Volume e velocidade são do operador: valem para todos os players e sobrevivem ao recarregar.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncPreferences = (event) => {
      if (event?.detail) setPreferences(event.detail);
    };
    const pauseWhenAnotherPlays = (event) => {
      if (event?.detail?.playerId !== playerIdRef.current) audioRef.current?.pause();
    };
    window.addEventListener(AUDIO_PREFERENCES_EVENT, syncPreferences);
    window.addEventListener(AUDIO_PLAYBACK_EVENT, pauseWhenAnotherPlays);
    return () => {
      window.removeEventListener(AUDIO_PREFERENCES_EVENT, syncPreferences);
      window.removeEventListener(AUDIO_PLAYBACK_EVENT, pauseWhenAnotherPlays);
    };
  }, []);

  const waveform = useMemo(() => buildWaveform(src || String(media?.id || 'audio')), [src, media?.id]);

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
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(AUDIO_PLAYBACK_EVENT, { detail: { playerId: playerIdRef.current } }));
        }
        await audio.play();
      } catch (err) {
        console.warn('Audio play failed:', err);
        setIsPlaying(false);
      }
    }
  }, [isPlaying, hasError, src, duration]);

  // Cicla velocidade (1x -> 1.5x -> 2x -> 1x) e lembra a escolha
  const cycleSpeed = useCallback((e) => {
    e.stopPropagation();
    const nextIndex = (AUDIO_PLAYBACK_RATES.indexOf(playbackRate) + 1) % AUDIO_PLAYBACK_RATES.length;
    setPreferences(saveAudioPreferences({ playbackRate: AUDIO_PLAYBACK_RATES[nextIndex] }));
  }, [playbackRate]);

  const changeVolume = useCallback((event) => {
    setPreferences(saveAudioPreferences({ volume: Number(event.target.value) }));
  }, []);

  const toggleMute = useCallback((event) => {
    event.stopPropagation();
    setPreferences((current) => saveAudioPreferences({
      volume: current.volume > 0 ? 0 : (current.lastAudibleVolume || 1),
    }));
  }, []);

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
      <div className={`audio-player-error ${className}`} role="alert">
        <AlertCircle size={16} className="audio-error-icon" aria-hidden="true" />
        <span className="audio-error-text">Não foi possível carregar este áudio agora.</span>
        {onRetry && (
          <button type="button" className="audio-retry-button" onClick={retryAudio} disabled={isRetrying}>
            {isRetrying ? 'Tentando...' : 'Tentar novamente'}
          </button>
        )}
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
      >
        <source src={src} type={media?.mimeType || 'audio/ogg; codecs=opus'} />
        <source src={src} type="audio/ogg" />
      </audio>

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
          <div className="audio-track has-waveform" style={{ '--audio-progress': `${progressPercent}%` }}>
            <div className="audio-waveform" aria-hidden="true">
              {waveform.map((height, index) => (
                <span
                  key={index}
                  className={((index + 0.5) / WAVEFORM_BARS) * 100 <= progressPercent ? 'is-played' : ''}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
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
            <div className={`audio-volume-control ${volume === 0 ? 'is-muted' : ''}`} title="Volume do áudio (salvo para os próximos áudios)">
              <button
                type="button"
                className="audio-mute-btn"
                onClick={toggleMute}
                aria-label={volume === 0 ? 'Ativar som' : 'Silenciar'}
                aria-pressed={volume === 0}
              >
                {volume === 0 ? <VolumeX size={15} aria-hidden="true" /> : volume < 0.5 ? <Volume1 size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={changeVolume}
                aria-label="Volume do áudio"
                style={{ '--volume': `${Math.round(volume * 100)}%` }}
              />
            </div>
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
