import React from 'react';
import { MediaMeta } from './MediaMeta.jsx';

export function MediaCaption({ caption, meta }) {
  if (!caption) return null;
  return (
    <div className="media-caption">
      <p>{caption}</p>
      <MediaMeta meta={meta} />
    </div>
  );
}
