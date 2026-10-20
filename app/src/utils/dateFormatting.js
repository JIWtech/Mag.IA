export function formatDate(value) {
  if (!value) return 'Agora';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Agora';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return 'Agora';
  }
}

export function compareDateLabel(a, b) {
  const epochA = a ? Date.parse(a) : 0;
  const epochB = b ? Date.parse(b) : 0;
  return (Number.isNaN(epochA) ? 0 : epochA) - (Number.isNaN(epochB) ? 0 : epochB);
}
