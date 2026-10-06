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
const anonKey = env.SUPABASE_ANON_KEY;

async function main() {
  const newPath = 'wesley_automoveis/whatsapp/5521985198468_s.whatsapp.net/AC27DE76FC1847FA3D427B9C34A95EEB.jpg';
  const oldPath = 'wesley_automoveis/whatsapp/5521985198468_s.whatsapp.net/AC3FB5307AC6ED88A20D0F9D6D519EFD.jpg';
  
  // 1. Generate magic link for wesley to get an access token
  console.log('Generating link for wesley.homologacao@gmail.com...');
  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: 'wesley.homologacao@gmail.com'
    })
  });

  const linkData = await linkRes.json();
  const tokenHash = linkData.hashed_token;
  console.log('Got hashed token:', Boolean(tokenHash));

  let userToken = null;
  if (tokenHash) {
    // Exchange token_hash for session
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'magiclink',
        token_hash: tokenHash
      })
    });
    const sessionData = await verifyRes.json();
    console.log('Verify session user:', sessionData?.user?.id, sessionData?.user?.email);
    userToken = sessionData?.access_token;
  }

  if (userToken) {
    for (const [label, testPath] of [['NEW', newPath], ['OLD', oldPath]]) {
      console.log(`\n--- Testing createSignedUrl AS Wesley for ${label} ---`);
      const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/channel-media/${testPath}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 })
      });
      console.log(`${label} Sign response status:`, signRes.status);
      const signData = await signRes.json();
      console.log(`${label} Has signedURL:`, Boolean(signData?.signedURL));
      console.log(`${label} Sign error:`, signData?.error || signData?.message || 'none');

      if (signData?.signedURL) {
        const fullUrl = signData.signedURL.startsWith('http')
          ? signData.signedURL
          : `${supabaseUrl}/storage/v1${signData.signedURL}`;
        
        const fetchSigned = await fetch(fullUrl);
        console.log(`${label} Signed URL fetch HTTP Status:`, fetchSigned.status);
        console.log(`${label} Signed URL Content-Type:`, fetchSigned.headers.get('content-type'));
        console.log(`${label} Signed URL Content-Length:`, fetchSigned.headers.get('content-length'));
        if (fetchSigned.ok) {
          const ab = await fetchSigned.arrayBuffer();
          const buf = Buffer.from(ab);
          console.log(`${label} Downloaded length:`, buf.length);
          console.log(`${label} First 16 bytes (hex):`, buf.subarray(0, 16).toString('hex').match(/../g).join(' '));
          console.log(`${label} First 32 bytes (ascii):`, JSON.stringify(buf.subarray(0, 32).toString('utf8')));
        }
      }
    }
  } else {

    console.log('Could not get user token for Wesley');
  }
}

main().catch(console.error);
