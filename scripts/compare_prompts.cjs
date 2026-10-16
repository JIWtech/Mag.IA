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
  const res = await fetch(url + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.74b57037-9349-4a9e-889c-b65fb63c983a', { headers });
  const data = await res.json();
  const remotePrompt = data[0].settings.system_prompt;
  const localFile = fs.readFileSync('clients/wesley_automoveis/system_prompt.md', 'utf8');
  const collectionPrompt = fs.readFileSync('clients/wesley_automoveis/financing_collection_prompt.md', 'utf8');

  fs.writeFileSync('scripts/remote_system_prompt_dump.md', remotePrompt, 'utf8');
  console.log('Saved remote system prompt to scripts/remote_system_prompt_dump.md');
}

run().catch(console.error);
