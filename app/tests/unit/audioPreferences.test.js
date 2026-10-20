import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_PREFERENCES_KEY,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
} from '../../src/utils/audioPreferences.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test('volume escolhido pelo operador é salvo e recuperado', () => {
  const storage = memoryStorage();
  saveAudioPreferences({ volume: 0.35 }, storage);
  assert.equal(loadAudioPreferences(storage).volume, 0.35);
  assert.ok(storage.getItem(AUDIO_PREFERENCES_KEY));
});

test('silenciar preserva o último volume audível para desfazer o mudo', () => {
  const storage = memoryStorage();
  saveAudioPreferences({ volume: 0.6 }, storage);
  const muted = saveAudioPreferences({ volume: 0 }, storage);
  assert.equal(muted.volume, 0);
  assert.equal(muted.lastAudibleVolume, 0.6);
});

test('valores inválidos ou armazenamento vazio caem nos padrões seguros', () => {
  assert.deepEqual(loadAudioPreferences(memoryStorage()), { volume: 1, lastAudibleVolume: 1, playbackRate: 1 });
  assert.deepEqual(normalizeAudioPreferences({ volume: 7, playbackRate: 3 }), { volume: 1, lastAudibleVolume: 1, playbackRate: 1 });
  const broken = memoryStorage();
  broken.setItem(AUDIO_PREFERENCES_KEY, '{nao-e-json');
  assert.equal(loadAudioPreferences(broken).volume, 1);
});

test('velocidade de reprodução também é lembrada', () => {
  const storage = memoryStorage();
  saveAudioPreferences({ playbackRate: 1.5 }, storage);
  assert.equal(loadAudioPreferences(storage).playbackRate, 1.5);
});
