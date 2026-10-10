export function safeProductImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !host) return '';
    if (/(?:^|\.)(?:localhost|local|internal|test)$/.test(host)) return '';
    if (/^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(host)) return '';
    return url.href.slice(0, 1500);
  } catch (_) {
    return '';
  }
}

export function safeProductThumbnail(value) {
  const base64 = typeof value === 'string' ? value.trim() : '';
  if (base64 && base64.length <= 48000 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return `data:image/jpeg;base64,${base64}`;
  const bytes = Array.isArray(value?.data) ? value.data : (Array.isArray(value) ? value : null);
  if (!bytes || !bytes.length || bytes.length > 32000 || !bytes.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return '';
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
