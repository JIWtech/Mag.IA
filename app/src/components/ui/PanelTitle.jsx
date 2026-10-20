import React from 'react';

export function PanelTitle({ icon: Icon, title, action, className = '' }) {
  return (
    <div className={`panel-title ${className}`}>
      <div><Icon size={18} /><h2>{title}</h2></div>
      {action && <button type="button">{action}</button>}
    </div>
  );
}
