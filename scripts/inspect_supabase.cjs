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

console.log('SUPABASE_URL:', url ? url.slice(0, 30) + '...' : 'undefined');
console.log('Has key:', Boolean(key));

async function main() {
  if (!url || !key) return;
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key };

  // 1. Tenants
  const resTenants = await fetch(url + '/rest/v1/tenants?select=id,slug,name,status', { headers });
  const tenants = await resTenants.json();
  console.log('\n--- TENANTS ---');
  console.log(JSON.stringify(tenants, null, 2));

  // 2. Tenant Settings
  const resSettings = await fetch(url + '/rest/v1/tenant_settings?select=tenant_id,settings', { headers });
  const settingsRows = await resSettings.json();
  console.log('\n--- TENANT SETTINGS COUNT ---', settingsRows.length);
  for (const row of settingsRows) {
    const t = tenants.find(x => x.id === row.tenant_id);
    const slug = t ? t.slug : row.tenant_id;
    console.log(`\nTenant: ${slug}`);
    console.log('Keys in settings:', Object.keys(row.settings || {}));
    if (row.settings?.sales) {
      console.log('Sales config keys:', Object.keys(row.settings.sales));
      console.log('Sales stages:', Object.keys(row.settings.sales.stages || {}));
      console.log('Hot lead rule:', row.settings.sales.hot_lead_rule);
      console.log('Collect docs:', row.settings.sales.collect_documents);
      console.log('Required docs:', row.settings.sales.required_financing_documents);
      console.log('Stage keys:', row.settings.sales.stage_keys);
    }
    if (row.settings?.system_prompt) {
      console.log('System prompt length:', row.settings.system_prompt.length);
      console.log('System prompt preview:', row.settings.system_prompt.slice(0, 200) + '...');
      if (row.settings.system_prompt.includes('[QUALIFICACAO FINANCIAMENTO')) {
        console.log('Has [QUALIFICACAO FINANCIAMENTO] marker: YES');
      } else {
        console.log('Has [QUALIFICACAO FINANCIAMENTO] marker: NO');
      }
      if (row.settings.system_prompt.includes('COLETA CONTEXTUAL DE FINANCIAMENTO')) {
        console.log('Has COLETA CONTEXTUAL DE FINANCIAMENTO: YES');
      } else {
        console.log('Has COLETA CONTEXTUAL DE FINANCIAMENTO: NO');
      }
    }
    if (row.settings?.sdr_rules) {
      console.log('sdr_rules:', JSON.stringify(row.settings.sdr_rules));
    }
    if (row.settings?.commercial_rules) {
      console.log('commercial_rules:', JSON.stringify(row.settings.commercial_rules));
    }
    if (row.settings?.ad_campaign_routing) {
      console.log('ad_campaign_routing:', JSON.stringify(row.settings.ad_campaign_routing));
    }
  }

  // 3. Channels
  const resChannels = await fetch(url + '/rest/v1/channels?select=id,tenant_id,type,external_id,status,config', { headers });
  const channels = await resChannels.json();
  console.log('\n--- CHANNELS ---');
  console.log(JSON.stringify(channels, null, 2));

  // 4. Kanban boards and columns
  const resBoards = await fetch(url + '/rest/v1/kanban_boards?select=id,tenant_id,name,settings', { headers });
  const boards = await resBoards.json();
  console.log('\n--- KANBAN BOARDS ---');
  console.log(JSON.stringify(boards, null, 2));

  const resCols = await fetch(url + '/rest/v1/kanban_columns?select=id,tenant_id,board_id,name,position,automation_key&order=position.asc', { headers });
  const cols = await resCols.json();
  console.log('\n--- KANBAN COLUMNS ---');
  console.log(JSON.stringify(cols, null, 2));

  // 5. Excluded contacts
  const resEx = await fetch(url + '/rest/v1/tenant_ai_excluded_contacts?select=tenant_id,source', { headers });
  const excluded = await resEx.json();
  console.log('\n--- EXCLUDED CONTACTS COUNT ---', excluded.length);
  const byTenant = {};
  for (const ex of excluded) {
    byTenant[ex.tenant_id] = (byTenant[ex.tenant_id] || 0) + 1;
  }
  console.log('Excluded count by tenant:', byTenant);

  // 6. Recent sales_leads
  const resLeads = await fetch(url + '/rest/v1/sales_leads?select=id,tenant_id,chat_id,stage_key,hot,created_at&order=created_at.desc&limit=5', { headers });
  const leads = await resLeads.json();
  console.log('\n--- RECENT SALES LEADS ---');
  for (const l of leads) {
    console.log(`Lead: chat=${l.chat_id}, stage=${l.stage_key}, hot=${l.hot}, created=${l.created_at}`);
  }

  // 7. Team agents
  const resAgents = await fetch(url + '/rest/v1/team_agents?select=*', { headers });
  const agents = await resAgents.json();
  console.log('\n--- TEAM AGENTS ---', agents.length);

  // 10. Channels
  const resChannels2 = await fetch(url + '/rest/v1/channels?select=id,tenant_id,type,external_id,status,config', { headers });
  const channels2 = await resChannels2.json();
  console.log('\n--- CHANNELS ---');
  console.log(JSON.stringify(channels2, null, 2));
}

main().catch(err => {
  console.error('Error querying Supabase:', err);
});
