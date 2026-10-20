import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDisplayLabel, mediaPreview } from '../../src/services/media/mediaPresentation.js';
import { resolveVisualMediaCaption } from '../../src/features/conversations/utils/mediaPresentation.js';

test('visual and audio cards use friendly labels instead of filenames', () => {
  assert.equal(mediaDisplayLabel({ kind: 'image', fileName: 'veiculo-catalogo.jpg' }), 'Foto do veículo');
  assert.equal(mediaPreview({ kind: 'image', fileName: 'veiculo-catalogo.jpg' }), 'Foto do veículo');
  assert.equal(mediaPreview({ kind: 'image', fileName: 'IMG_123.jpg' }), 'Foto');
  assert.equal(mediaPreview({ kind: 'video', fileName: 'clip.mp4' }), 'Vídeo');
  assert.equal(mediaPreview({ kind: 'audio', fileName: 'voice.ogg' }), 'Áudio');
  assert.equal(mediaPreview({ kind: 'document', fileName: 'Proposta.pdf' }), 'Proposta.pdf');
});

test('real captions are preserved; filenames are not displayed as photo captions', () => {
  const media = { kind: 'image', fileName: 'veiculo-catalogo.jpg' };
  assert.equal(resolveVisualMediaCaption(media, media.fileName), '');
  assert.equal(resolveVisualMediaCaption(media, 'Veja o interior deste veículo'), 'Veja o interior deste veículo');
  assert.equal(mediaPreview({ ...media, caption: 'Interior do veículo' }), 'Interior do veículo');
});
