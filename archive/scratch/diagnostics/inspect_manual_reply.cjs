const fs = require('fs');
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.trim().match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[match[1].trim()] = val;
  }
}
async function test() {
  const url = `${env.SUPABASE_URL}/rest/v1/channel_events?service=eq.manual_reply&tenant_slug=eq.wesley_automoveis&direction=eq.outbound&sender_type=eq.agent&message_text=not.like.%5B%25%5D&order=created_at.desc&limit=5`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const data = await res.json();
  console.log(JSON.stringify(data[0], null, 2));
}
test().catch(console.error);
