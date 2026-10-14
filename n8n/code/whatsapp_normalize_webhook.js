function env(name, fallback = '') {
  try { return $env[name] || fallback; } catch { return fallback; }
}
function text(value) { return String(value || '').trim(); }
function normalizeSlug(value) { return text(value).toLowerCase().replace(/[^a-z0-9_-]/g, ''); }
function normalizeEvent(value) { return text(value).toLowerCase().replace(/_/g, '.'); }

const input = typeof $json.body === 'string' ? JSON.parse($json.body || '{}') : ($json.body || $json);
const eventRaw = text(input.event || input.type);
const event = normalizeEvent(eventRaw);
const data = input.data || input;
const key = data.key || data.message?.key || {};
const remoteJid = text(key.remoteJid || key.remoteJidAlt || data.remoteJid);
const message = data.message || {};
const messageType = text(data.messageType || Object.keys(message)[0] || 'conversation');
const fromMe = key.fromMe === true || data.fromMe === true;
let messageText = text(message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || message.documentMessage?.caption);
let contentType = 'text';
let base64 = text(data.base64 || message.base64 || message.audioMessage?.base64);
if (!messageText && messageType.toLowerCase().includes('audio')) { contentType = 'audio'; messageText = '[audio]'; }
else if (!messageText) { contentType = messageType.replace(/Message$/i, '').toLowerCase() || 'unknown'; messageText = '[' + contentType + ']'; }
const phone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
const instance = text(input.instance || input.instanceName || input.instanceId || data.instance || data.instanceName || data.instanceId || env('EVOLUTION_INSTANCE_JIW'));
const fallbackTenant = normalizeSlug(env('WHATSAPP_TENANT_SLUG', env('DEFAULT_TENANT_SLUG', 'jiw'))) || 'jiw';
let tenantSlug = fallbackTenant;
let tenantResolution = { tenant_slug: fallbackTenant, source: 'env_fallback' };
const supabaseUrl = text(env('SUPABASE_URL')).replace(/\/$/, '');
const serviceKey = text(env('SUPABASE_SERVICE_ROLE_KEY'));
if (supabaseUrl && serviceKey && instance) {
  try {
    const rows = await this.helpers.httpRequest({ method: 'GET', url: `${supabaseUrl}/rest/v1/channels?select=external_id,config,tenants(slug,status)&type=eq.whatsapp&status=eq.active&limit=200`, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, json: true, timeout: 7000 });
    const expected = normalizeSlug(instance);
    const match = (Array.isArray(rows) ? rows : []).find((channel) => {
      const config = channel?.config && typeof channel.config === 'object' ? channel.config : {};
      return [channel?.external_id, config.instance_name, config.instance, config.evolution_instance, config.instance_id, config.instanceId].map(normalizeSlug).includes(expected);
    });
    if (match?.tenants?.slug) {
      tenantSlug = normalizeSlug(match.tenants.slug);
      tenantResolution = { tenant_slug: tenantSlug, source: 'channels.config', channel: match };
    }
  } catch {}
}
const KNOWN_TENANT_BUSINESS_PATTERNS = {
  wesley_automoveis: [
    /^(?:g[eê]nesis|wesley)\s*(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)\b/i,
    /^(?:g[eê]nesis\s+autom[oó]veis|wesley\s+autom[oó]veis|wesley_automoveis)$/i,
  ],
  '74b57037-9349-4a9e-889c-b65fb63c983a': [
    /^(?:g[eê]nesis|wesley)\s*(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)\b/i,
    /^(?:g[eê]nesis\s+autom[oó]veis|wesley\s+autom[oó]veis|wesley_automoveis)$/i,
  ],
  clinica_nubia_oficial: [
    /^(?:cl[ií]nica\s+n[uú]bia(?:\s+oficial)?|n[uú]bia\s+oficial|clinica_nubia_oficial)$/i,
  ],
  royal_4x4: [
    /^royal\s+4x4(?:\s+ve[ií]culos)?$/i,
  ],
};

const GENERIC_SYSTEM_ROLES = /^(?:atendente|operador|operadora|suporte|sac|central(?:\s+de\s+atendimento)?|sistema|administrador|admin|bot|robo|noria)$/i;

function isBusinessOrTenantName(candidate, slug = '', inst = '') {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) return false;
  const norm = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (GENERIC_SYSTEM_ROLES.test(norm)) return true;

  const slugNorm = String(slug || '').trim().toLowerCase();
  const instNorm = String(inst || '').trim().toLowerCase();

  if (slugNorm && (norm === slugNorm || norm === slugNorm.replace(/_/g, ' '))) return true;
  if (instNorm && (norm === instNorm || norm === instNorm.replace(/_/g, ' '))) return true;

  if (slugNorm) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[slugNorm];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }
  if (instNorm) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[instNorm];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }

  if (slugNorm || instNorm) {
    if (/\b(?:atendimento|assistente\s+virtual|inteligencia\s+artificial)\b/i.test(norm)) {
      return true;
    }
  }
  return false;
}

const eventSupported = !event || ['messages.upsert', 'messages.update'].includes(event);
// fromMe is a valid message event. It is routed to the manual-capture branch,
// where known NORIA sends are deduplicated before any new event is created.
const ignoredReason = !eventSupported ? 'event_not_supported' : !remoteJid ? 'missing_remote_jid' : remoteJid.includes('@g.us') || remoteJid === 'status@broadcast' ? 'group_or_status' : !phone ? 'missing_phone' : '';
const candidatePush = fromMe ? '' : text(data.pushName || data.senderName);
const safeContactName = (!fromMe && candidatePush && !isBusinessOrTenantName(candidatePush, tenantSlug, instance))
  ? candidatePush
  : (fromMe ? '' : phone);

return { json: {
  shouldProcess: !ignoredReason, ignoredReason, event, eventRaw, tenant_slug: tenantSlug, tenant_resolution: tenantResolution,
  instance, remoteJid, phone, messageId: text(key.id || data.id || remoteJid + ':' + Date.now()),
  contactName: safeContactName, messageText, contentType, base64,
  is_manual_whatsapp_outbound: fromMe, raw_payload: input, channel_type: 'whatsapp',
} };
