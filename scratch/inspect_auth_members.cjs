const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[match[1]] = val.trim();
      }
    }
  }
  return env;
}

const env = loadEnv();
const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const res = await fetch(`${supabaseUrl}/rest/v1/tenant_members?select=*,tenants(id,slug,name)`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }
  });
  const members = await res.json();
  console.log('All Tenant Members:');
  console.log(JSON.stringify(members, null, 2));

  const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const authData = await authRes.json();
  console.log('\nAll Auth Users:');
  for (const u of authData.users || []) {
    console.log(`User ID: ${u.id} | Email: ${u.email}`);
  }
}

main().catch(console.error);
