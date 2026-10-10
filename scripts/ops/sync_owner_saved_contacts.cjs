#!/usr/bin/env node
/**
 * scripts/sync_owner_saved_contacts.cjs
 *
 * Safe baseline & synchronization tool for Wesley's owner-saved WhatsApp contacts.
 *
 * Rules:
 * 1. Default mode is DRY-RUN (--dry-run). Never mutates database unless --execute is passed.
 * 2. Cross-references public.contacts against tenant_ai_excluded_contacts and/or Evolution contacts.
 * 3. Persists canonical metadata in public.contacts.metadata:
 *    {
 *      "whatsapp_owner_saved": true,
 *      "whatsapp_owner_saved_source": "<source>",
 *      "whatsapp_owner_saved_at": "<timestamp>"
 *    }
 * 4. Preserves commercial leads (leaves metadata unmodified).
 */

const fs = require('node:fs');
const path = require('node:path');

// Load environment variables from .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment.');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function http(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function getTenant(slug) {
  const tenants = await http(`${supabaseUrl}/rest/v1/tenants?select=id,name,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!tenants.length) throw new Error(`Tenant '${slug}' not found.`);
  return tenants[0];
}

async function getAllExcludedContacts(tenantId) {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const batch = await http(
      `${supabaseUrl}/rest/v1/tenant_ai_excluded_contacts?tenant_id=eq.${tenantId}&limit=${limit}&offset=${offset}`
    );
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function getAllContacts(tenantId) {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const batch = await http(
      `${supabaseUrl}/rest/v1/contacts?tenant_id=eq.${tenantId}&limit=${limit}&offset=${offset}&order=created_at.asc,id.asc`
    );
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function run() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const tenantSlug = args.find((a, i) => args[i - 1] === '--tenant') || 'wesley_automoveis';

  console.log('='.repeat(70));
  console.log(`SYNC OWNER SAVED CONTACTS — ${isExecute ? 'LIVE EXECUTION' : 'DRY RUN (AUDIT ONLY)'}`);
  console.log('='.repeat(70));
  console.log(`Tenant: ${tenantSlug}`);
  console.log(`Mode:   ${isExecute ? 'MUTATING DATABASE' : 'READ-ONLY (NO CHANGES WILL BE WRITTEN)'}`);
  console.log('-'.repeat(70));

  const tenant = await getTenant(tenantSlug);
  console.log(`Tenant ID: ${tenant.id} (${tenant.name})`);

  console.log('Fetching excluded phonebook contacts from tenant_ai_excluded_contacts...');
  const excludedRows = await getAllExcludedContacts(tenant.id);
  console.log(`Found ${excludedRows.length} excluded contact numbers.`);

  const excludedMap = new Map();
  for (const row of excludedRows) {
    const raw = String(row.phone || '').replace(/\D/g, '');
    if (!raw) continue;
    const local = raw.replace(/^55/, '');
    excludedMap.set(raw, row.source || 'tenant_ai_excluded_contacts');
    excludedMap.set(local, row.source || 'tenant_ai_excluded_contacts');
    excludedMap.set(`55${local}`, row.source || 'tenant_ai_excluded_contacts');
  }

  console.log('Fetching public.contacts...');
  const contacts = await getAllContacts(tenant.id);
  console.log(`Found ${contacts.length} total contacts in public.contacts.`);

  let alreadyMarkedCount = 0;
  let toMarkCount = 0;
  let commercialLeadsCount = 0;
  const toMarkList = [];

  for (const contact of contacts) {
    const metadata = contact.metadata && typeof contact.metadata === 'object' ? contact.metadata : {};
    const rawDigits = String(contact.phone || contact.external_handle || '').replace(/\D/g, '');
    const local = rawDigits.replace(/^55/, '');

    const isMatch = excludedMap.has(rawDigits) || excludedMap.has(local) || excludedMap.has(`55${local}`);
    const source = excludedMap.get(rawDigits) || excludedMap.get(local) || excludedMap.get(`55${local}`);

    if (metadata.whatsapp_owner_saved === true) {
      alreadyMarkedCount++;
    } else if (isMatch) {
      toMarkCount++;
      toMarkList.push({ contact, source });
    } else {
      commercialLeadsCount++;
    }
  }

  console.log('\nAudit Results:');
  console.log(`- Total contacts in public.contacts:        ${contacts.length}`);
  console.log(`- Already marked (whatsapp_owner_saved):    ${alreadyMarkedCount}`);
  console.log(`- Matches found to mark as owner-saved:     ${toMarkCount}`);
  console.log(`- Commercial leads preserved (unmarked):    ${commercialLeadsCount}`);

  if (toMarkList.length > 0) {
    console.log('\nContacts identified as Wesley owner-saved:');
    for (const { contact, source } of toMarkList) {
      console.log(`  - [${contact.id}] ${contact.name || '(sem nome)'} | ${contact.phone || contact.external_handle} (source: ${source})`);
    }
  }

  if (isExecute && toMarkList.length > 0) {
    console.log(`\nExecuting database updates for ${toMarkList.length} contacts...`);
    const now = new Date().toISOString();
    let updatedCount = 0;
    for (const { contact, source } of toMarkList) {
      const existingMeta = contact.metadata && typeof contact.metadata === 'object' ? contact.metadata : {};
      const updatedMeta = {
        ...existingMeta,
        whatsapp_owner_saved: true,
        whatsapp_owner_saved_source: source,
        whatsapp_owner_saved_at: now,
      };
      await http(`${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenant.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ metadata: updatedMeta }),
      });
      updatedCount++;
    }
    console.log(`Successfully updated ${updatedCount} contacts.`);
  } else if (!isExecute && toMarkList.length > 0) {
    console.log(`\nDRY RUN: 0 database modifications made. Pass --execute to apply updates.`);
  }

  console.log('='.repeat(70));
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
