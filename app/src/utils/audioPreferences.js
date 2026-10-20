// Preferências do player de áudio do operador (volume e velocidade), persistidas
// no navegador e sincronizadas entre todos os players abertos na tela.

export const AUDIO_PREFERENCES_KEY = 'noria.audioPlayer.preferences';
export const AUDIO_PREFERENCES_EVENT = 'noria:audio-preferences';
export const AUDIO_PLAYBACK_EVENT = 'noria:audio-playback';

const ALLOWED_RATES = [1, 1.5, 2];
const DEFAULT_PREFERENCES = Object.freeze({ volume: 1, lastAudibleVolume: 1, playbackRate: 1 });

const clampVolume = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
};

export function normalizeAudioPreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const volume = clampVolume(source.volume, DEFAULT_PREFERENCES.volume);
  const lastAudibleVolume = clampVolume(source.lastAudibleVolume, volume > 0 ? volume : 1) || 1;
  const playbackRate = ALLOWED_RATES.includes(Number(source.playbackRate)) ? Number(source.playbackRate) : 1;
  return { volume, lastAudibleVolume, playbackRate };
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadAudioPreferences(storage) {
  try {
    const raw = getStorage(storage)?.getItem(AUDIO_PREFERENCES_KEY);
    return normalizeAudioPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveAudioPreferences(patch, storage) {
  const current = loadAudioPreferences(storage);
  const next = normalizeAudioPreferences({ ...current, ...patch });
  if (next.volume > 0) next.lastAudibleVolume = next.volume;
  try {
    getStorage(storage)?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Armazenamento indisponível (aba privada): a preferência vale só nesta sessão.
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(AUDIO_PREFERENCES_EVENT, { detail: next }));
  }
  return next;
}

export const AUDIO_PLAYBACK_RATES = ALLOWED_RATES;
