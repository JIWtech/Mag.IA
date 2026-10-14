export function getTrustedContactName(event = {}) {
  if (String(event.direction || '').toLowerCase() !== 'inbound') return '';
  if (String(event.sender_type || '').toLowerCase() !== 'contact') return '';
  return String(event.contact_name || '').trim();
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

export function isBusinessOrGenericName(name, tenantSlug = '', instance = '') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  const norm = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (GENERIC_SYSTEM_ROLES.test(norm)) return true;

  const slug = String(tenantSlug || '').trim().toLowerCase();
  const inst = String(instance || '').trim().toLowerCase();

  // If candidate is identical to tenant slug or instance name (e.g. "wesley_automoveis")
  if (slug && (norm === slug || norm === slug.replace(/_/g, ' '))) return true;
  if (inst && (norm === inst || norm === inst.replace(/_/g, ' '))) return true;

  // Check against known tenant business patterns if tenant is matched
  if (slug) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[slug];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }
  if (inst) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[inst];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }

  // Also check common generic business keywords if slug/instance is associated
  if (slug || inst) {
    if (/\b(?:atendimento|assistente\s+virtual|inteligencia\s+artificial)\b/i.test(norm)) {
      return true;
    }
  }

  return false;
}

export function isUsefulContactName(value, phone = '', context = {}) {
  const name = String(value || '').trim();
  if (!name || /^(?:unknown|undefined|null|n\/?a)$/i.test(name)) return false;
  if (/^[\s._\-–—]+$/u.test(name)) return false;
  if (
    /^\+?\d+(?:@(s\.whatsapp\.net|c\.us))?$/i.test(name)
    || /@(s\.whatsapp\.net|c\.us|g\.us|lid|broadcast)$/i.test(name)
  ) {
    return false;
  }

  const digits = name.replace(/\D/g, '');
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (/^\d+$/.test(name) || (normalizedPhone && digits === normalizedPhone)) return false;
  const ctx = typeof context === 'string' ? { tenantSlug: context } : (context || {});
  if (isBusinessOrGenericName(name, ctx.tenantSlug || ctx.tenant_slug, ctx.instance)) return false;
  // WhatsApp permits intentional emoji-only push names. Keep them as display
  // names, while markers such as "." and "-" remain invalid above.
  return /\p{L}|\p{Extended_Pictographic}/u.test(name);
}

export function getUsefulTrustedContactName(event = {}) {
  const name = getTrustedContactName(event);
  const phone = event.contact_handle || event.external_conversation_id || '';
  return isUsefulContactName(name, phone) ? name : '';
}
