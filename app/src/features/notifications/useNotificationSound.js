import { useCallback, useEffect, useRef, useState } from 'react';

export function playNotificationTone(context) {
  if (!context || context.state !== 'running') return false;
  const time = context.currentTime;
  for (const [frequency, offset] of [[740, 0], [988, 0.13]]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time + offset);
    gain.gain.linearRampToValueAtTime(0.065, time + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.23);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time + offset);
    oscillator.stop(time + offset + 0.25);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  return true;
}

export function useNotificationSound(scope) {
  const key = scope ? `${scope}:sound` : null;
  const [enabled, setEnabled] = useState(() => {
    try { return Boolean(key) && window.localStorage.getItem(key) !== 'off'; } catch { return Boolean(key); }
  });
  const [ready, setReady] = useState(false);
  const context = useRef(null);
  const lastPlayed = useRef(-Infinity);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const unlock = useCallback(async () => {
    if (!key || !enabledRef.current) return;
    if (context.current?.state === 'running') return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context.current ||= new AudioContext();
      await context.current.resume();
      setReady(context.current.state === 'running');
    } catch { setReady(false); }
  }, [key]);

  useEffect(() => {
    const interaction = () => { void unlock(); };
    window.addEventListener('pointerdown', interaction);
    window.addEventListener('keydown', interaction);
    return () => {
      window.removeEventListener('pointerdown', interaction);
      window.removeEventListener('keydown', interaction);
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, [unlock]);

  const play = useCallback(() => {
    if (!enabledRef.current || Date.now() - lastPlayed.current < 3000) return;
    try {
      if (key && Date.now() - Number(window.localStorage.getItem(`${key}:last-played`) || 0) < 3000) return;
    } catch { /* Throttle within this tab if storage is unavailable. */ }
    if (playNotificationTone(context.current)) {
      lastPlayed.current = Date.now();
      try { if (key) window.localStorage.setItem(`${key}:last-played`, String(lastPlayed.current)); } catch { /* Optional cross-tab throttle. */ }
    }
  }, [key]);
  const toggle = () => {
    const next = !enabled;
    enabledRef.current = next;
    setEnabled(next);
    try { if (key) window.localStorage.setItem(key, next ? 'on' : 'off'); } catch { /* Optional preference. */ }
    if (next) void unlock().then(play);
  };
  return { enabled, ready, play, toggle };
}
