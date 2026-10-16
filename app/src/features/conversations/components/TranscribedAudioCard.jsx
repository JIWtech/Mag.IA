import React from 'react';
import { Mic } from 'lucide-react';

export function TranscribedAudioCard({ transcription }) {
  if (!transcription?.text) return null;
  return (
    <div className="transcribed-audio-card compact" role="region" aria-label="Áudio transcrito">
      <div className="transcribed-audio-badge">
        <Mic size={12} className="transcribed-audio-icon" aria-hidden="true" />
        <span>Áudio transcrito</span>
      </div>
      <div className="transcribed-audio-text">
        &ldquo;{transcription.text}&rdquo;
      </div>
      <span className="transcribed-audio-note">Gravação original indisponível</span>
    </div>
  );
}
