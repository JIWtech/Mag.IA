import React from 'react';

export function Badge({ value, status }) {
  return <span className={`badge ${status}`}>{value}</span>;
}
