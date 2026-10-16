const fs = require('fs');

function parseEnv(path) {
  if (!fs.existsSync(path)) return {};
  const content = fs.readFileSync(path, 'utf8');
  const res = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    res[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return res;
}

const env = { ...parseEnv('.env'), ...parseEnv('app/.env') };
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

async function updateSettings() {
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // 1. Fetch current tenant and settings
  const resTenant = await fetch(url + '/rest/v1/tenants?slug=eq.wesley_automoveis&select=id,slug,tenant_settings(*)', { headers });
  const tenants = await resTenant.json();
  if (!tenants || !tenants.length) throw new Error('Tenant wesley_automoveis not found');

  const tenant = tenants[0];
  const currentSettings = tenant.tenant_settings[0].settings;

  console.log('Current stage_keys:', currentSettings.sales?.stage_keys);
  console.log('Current hot_lead_rule:', currentSettings.sales?.hot_lead_rule);
  console.log('Current hot_lead_percent:', currentSettings.sdr_rules?.hot_lead_percent);

  // 2. Prepare updated settings
  const updatedSales = {
    ...currentSettings.sales,
    hot_lead_rule: 'deposit_30_and_financing_documents_v1',
    stage_keys: {
      ...currentSettings.sales?.stage_keys,
      financing: 'sales_financing'
    }
  };

  const updatedSdrRules = {
    ...currentSettings.sdr_rules,
    hot_lead_percent: 30
  };

  const newSettings = {
    ...currentSettings,
    sales: updatedSales,
    sdr_rules: updatedSdrRules
  };

  // 3. Patch tenant_settings
  const patchRes = await fetch(url + `/rest/v1/tenant_settings?tenant_id=eq.${tenant.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ settings: newSettings })
  });

  if (!patchRes.ok) {
    const errText = await patchRes.text();
    throw new Error(`Failed to update tenant_settings: ${patchRes.status} ${errText}`);
  }

  const updatedRows = await patchRes.json();
  console.log('\n✅ Successfully updated tenant_settings!');
  console.log('New stage_keys:', updatedRows[0].settings.sales?.stage_keys);
  console.log('New hot_lead_rule:', updatedRows[0].settings.sales?.hot_lead_rule);
  console.log('New hot_lead_percent:', updatedRows[0].settings.sdr_rules?.hot_lead_percent);
}

updateSettings().catch(console.error);
