import React from 'react';
import { CheckCheck } from 'lucide-react';

export function MediaMeta({ meta, overlay = false }) {
  if (!meta) return null;
  return (
    <div className={`bubble-meta ${overlay ? 'is-media-overlay' : ''}`}>
      <span className="bubble-time">{meta.time}</span>
      {meta.showChecks && <CheckCheck size={13} className="bubble-check" />}
    </div>
  );
}
