import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaPreview, isGeneratedMediaLabel } from '../../src/services/media/mediaPresentation.js';

test('media presentation preserves labels, content priority, and absent values', () => {
  assert.equal(mediaPreview(null), '');
  assert.equal(mediaPreview({}), '[anexo]');
  assert.equal(mediaPreview({ kind: 'audio' }), '[audio]');
  assert.equal(mediaPreview({ category: 'video' }), '[vídeo]');
  assert.equal(mediaPreview({ kind: 'unknown' }), '[unknown]');
  assert.equal(mediaPreview({ caption: 'Legenda', fileName: 'arquivo.pdf', kind: 'document' }), 'Legenda');
  assert.equal(mediaPreview({ fileName: 'arquivo.pdf', kind: 'document' }), 'arquivo.pdf');
});

test('generated media labels preserve accepted formats and reject ordinary text', () => {
  for (const label of ['[Imagem recebida]', '[Áudio recebida]', '[Video recebida]', '[Vídeo recebida]', '[Arquivo recebida]', '[Figurinha recebida]', ' [imagem recebida] ']) {
    assert.equal(isGeneratedMediaLabel(label), true);
  }
  for (const value of [null, undefined, '', '[audio]', '[Imagem enviada]', 'Imagem recebida']) {
    assert.equal(isGeneratedMediaLabel(value), false);
  }
});
