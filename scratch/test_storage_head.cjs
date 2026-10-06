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

async function testHeadAndRange() {
  const oldPath = 'wesley_automoveis/whatsapp/5521985198468_s.whatsapp.net/AC3FB5307AC6ED88A20D0F9D6D519EFD.jpg';
  const url = `${supabaseUrl}/storage/v1/object/channel-media/${oldPath}`;

  console.log('Testing HEAD on', url);
  const headRes = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }
  });
  console.log('HEAD status:', headRes.status);
  console.log('HEAD content-length:', headRes.headers.get('content-length'));
  console.log('HEAD content-type:', headRes.headers.get('content-type'));

  console.log('\nTesting GET with Range: bytes=0-15 on', url);
  const rangeRes = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Range: 'bytes=0-15',
    }
  });
  console.log('GET Range status:', rangeRes.status);
  console.log('GET Range content-length:', rangeRes.headers.get('content-length'));
  console.log('GET Range content-range:', rangeRes.headers.get('content-range'));
  const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
  console.log('GET Range bytes (hex):', rangeBuf.toString('hex').match(/../g).join(' '));
}

testHeadAndRange().catch(console.error);
