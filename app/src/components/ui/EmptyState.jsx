import React from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({ title, text, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <Inbox size={compact ? 18 : 24} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
