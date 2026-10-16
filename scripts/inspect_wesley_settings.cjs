const fs = require('fs');

function parseEnv(path) {
  if (!fs.existsSync(path)) return {};
  const content = fs.readFileSync(path, 'utf8');
  const res = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    res[key] = val;
  }
  return res;
}

const env = { ...parseEnv('.env'), ...parseEnv('app/.env') };
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

async function run() {
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key };
  const res = await fetch(url + '/rest/v1/tenants?slug=eq.wesley_automoveis&select=id,slug,name,status,tenant_settings(*)', { headers });
  const data = await res.json();
  const t = data[0];
  console.log('Tenant:', t.slug, t.id);
  const s = t.tenant_settings[0].settings;
  console.log('Settings keys:', Object.keys(s));
  console.log('ai_model:', s.ai_model);
  console.log('ai_enabled:', s.ai_enabled);
  console.log('conversation_capability:', s.conversation_capability);
  console.log('whatsapp_processing_mode:', s.whatsapp_processing_mode);
  console.log('prompt_revision:', s.prompt_revision);
  console.log('sales keys:', Object.keys(s.sales || {}));
  console.log('sales.stages:', JSON.stringify(s.sales.stages, null, 2));
  console.log('sales.stage_keys:', JSON.stringify(s.sales.stage_keys, null, 2));
  console.log('sales.hot_lead_rule:', s.sales.hot_lead_rule);
  console.log('sales.collect_documents:', s.sales.collect_documents);
  console.log('sales.birth_date_required:', s.sales.birth_date_required);
  console.log('sales.required_financing_documents:', s.sales.required_financing_documents);
  console.log('sales.commercial_rules:', JSON.stringify(s.sales.commercial_rules));
  console.log('sdr_rules:', JSON.stringify(s.sdr_rules));
  console.log('--- WESLEY SETTINGS SUMMARY ---');
  console.log('ai_model:', s.ai_model);
  console.log('sales.hot_lead_rule:', s.sales?.hot_lead_rule);
  console.log('sales.collect_documents:', s.sales?.collect_documents);
  console.log('sales.birth_date_required:', s.sales?.birth_date_required);
  console.log('sales.required_financing_documents:', s.sales?.required_financing_documents);
  console.log('sales.stage_keys:', JSON.stringify(s.sales?.stage_keys));
  console.log('sales.stages count:', Object.keys(s.sales?.stages || {}).length);
  console.log('sales.stages keys:', Object.keys(s.sales?.stages || {}));
  console.log('sales.commercial_rules:', JSON.stringify(s.sales?.commercial_rules));
  console.log('ad_campaign_routing:', JSON.stringify(s.sales?.ad_campaign_routing, null, 2));
  console.log('conversation_contract:', JSON.stringify(s.sales?.conversation_contract, null, 2));
  console.log('whatsapp_catalog_price_mode:', s.sales?.whatsapp_catalog_price_mode);
  console.log('whatsapp_catalog_photo_enabled:', s.sales?.whatsapp_catalog_photo_enabled);
  console.log('whatsapp_catalog_sync_enabled:', s.sales?.whatsapp_catalog_sync_enabled);
  console.log('sales_follow_up:', JSON.stringify(s.sales_follow_up, null, 2));
  console.log('follow_up_enabled:', s.follow_up_enabled);
  console.log('contact_exclusion_enabled:', s.contact_exclusion_enabled);
}

run().catch(console.error);
