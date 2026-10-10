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
  const audioEventId = '9a189a4c-b86b-4414-82fb-eff95b4759c3';
  const res = await fetch(`${supabaseUrl}/rest/v1/channel_events?id=eq.${audioEventId}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const rows = await res.json();
  const row = rows[0];
  if (!row) {
    console.log('Audio event not found');
    return;
  }
  console.log('Audio event ID:', row.id);
  console.log('Created at:', row.created_at);
  console.log('raw_payload.media:', row.raw_payload?.media);
  console.log('raw_payload.audio_processing:', row.raw_payload?.audio_processing);
  console.log('raw_payload.audio_metadata:', row.raw_payload?.audio_metadata);
}

main().catch(console.error);
