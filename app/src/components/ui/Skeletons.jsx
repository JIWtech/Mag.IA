import React from 'react';

export function SkeletonLine({ width, height, style, className }) {
  return <span className={`skeleton-line ${className || ''}`} style={{ width, height, ...style }} />;
}

export function SkeletonBlock({ width, height, style, className }) {
  return <div className={`skeleton-block ${className || ''}`} style={{ width, height, ...style }} />;
}
