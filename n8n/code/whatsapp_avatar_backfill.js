// Canonical source for the "Busca de fotos (perfil) conversas antigas" Code node.
// This workflow is avatar-only: it never creates contacts or changes their identity.
const helpers = this.helpers;

function env(name, fallback = '') {
  try { return String($env[name] || $vars?.[name] || fallback).trim(); } catch (_) { return fallback; }
}
function input() {
  try { return $input.first()?.json || {}; } catch (_) { return {}; }
}
function bool(value) { return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'; }
function count(value, fallback, max) { const n = Number(value); return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback; }
function mask(value) { const text = String(value || ''); return text.length > 4 ? `***${text.slice(-4)}` : '***'; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const TENANT_ID = '74b57037-9349-4a9e-889c-b65fb63c983a';
const TENANT_SLUG = 'wesley_automoveis';
const SUFFIX = 'WESLEY_AUTOMOVEIS';
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const TRANSIENT_RETRY_MS = 30 * 60 * 1000;
const REQUEST_DELAY_MS = count(env('NORIA_AVATAR_REQUEST_DELAY_MS', '400'), 400, 5000);
const execution = input();
const requestedContactId = String(execution.contact_id || env('NORIA_AVATAR_CONTACT_ID')).trim();
const requestedJid = canonicalHandle(execution.jid || execution.external_handle || env('NORIA_AVATAR_JID'));
const forceRefresh = bool(execution.force_refresh || env('NORIA_AVATAR_FORCE_REFRESH'));
const mode = requestedContactId || requestedJid ? 'single' : 'batch';
const batchLimit = mode === 'single' ? 1 : count(execution.limit || env('NORIA_AVATAR_BATCH_LIMIT', '25'), 25, 100);
const refreshReason = String(execution.reason || env('NORIA_AVATAR_REFRESH_REASON') || (forceRefresh ? 'forced' : 'scheduled')).slice(0, 80);

const supabaseBase = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const evolutionBase = env(`EVOLUTION_API_URL_${SUFFIX}`).replace(/\/$/, '');
const evolutionKey = env(`EVOLUTION_API_KEY_${SUFFIX}`);
const evolutionInstance = env(`EVOLUTION_INSTANCE_${SUFFIX}`);
if (!supabaseBase || !serviceKey || !evolutionBase || !evolutionKey || !evolutionInstance) throw new Error('Avatar workflow environment unavailable');

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const encode = value => encodeURIComponent(String(value ?? ''));
async function db(method, pathname, body = null, prefer = '') {
  return helpers.httpRequest({ method, url: `${supabaseBase}${pathname}`, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, ...(body === null ? {} : { body }), json: true, timeout: 10000 });
}
function canonicalHandle(value) {
  const match = String(value || '').trim().match(/^([1-9]\d{7,15})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i);
  return match ? `${match[1]}@s.whatsapp.net` : '';
}
function phoneFromHandle(value) { return canonicalHandle(value).replace('@s.whatsapp.net', ''); }
function fresh(value, ttl) { const at = Date.parse(String(value || '')); return Number.isFinite(at) && Date.now() >= at && Date.now() - at < ttl; }
function safeAvatarUrl(value) {
  const url = String(value || '').trim();
  const match = url.match(/^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:\/[^\s]*)?$/i);
  if (!match || url.length > 4096) return null;
  const host = match[1].toLowerCase();
  return host === 'pps.whatsapp.net' || host.endsWith('.whatsapp.net') ? url : null;
}
function metadata(contact) { return contact?.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata) ? contact.metadata : {}; }
function record(summary, contact, result) { summary.processed.push({ contact: mask(contact?.external_handle || contact?.id), result }); }
function addFailure(summary, source) { summary.failures += 1; summary.failure_sources[source] = (summary.failure_sources[source] || 0) + 1; summary.temporary_failures += 1; }

async function loadContacts() {
  let query = '/rest/v1/contacts?select=id,tenant_id,external_handle,avatar_url,avatar_fetched_at,metadata,updated_at&tenant_id=eq.' + encode(TENANT_ID) + '&source_channel=eq.whatsapp&deleted_at=is.null&order=updated_at.desc&limit=2000';
  if (requestedContactId) query += `&id=eq.${encode(requestedContactId)}`;
  if (requestedJid) query += `&external_handle=eq.${encode(requestedJid)}`;
  const rows = await db('GET', query);
  return (Array.isArray(rows) ? rows : []).filter(contact => contact.tenant_id === TENANT_ID && canonicalHandle(contact.external_handle));
}
async function fetchAvatar(phone) {
  try {
    const response = await helpers.httpRequest({ method: 'POST', url: `${evolutionBase}/chat/fetchProfilePictureUrl/${encode(evolutionInstance)}`, headers: { apikey: evolutionKey, 'Content-Type': 'application/json' }, body: { number: phone }, json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 6000 });
    const status = Number(response?.statusCode || response?.status || 0);
    const body = response?.body ?? response ?? {};
    const obj = body && typeof body === 'object' ? body : {};
    const data = obj.data && typeof obj.data === 'object' ? obj.data : {};
    if (status < 200 || status >= 300) return { ok: false, source: status === 429 ? 'evolution_http_429' : `evolution_http_${status || 'error'}` };
    const fields = ['profilePictureUrl', 'profilePicUrl', 'profile_picture_url'];
    const supplied = [obj, data].flatMap(source => fields.map(field => source[field])).find(value => typeof value === 'string' && value.trim());
    const explicitNone = [obj, data].some(source => fields.some(field => Object.prototype.hasOwnProperty.call(source, field) && source[field] === null));
    if (supplied) { const avatarUrl = safeAvatarUrl(supplied); return avatarUrl ? { ok: true, avatarUrl, source: 'evolution_api' } : { ok: false, source: 'evolution_invalid_avatar_url' }; }
    return explicitNone ? { ok: true, avatarUrl: null, source: 'evolution_no_photo' } : { ok: false, source: 'evolution_unrecognized_response' };
  } catch (_) { return { ok: false, source: 'evolution_timeout_or_network' }; }
}
async function saveAvatar(contact, avatar) {
  const now = new Date().toISOString();
  const currentMeta = metadata(contact);
  const nextMeta = { ...currentMeta };
  const patch = { updated_at: now };
  if (avatar.avatarUrl) {
    patch.avatar_url = avatar.avatarUrl;
    patch.avatar_fetched_at = now;
    delete nextMeta.whatsapp_avatar_negative_fetched_at;
    delete nextMeta.whatsapp_avatar_negative_status;
  } else {
    nextMeta.whatsapp_avatar_negative_fetched_at = now;
    nextMeta.whatsapp_avatar_negative_status = 'no_photo';
  }
  nextMeta.whatsapp_avatar_last_refresh_reason = refreshReason;
  patch.metadata = nextMeta;
  // Tenant and id are both mandatory; no name, phone, tags or ownership fields are written.
  return db('PATCH', `/rest/v1/contacts?id=eq.${encode(contact.id)}&tenant_id=eq.${encode(TENANT_ID)}`, patch, 'return=representation');
}
async function saveTransientFailure(contact, source) {
  const now = new Date().toISOString();
  const nextMeta = { ...metadata(contact), whatsapp_avatar_last_error_at: now, whatsapp_avatar_last_error_source: String(source).slice(0, 80), whatsapp_avatar_last_refresh_reason: refreshReason };
  return db('PATCH', `/rest/v1/contacts?id=eq.${encode(contact.id)}&tenant_id=eq.${encode(TENANT_ID)}`, { metadata: nextMeta, updated_at: now }, 'return=representation');
}

const startedAt = Date.now();
const allContacts = await loadContacts();
const contacts = allContacts.slice(0, batchLimit);
const summary = { tenant_id: TENANT_ID, tenant_slug: TENANT_SLUG, mode, force_refresh: forceRefresh, refresh_reason: refreshReason, candidates: contacts.length, contacts_created_or_found: contacts.length, fetched_from_evolution: 0, avatars_saved: 0, no_photo_cached: 0, skipped_fresh_cache: 0, positive_cache_used: 0, negative_cache_used: 0, urls_renewed: 0, invalid_urls: 0, individually_tested: mode === 'single' ? contacts.length : 0, confirmed_no_photo: 0, temporary_failures: 0, api_errors: 0, needs_retry: 0, records_modified: 0, failures: 0, failure_sources: {}, processed: [] };
if (mode === 'single' && !contacts.length) { summary.failures = 1; summary.failure_sources.contact_not_found = 1; }

for (const contact of contacts) {
  const cachedUrl = safeAvatarUrl(contact.avatar_url);
  const meta = metadata(contact);
  const positiveFresh = cachedUrl && fresh(contact.avatar_fetched_at, POSITIVE_TTL_MS);
  const negativeFresh = !cachedUrl && meta.whatsapp_avatar_negative_status === 'no_photo' && fresh(meta.whatsapp_avatar_negative_fetched_at, NEGATIVE_TTL_MS);
  const transientFresh = fresh(meta.whatsapp_avatar_last_error_at, TRANSIENT_RETRY_MS);
  if (!forceRefresh && positiveFresh) { summary.skipped_fresh_cache += 1; summary.positive_cache_used += 1; record(summary, contact, 'fresh_avatar_cache'); continue; }
  if (!forceRefresh && negativeFresh) { summary.skipped_fresh_cache += 1; summary.negative_cache_used += 1; record(summary, contact, 'fresh_no_photo_cache'); continue; }
  if (!forceRefresh && transientFresh) { summary.needs_retry += 1; record(summary, contact, 'transient_backoff'); continue; }
  if (contact.avatar_url && !cachedUrl) summary.invalid_urls += 1;
  const phone = phoneFromHandle(contact.external_handle);
  if (!phone) { addFailure(summary, 'invalid_jid'); record(summary, contact, 'invalid_jid'); continue; }
  const avatar = await fetchAvatar(phone);
  summary.fetched_from_evolution += 1;
  if (!avatar.ok) {
    addFailure(summary, avatar.source); summary.api_errors += 1; summary.needs_retry += 1;
    try { await saveTransientFailure(contact, avatar.source); summary.records_modified += 1; } catch (_) { addFailure(summary, 'avatar_failure_audit_write_error'); }
    record(summary, contact, avatar.source); await sleep(REQUEST_DELAY_MS); continue;
  }
  try {
    await saveAvatar(contact, avatar);
    summary.records_modified += 1;
    if (avatar.avatarUrl) { summary.avatars_saved += 1; if (avatar.avatarUrl !== cachedUrl) summary.urls_renewed += 1; } else { summary.no_photo_cached += 1; summary.confirmed_no_photo += 1; }
    record(summary, contact, avatar.source);
  } catch (_) { addFailure(summary, 'avatar_write_error'); summary.needs_retry += 1; record(summary, contact, 'avatar_write_error'); }
  await sleep(REQUEST_DELAY_MS);
}
summary.duration_ms = Date.now() - startedAt;
summary.processed = summary.processed.slice(0, 100);
return [{ json: summary }];
