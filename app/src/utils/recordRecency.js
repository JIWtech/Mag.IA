export function appointmentTimestamp(appointment) {
  const raw = appointment?.raw || appointment || {};
  return raw.updated_at || raw.occurred_at || raw.created_at || appointment?.updatedAt || appointment?.createdAt || '';
}

export function isMoreRecentRecord(candidate, current) {
  const candidateAt = Date.parse(candidate?.created_at || appointmentTimestamp(candidate));
  const currentAt = Date.parse(current?.created_at || appointmentTimestamp(current));
  if (!Number.isFinite(candidateAt)) return false;
  if (!Number.isFinite(currentAt)) return true;
  return candidateAt > currentAt;
}
