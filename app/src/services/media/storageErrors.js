export function isTransientStorageError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.code);
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const message = String(error?.message || error || '').toLowerCase();
  return /(network|fetch|timeout|timed out|econnreset|socket|rate.?limit|too many requests|temporar|service unavailable|bad gateway|gateway timeout)/.test(message);
}
