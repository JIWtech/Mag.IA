/**
 * scripts/dry_run_media_backfill.cjs
 *
 * READ-ONLY Diagnostic / Dry-Run Script for WhatsApp Media Backfill.
 *
 * CONSTRAINTS:
 * - NEVER writes to Supabase Storage.
 * - NEVER executes PATCH/POST on channel_events.
 * - Deterministically paginates ALL channel_events in the time window (no truncation at 500).
 * - Tests Evolution recovery if reachable.
 * - Strict classification into distinct states:
 *   - ALREADY_STORED: Already has valid raw_payload.media with storagePath in bucket
 *   - RECOVERABLE: Evolution returned valid media
 *   - UNAVAILABLE: Evolution conclusively confirmed message/media does not exist or expired (404/400/empty)
 *   - PENDING_CONNECTIVITY: Evolution cannot be reached from execution environment (fetch failed, timeout, ECONNREFUSED)
 *   - ERROR: Unexpected server response (e.g. 500, unhandled exception)
 */

const fs = require('fs');
const path = require('path');

// 1. Load environment variables from .env
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
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_TENANT = process.env.TENANT_SLUG || 'wesley_automoveis';
const SINCE_DATE = process.env.SINCE_DATE || '2026-10-03T15:38:00.000Z';

function tenantEnvSuffix(slug) {
  return String(slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

async function fetchSupabase(pathname) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET ${pathname} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function detectMediaKind(event) {
  const text = String(event.message_text || '').trim();
  const textKind = text.match(/^\[(audio|image|video|document|sticker|album)\]/i)?.[1];
  if (textKind) {
    return textKind.toLowerCase() === 'album' ? 'image' : textKind.toLowerCase();
  }

  const raw = event.raw_payload || {};
  if (raw.source_media?.kind) return String(raw.source_media.kind).toLowerCase();
  if (raw.sales_media_type) return String(raw.sales_media_type).toLowerCase();
  if (['image', 'audio', 'video', 'document', 'sticker'].includes(raw.content_type)) return raw.content_type;
  if (Array.isArray(raw.sales_media) && raw.sales_media.length > 0) return 'image';

  const msg = raw.data?.message || raw.message || {};
  if (msg.imageMessage) return 'image';
  if (msg.audioMessage) return 'audio';
  if (msg.videoMessage) return 'video';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';

  return null;
}

async function testEvolutionRecovery({ evoUrl, evoKey, instance, messageId, remoteJid }) {
  if (!evoUrl || !evoKey) {
    return { status: 'PENDING_CONNECTIVITY', error: 'Evolution credentials missing' };
  }

  const url = `${evoUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`;
  const body = {
    message: {
      key: {
        id: messageId,
        remoteJid: remoteJid,
        fromMe: false,
      },
    },
    convertToMp4: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: evoKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 404) {
      return { status: 'UNAVAILABLE', error: 'HTTP 404: Media/message expired or not found on provider' };
    }
    if (res.status === 400) {
      const errBody = await res.json().catch(() => ({}));
      return { status: 'UNAVAILABLE', error: `HTTP 400: ${JSON.stringify(errBody).slice(0, 100)}` };
    }
    if (!res.ok) {
      return { status: 'ERROR', error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const base64 = String(data?.base64 || '').replace(/^data:[^,]+;base64,/, '');
    if (base64 && base64.length > 32) {
      return { status: 'RECOVERABLE', bytes: Math.round((base64.length * 3) / 4), mime: data.mimetype };
    }
    if (data?.error || !base64) {
      return { status: 'UNAVAILABLE', error: data?.error || 'Provider returned empty base64' };
    }
    return { status: 'UNAVAILABLE', error: 'empty_media' };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = String(err?.message || err);
    if (err.name === 'AbortError' || /fetch failed|econnrefused|enotfound|etimedout|timeout|network/i.test(msg)) {
      return { status: 'PENDING_CONNECTIVITY', error: `Cannot reach Evolution (${msg})` };
    }
    return { status: 'ERROR', error: msg };
  }
}

async function main() {
  console.log('====================================================');
  console.log('MAG.IA WHATSAPP MEDIA BACKFILL — DRY-RUN DIAGNOSTIC');
  console.log('====================================================');
  console.log(`Tenant Slug : ${DEFAULT_TENANT}`);
  console.log(`Since Date  : ${SINCE_DATE}`);
  console.log(`Supabase URL: ${SUPABASE_URL ? SUPABASE_URL.slice(0, 25) + '...' : '(none)'}`);
  console.log('Mode        : READ-ONLY (No storage writes, no DB patches)');
  console.log('----------------------------------------------------');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env');
    process.exit(1);
  }

  const suffix = tenantEnvSuffix(DEFAULT_TENANT);
  const evoUrl = env[`EVOLUTION_API_URL_${suffix}`] || env.EVOLUTION_SERVER_URL || env.EVOLUTION_API_URL || '';
  const evoKey = env[`EVOLUTION_API_KEY_${suffix}`] || env.EVOLUTION_API_KEY || '';
  const evoInstance = env[`EVOLUTION_INSTANCE_${suffix}`] || env.EVOLUTION_INSTANCE || 'wesley-carros';

  console.log(`Evolution Instance: ${evoInstance}`);
  console.log(`Evolution URL     : ${evoUrl ? evoUrl.slice(0, 25) + '...' : '(none)'}`);
  console.log('\nFetching ALL inbound events with deterministic pagination...');

  // 2. Deterministic pagination across ALL events
  const PAGE_SIZE = 500;
  let offset = 0;
  const allEvents = [];

  while (true) {
    const query = `/rest/v1/channel_events?tenant_slug=eq.${encodeURIComponent(DEFAULT_TENANT)}`
      + `&channel_type=eq.whatsapp`
      + `&direction=eq.inbound`
      + `&created_at=gte.${encodeURIComponent(SINCE_DATE)}`
      + `&order=created_at.asc,id.asc`
      + `&limit=${PAGE_SIZE}`
      + `&offset=${offset}`;

    const batch = await fetchSupabase(query);
    if (!Array.isArray(batch) || batch.length === 0) break;
    allEvents.push(...batch);
    offset += batch.length;
    console.log(`  Fetched batch of ${batch.length} events (total scanned so far: ${allEvents.length})`);
    if (batch.length < PAGE_SIZE) break;
  }

  console.log(`\nTotal inbound events scanned: ${allEvents.length}`);

  // 3. Filter media candidates
  const candidates = [];
  for (const ev of allEvents) {
    const kind = detectMediaKind(ev);
    if (kind) {
      candidates.push({
        event: ev,
        kind,
      });
    }
  }

  console.log(`Media candidates detected   : ${candidates.length}`);
  console.log('----------------------------------------------------');

  const summary = {
    total_scanned: allEvents.length,
    total_candidates: candidates.length,
    already_stored: 0,
    recoverable: 0,
    unavailable: 0,
    pending_connectivity: 0,
    error: 0,
    byKind: {},
    items: [],
  };

  // Check connectivity once upfront if candidates exist
  let connectivityTested = false;
  let globalConnectivityFailed = false;

  for (const c of candidates) {
    summary.byKind[c.kind] = (summary.byKind[c.kind] || 0) + 1;
    const ev = c.event;
    const existingMedia = ev.raw_payload?.media;

    if (existingMedia?.status === 'stored' && existingMedia?.storagePath) {
      summary.already_stored++;
      summary.items.push({
        id: ev.id,
        created_at: ev.created_at,
        external_message_id: ev.external_message_id,
        remoteJid: ev.external_conversation_id,
        kind: c.kind,
        status: 'ALREADY_STORED',
        storagePath: existingMedia.storagePath,
      });
      continue;
    }

    if (!evoUrl || !evoKey) {
      summary.pending_connectivity++;
      summary.items.push({
        id: ev.id,
        created_at: ev.created_at,
        external_message_id: ev.external_message_id,
        remoteJid: ev.external_conversation_id,
        kind: c.kind,
        status: 'PENDING_CONNECTIVITY',
        error: 'Evolution credentials missing',
      });
      continue;
    }

    if (globalConnectivityFailed) {
      summary.pending_connectivity++;
      summary.items.push({
        id: ev.id,
        created_at: ev.created_at,
        external_message_id: ev.external_message_id,
        remoteJid: ev.external_conversation_id,
        kind: c.kind,
        status: 'PENDING_CONNECTIVITY',
        error: 'Evolution unreachable from local environment',
      });
      continue;
    }

    // Test Evolution recovery
    const recovery = await testEvolutionRecovery({
      evoUrl,
      evoKey,
      instance: evoInstance,
      messageId: ev.external_message_id,
      remoteJid: ev.external_conversation_id,
    });

    if (recovery.status === 'PENDING_CONNECTIVITY' && !connectivityTested) {
      console.log('Notice: Evolution endpoint unreachable from current environment. Marking remaining unverified candidates as PENDING_CONNECTIVITY.');
      globalConnectivityFailed = true;
      connectivityTested = true;
    }

    if (recovery.status === 'ALREADY_STORED') summary.already_stored++;
    else if (recovery.status === 'RECOVERABLE') summary.recoverable++;
    else if (recovery.status === 'UNAVAILABLE') summary.unavailable++;
    else if (recovery.status === 'PENDING_CONNECTIVITY') summary.pending_connectivity++;
    else summary.error++;

    summary.items.push({
      id: ev.id,
      created_at: ev.created_at,
      external_message_id: ev.external_message_id,
      remoteJid: ev.external_conversation_id,
      kind: c.kind,
      status: recovery.status,
      bytes: recovery.bytes,
      mime: recovery.mime,
      error: recovery.error,
    });

    // Gentle pacing
    if (!globalConnectivityFailed) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  console.log('\n====================================================');
  console.log('DRY-RUN DIAGNOSTIC SUMMARY REPORT');
  console.log('====================================================');
  console.log(`total_scanned       : ${summary.total_scanned}`);
  console.log(`total_candidates    : ${summary.total_candidates}`);
  console.log(`already_stored      : ${summary.already_stored}`);
  console.log(`recoverable         : ${summary.recoverable}`);
  console.log(`unavailable         : ${summary.unavailable}`);
  console.log(`pending_connectivity: ${summary.pending_connectivity}`);
  console.log(`error               : ${summary.error}`);
  console.log('----------------------------------------------------');
  console.log('\nBreakdown by Media Kind:');
  for (const [k, count] of Object.entries(summary.byKind)) {
    console.log(`  - ${k.padEnd(12)}: ${count}`);
  }

  if (summary.items.length > 0) {
    console.log('\nSample Candidates (first 10):');
    for (const item of summary.items.slice(0, 10)) {
      console.log(`  [${item.status.padEnd(20)}] ${item.created_at} | ev=${item.id.slice(0, 8)} | kind=${item.kind} | msg=${item.external_message_id} | ${item.error || (item.bytes ? item.bytes + 'B' : '')}`);
    }
  }

  // Write JSON report to archive scratch directory
  const reportPath = path.resolve(__dirname, '../../archive/scratch/reports/media_backfill_dry_run_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\nDetailed dry-run JSON report written to: archive/scratch/reports/media_backfill_dry_run_report.json`);
}

main().catch((err) => {
  console.error('Fatal dry-run error:', err);
  process.exit(1);
});
