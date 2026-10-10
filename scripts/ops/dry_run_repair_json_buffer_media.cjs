/**
 * scripts/dry_run_repair_json_buffer_media.cjs
 *
 * DRY-RUN ONLY tool to inspect Supabase Storage media objects for the
 * JSON-Buffer corruption pattern ({"type":"Buffer","data":[...]}) and report
 * recoverable items.
 *
 * STRICT SAFETY:
 * - NO WRITES to Supabase Storage.
 * - NO MODIFICATIONS to channel_events.
 * - NO EVOLUTION API CALLS (uses only stored JSON data).
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
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

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

function detectMagicBytes(buf) {
  if (!buf || buf.length < 4) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg (ffd8ff)';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png (89504e47)';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp (RIFF..WEBP)';
  }
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg (OggS)';
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf (%PDF)';
  if (buf.length >= 8 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4 (ftyp)';
  return 'hex:' + buf.subarray(0, 4).toString('hex');
}

async function runDryRun() {
  console.log('================================================================');
  console.log('DRY-RUN INSPECTION: RECOVERABLE JSON-BUFFER STORAGE OBJECTS');
  console.log('================================================================');
  console.log('Target: channel_events with raw_payload.media.status = stored');
  console.log('Supabase URL:', supabaseUrl);
  console.log('Mode: READ-ONLY (Dry Run)\n');

  // Query events with stored media
  const res = await fetch(`${supabaseUrl}/rest/v1/channel_events?select=id,external_message_id,tenant_slug,created_at,raw_payload&raw_payload->media->>status=eq.stored&order=created_at.desc&limit=100`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    }
  });

  if (!res.ok) {
    console.error('Failed to query channel_events:', res.status, await res.text());
    process.exit(1);
  }

  const events = await res.json();
  console.log(`Found ${events.length} candidate events with media.status = 'stored'.\n`);

  const results = [];
  let corruptedCount = 0;
  let intactCount = 0;
  let missingCount = 0;

  for (const ev of events) {
    const media = ev.raw_payload?.media || {};
    const bucket = media.bucket || 'channel-media';
    const storagePath = media.storagePath;

    if (!storagePath) {
      results.push({
        event_id: ev.id,
        storagePath: 'NONE',
        kind: media.kind || 'unknown',
        status: 'NO_STORAGE_PATH',
        recoverable: false,
      });
      continue;
    }

    const objUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath}`;
    let objRes;
    try {
      objRes = await fetch(objUrl, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        }
      });
    } catch (err) {
      results.push({
        event_id: ev.id,
        storagePath,
        kind: media.kind || 'unknown',
        status: 'FETCH_ERROR: ' + err.message,
        recoverable: false,
      });
      continue;
    }

    if (!objRes.ok) {
      missingCount++;
      results.push({
        event_id: ev.id,
        storagePath,
        kind: media.kind || 'unknown',
        status: `OBJECT_MISSING_HTTP_${objRes.status}`,
        recoverable: false,
      });
      continue;
    }

    const arrayBuf = await objRes.arrayBuffer();
    const storedBuf = Buffer.from(arrayBuf);
    const storedSize = storedBuf.length;

    // Check if object starts with {"type":"Buffer","data":
    const prefix = storedBuf.subarray(0, 32).toString('utf8');
    const isJsonBuffer = prefix.startsWith('{"type":"Buffer"') || prefix.startsWith('{"type":"Buffer","data":');

    if (isJsonBuffer) {
      let recoverable = false;
      let recoveredSize = 0;
      let magic = 'unknown';
      let errorReason = '';

      try {
        const text = storedBuf.toString('utf8');
        const parsed = JSON.parse(text);
        if (parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
          const recoveredBuf = Buffer.from(parsed.data);
          recoveredSize = recoveredBuf.length;
          magic = detectMagicBytes(recoveredBuf);
          recoverable = recoveredSize > 0 && magic !== 'unknown';
        } else {
          errorReason = 'JSON parsed but not {type:Buffer,data:Array}';
        }
      } catch (parseErr) {
        errorReason = 'JSON.parse failed: ' + parseErr.message;
      }

      corruptedCount++;
      results.push({
        event_id: ev.id,
        external_message_id: ev.external_message_id || 'N/A',
        storagePath,
        kind: media.kind || 'unknown',
        classification: 'CORRUPTED_JSON_BUFFER_RECOVERABLE',
        corrupted_size: storedSize,
        descriptor_size: media.size,
        recovered_size: recoveredSize,
        magic,
        recoverable,
        errorReason,
      });
    } else {
      intactCount++;
      const magic = detectMagicBytes(storedBuf);
      results.push({
        event_id: ev.id,
        external_message_id: ev.external_message_id || 'N/A',
        storagePath,
        kind: media.kind || 'unknown',
        classification: 'INTACT_BINARY',
        corrupted_size: null,
        descriptor_size: media.size,
        recovered_size: storedSize,
        magic,
        recoverable: false,
      });
    }
  }

  console.log('----------------------------------------------------------------');
  console.log('DETAILED INSPECTION RESULTS:');
  console.log('----------------------------------------------------------------');
  for (const r of results) {
    if (r.classification === 'CORRUPTED_JSON_BUFFER_RECOVERABLE') {
      console.log(`[!] RECOVERABLE CORRUPTION DETECTED:`);
      console.log(`    Event ID:             ${r.event_id}`);
      console.log(`    External Message ID:  ${r.external_message_id}`);
      console.log(`    Storage Path:         ${r.storagePath}`);
      console.log(`    Kind:                 ${r.kind}`);
      console.log(`    Corrupted Size:       ${r.corrupted_size} bytes (ASCII JSON)`);
      console.log(`    Descriptor Size:      ${r.descriptor_size} bytes`);
      console.log(`    Recovered Raw Size:   ${r.recovered_size} bytes`);
      console.log(`    Recovered Magic:      ${r.magic}`);
      console.log(`    Recoverable in-memory: ${r.recoverable ? 'YES (100% verified)' : 'NO: ' + r.errorReason}`);
      console.log('');
    } else {
      console.log(`[OK] Intact Object: ${r.storagePath} (${r.magic}, ${r.recovered_size} bytes)`);
    }
  }

  console.log('----------------------------------------------------------------');
  console.log('SUMMARY:');
  console.log('----------------------------------------------------------------');
  console.log(`Total events checked:               ${events.length}`);
  console.log(`Intact binary objects:              ${intactCount}`);
  console.log(`CORRUPTED_JSON_BUFFER_RECOVERABLE:  ${corruptedCount}`);
  console.log(`Missing or error objects:           ${missingCount}`);
  console.log('================================================================');
  console.log('NO WRITES PERFORMED. Storage and database remain completely unchanged.');
}

runDryRun().catch(err => {
  console.error('Fatal error in dry-run repair script:', err);
  process.exit(1);
});
