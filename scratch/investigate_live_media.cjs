const fs = require('fs');
const path = require('path');

// 1. Load .env
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

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

async function run() {
  console.log('--- 1. Querying channel_event 2b6cbe5b-fbb5-410f-b6ff-2eceb40d547e ---');
  const eventRes = await fetch(`${supabaseUrl}/rest/v1/channel_events?id=eq.2b6cbe5b-fbb5-410f-b6ff-2eceb40d547e`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }
  });
  const events = await eventRes.json();
  const event = events[0];
  if (!event) {
    console.log('Event not found!');
  } else {
    console.log('Event ID:', event.id);
    console.log('Event message_text:', event.message_text);
    console.log('Event raw_payload.media:', JSON.stringify(event.raw_payload?.media, null, 2));
    console.log('Event raw_payload.source_media:', JSON.stringify(event.raw_payload?.source_media, null, 2));
    const msg = event.raw_payload?.data?.message || event.raw_payload?.message || {};
    console.log('Event imageMessage summary:', {
      mimetype: msg.imageMessage?.mimetype,
      fileLength: msg.imageMessage?.fileLength,
      hasDirectPath: Boolean(msg.imageMessage?.directPath),
      hasUrl: Boolean(msg.imageMessage?.url)
    });
  }

  console.log('\n--- 1b. Querying old event for AC3FB5307AC6ED88A20D0F9D6D519EFD ---');
  const oldEventRes = await fetch(`${supabaseUrl}/rest/v1/channel_events?external_message_id=eq.AC3FB5307AC6ED88A20D0F9D6D519EFD`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const oldEvents = await oldEventRes.json();
  console.log('Old Event by external_message_id:', JSON.stringify(oldEvents, null, 2));

  console.log('\n--- 2. Inspecting Storage Objects ---');
  const newPath = 'wesley_automoveis/whatsapp/5521985198468_s.whatsapp.net/AC27DE76FC1847FA3D427B9C34A95EEB.jpg';
  const oldPath = 'wesley_automoveis/whatsapp/5521985198468_s.whatsapp.net/AC3FB5307AC6ED88A20D0F9D6D519EFD.jpg';

  for (const [label, p] of [['NEW', newPath], ['OLD', oldPath]]) {
    console.log(`\nInspecting ${label} object: ${p}`);
    // Fetch directly using service role
    const getRes = await fetch(`${supabaseUrl}/storage/v1/object/channel-media/${p}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      }
    });
    console.log(`${label} Direct fetch HTTP Status:`, getRes.status);
    console.log(`${label} Content-Type:`, getRes.headers.get('content-type'));
    console.log(`${label} Content-Length:`, getRes.headers.get('content-length'));

    if (getRes.ok) {
      const arrayBuffer = await getRes.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      console.log(`${label} Actual downloaded byte length:`, buf.length);
      console.log(`${label} First 16 bytes (hex):`, buf.subarray(0, 16).toString('hex').match(/../g).join(' '));
      console.log(`${label} First 32 bytes (ascii):`, JSON.stringify(buf.subarray(0, 32).toString('utf8')));
    } else {
      console.log(`${label} Fetch error:`, await getRes.text());
    }
  }

  console.log('\n--- 3. Testing createSignedUrl (via Supabase Storage API) ---');
  for (const [label, p] of [['NEW', newPath], ['OLD', oldPath]]) {
    const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/channel-media/${p}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 })
    });
    console.log(`${label} Sign request HTTP Status:`, signRes.status);
    const signData = await signRes.json();
    console.log(`${label} Sign result has signedURL:`, Boolean(signData?.signedURL));
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
        console.log(`${label} Signed URL First 16 bytes (hex):`, buf.subarray(0, 16).toString('hex').match(/../g).join(' '));
      }
    }
  }

  console.log('\n--- 4. Inspecting tenant_members for wesley_automoveis ---');
  const tenantRes = await fetch(`${supabaseUrl}/rest/v1/tenants?slug=eq.wesley_automoveis&select=id,slug,name,status`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const tenants = await tenantRes.json();
  const tenant = tenants[0];
  console.log('Tenant:', tenant);

  let members = [];
  if (tenant) {
    const membersRes = await fetch(`${supabaseUrl}/rest/v1/tenant_members?tenant_id=eq.${tenant.id}&select=id,user_id,role,status`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    members = await membersRes.json();
    console.log('Tenant members count:', members.length);
    console.log('Tenant members:', members.map(m => ({
      userId: m.user_id,
      role: m.role,
      status: m.status
    })));
  }

  console.log('\n--- 5. Inspecting Storage RLS Policies ---');
  // Check RLS policies if accessible or check public access
  const publicRes = await fetch(`${supabaseUrl}/storage/v1/bucket/channel-media`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const bucketInfo = await publicRes.json();
  console.log('Bucket Info:', {
    id: bucketInfo.id,
    name: bucketInfo.name,
    public: bucketInfo.public,
    file_size_limit: bucketInfo.file_size_limit,
    allowed_mime_types: bucketInfo.allowed_mime_types
  });

  console.log('\n--- 6. Querying Auth Users ---');
  const authUsersRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (authUsersRes.ok) {
    const authData = await authUsersRes.json();
    console.log('Total auth users:', authData.users?.length);
    for (const u of authData.users || []) {
      const isGenesisMember = members.some(m => m.user_id === u.id);
      console.log(`User: ${u.id} | Email: ${u.email} | Genesis Member: ${isGenesisMember}`);
    }
  } else {
    console.log('Failed to fetch auth users:', authUsersRes.status, await authUsersRes.text());
  }

  console.log('\n--- 7. Testing normalizeMedia on event ---');
  // Replicate normalizeMedia logic from dataService.js
  const rawPayload = event?.raw_payload || {};
  const normalized = rawPayload.media || {};
  const mediaDescriptor = {
    kind: normalized.kind || normalized.category,
    category: normalized.category || normalized.kind,
    status: normalized.status || '',
    loadState: normalized.loadState || '',
    bucket: normalized.bucket || '',
    storagePath: normalized.storagePath || '',
    caption: normalized.caption || '',
    url: normalized.url || '',
    thumbnailUrl: normalized.thumbnailUrl || normalized.thumbnail_url || '',
    fileName: normalized.fileName || normalized.file_name || '',
    mimeType: normalized.mimeType || normalized.mime_type || '',
    encoding: normalized.encoding || '',
    size: Number(normalized.size || normalized.file_size || 0),
    duration: Number(normalized.duration || 0),
  };
  console.log('normalizeMedia descriptor:', JSON.stringify(mediaDescriptor, null, 2));
  console.log('\n--- 8. Analyzing Stored Content of NEW Object ---');
  const getNewRes = await fetch(`${supabaseUrl}/storage/v1/object/channel-media/${newPath}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  const newText = await getNewRes.text();
  try {
    const parsed = JSON.parse(newText);
    console.log('Is valid JSON:', true);
    console.log('Parsed type field:', parsed.type);
    console.log('Parsed data array length:', parsed.data?.length);
    console.log('Matches raw_payload.media.size (122127):', parsed.data?.length === 122127);
    const reconstructedBuf = Buffer.from(parsed.data);
    console.log('Reconstructed byte length:', reconstructedBuf.length);
    console.log('Reconstructed first 16 bytes (hex):', reconstructedBuf.subarray(0, 16).toString('hex').match(/../g).join(' '));
    console.log('\n--- 9. Testing Anon Sign Request ---');
    const anonSignRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/channel-media/${newPath}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 })
    });
    console.log('Anon sign status:', anonSignRes.status);
    const anonSignData = await anonSignRes.json();
    console.log('Anon sign response:', anonSignData);

    console.log('\n--- 10. Querying Storage Policies via Service Role ---');
    // Query pg_policies via postgrest if allowed or examine storage tables
    const policiesRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_policies`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    }).catch(() => null);
    if (policiesRes?.ok) {
      console.log('Policies RPC output:', await policiesRes.json());
    } else {
      console.log('get_policies RPC not available (status ' + policiesRes?.status + ')');
    }
  } catch (err) {
    console.log('Failed to parse as JSON:', err.message);
  }
}

run().catch(err => {
  console.error('Error running investigation script:', err);
});


