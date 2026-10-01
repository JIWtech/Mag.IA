import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to simulate unit/location matching in SettingsPage
function resolveUnits(rawUnits, rawLocations) {
  const locationsList = Array.isArray(rawLocations)
    ? rawLocations
    : (rawLocations && typeof rawLocations === 'object' ? Object.entries(rawLocations).map(([k, v]) => ({ id: v?.id || k, ...v })) : []);

  if (!rawUnits) return [];
  let list = [];
  if (Array.isArray(rawUnits)) {
    list = rawUnits.map((u) => ({ id: u.id || u.slug || u.name, name: u.name || u.label || u.id, ...u }));
  } else if (typeof rawUnits === 'object') {
    list = Object.entries(rawUnits).map(([key, val]) => ({
      id: val?.id || val?.slug || key,
      name: val?.name || val?.label || key,
      ...val,
    }));
  }

  return list.map((unit) => {
    const matchedLoc = locationsList.find((loc) =>
      String(loc?.id || '').toLowerCase() === String(unit?.id || '').toLowerCase()
    );
    const address = matchedLoc?.address || unit?.address || null;
    const displayName = matchedLoc?.name || unit?.name || unit?.id;
    return {
      ...unit,
      displayName,
      address,
    };
  });
}

function resolveEnabledChannels(rawEnabledChannels) {
  if (!Array.isArray(rawEnabledChannels)) return [];
  return rawEnabledChannels;
}

function formatBusinessHours(bh) {
  if (!bh || typeof bh !== 'object') return null;
  if (typeof bh === 'string' && bh.trim()) return bh.trim();
  if (Object.keys(bh).length === 0) return null;

  if (bh.start && bh.end) {
    const days = Array.isArray(bh.days) ? bh.days : [];
    let daysLabel = 'Todos os dias';
    if (days.length === 7) {
      daysLabel = 'Todos os dias';
    } else if (days.length === 6 && days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sábado';
    } else if (days.length === 5 && !days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sexta';
    } else if (days.length > 0) {
      const mapDay = {
        segunda: 'Seg',
        terca: 'Ter',
        quarta: 'Qua',
        quinta: 'Qui',
        sexta: 'Sex',
        sabado: 'Sáb',
        domingo: 'Dom',
      };
      daysLabel = days.map((d) => mapDay[String(d).toLowerCase()] || d).join(', ');
    }
    return `${daysLabel} · ${bh.start} às ${bh.end}`;
  }

  if (bh.weekdays) {
    return `Seg a Sex: ${bh.weekdays}${bh.saturday ? ` · Sáb: ${bh.saturday}` : ''}`;
  }

  const values = Object.values(bh).filter((v) => typeof v === 'string');
  if (values.length > 0) return values.join(' · ');

  return null;
}

test('resolves unit address cross-referencing appointment_scheduling.units and business_facts.locations by id', () => {
  const units = {
    angra: { name: 'Angra dos Reis', slug: 'angra' },
    paraty: { name: 'Paraty', slug: 'paraty' },
  };

  const locations = [
    { id: 'angra', name: 'Nova Angra', address: 'Av. Itaguaí, 200 - Nova Angra' },
  ];

  const resolved = resolveUnits(units, locations);
  assert.equal(resolved.length, 2);

  // Unit with matching address
  assert.equal(resolved[0].displayName, 'Nova Angra');
  assert.equal(resolved[0].address, 'Av. Itaguaí, 200 - Nova Angra');

  // Unit without matching address
  assert.equal(resolved[1].displayName, 'Paraty');
  assert.equal(resolved[1].address, null);
});

test('returns empty units list when appointment_scheduling.units is absent or empty', () => {
  const resolved = resolveUnits(null, [{ id: 'angra', address: 'Rua X' }]);
  assert.deepEqual(resolved, []);
});

test('enabled channels has ZERO fallbacks to whatsapp when absent or empty', () => {
  assert.deepEqual(resolveEnabledChannels(null), []);
  assert.deepEqual(resolveEnabledChannels(undefined), []);
  assert.deepEqual(resolveEnabledChannels([]), []);
  assert.deepEqual(resolveEnabledChannels(['whatsapp']), ['whatsapp']);
  assert.deepEqual(resolveEnabledChannels(['whatsapp', 'telegram']), ['whatsapp', 'telegram']);
});

test('business hours returns null when empty or missing to allow omission of KPI card', () => {
  assert.equal(formatBusinessHours(null), null);
  assert.equal(formatBusinessHours({}), null);
  assert.equal(formatBusinessHours(undefined), null);

  const formatted = formatBusinessHours({
    days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'],
    start: '08:00',
    end: '18:00',
  });
  assert.equal(formatted, 'Segunda a Sábado · 08:00 às 18:00');
});

test('payload for team agent sends branch: null when empty to prevent Matriz default', () => {
  function prepareAgentPayload(agent, tenant) {
    return {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      name: String(agent.name || '').trim(),
      role: agent.role ? String(agent.role).trim() : null,
      branch: (agent.branch && String(agent.branch).trim()) ? String(agent.branch).trim() : null,
      shift: (agent.shift && String(agent.shift).trim()) ? String(agent.shift).trim() : null,
      status: agent.status || 'online',
      is_active: agent.is_active !== undefined ? Boolean(agent.is_active) : true,
    };
  }

  const tenant = { id: 'tenant-123', slug: 'clinica-nubia' };

  // Agent with empty branch and shift
  const payloadEmpty = prepareAgentPayload({ name: 'Maria Silva', branch: '', shift: '' }, tenant);
  assert.equal(payloadEmpty.branch, null);
  assert.equal(payloadEmpty.shift, null);
  assert.equal(payloadEmpty.tenant_slug, 'clinica-nubia');

  // Agent with whitespace-only branch
  const payloadSpaces = prepareAgentPayload({ name: 'João Santos', branch: '   ', shift: '   ' }, tenant);
  assert.equal(payloadSpaces.branch, null);
  assert.equal(payloadSpaces.shift, null);

  // Agent with valid branch and shift
  const payloadFull = prepareAgentPayload({
    name: 'Dra. Camila',
    role: 'Dentista',
    branch: 'Nova Angra',
    shift: '08:00 às 18:00',
  }, tenant);
  assert.equal(payloadFull.branch, 'Nova Angra');
  assert.equal(payloadFull.shift, '08:00 às 18:00');
  assert.equal(payloadFull.role, 'Dentista');
});
