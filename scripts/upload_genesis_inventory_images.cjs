/**
 * NORIA — Upload e Associação de Fotos do Estoque Gênesis no Supabase Storage
 * Bucket: product-catalog
 * Tenant: 74b57037-9349-4a9e-889c-b65fb63c983a
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment safely from .env without external dotenv package
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = String(process.env.SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_ID = '74b57037-9349-4a9e-889c-b65fb63c983a';
const BUCKET = 'product-catalog';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB limit

// Proposed operational mapping. Names alone are NOT proof of identity. Apply
// requires a reviewed manifest digest including the exact local file hashes.
const MAPPING = [
  {
    localFile: 'CB_600RR.jpeg',
    vehicleId: 'honda|cb 600rr|2007|',
    vehicleSlug: 'honda-cb-600rr-2007',
    commercialName: 'Honda CB 600RR 2007',
    expectedStatus: 'announced'
  },
  {
    localFile: 'CROSSER_2021.jpeg',
    vehicleId: 'yamaha|crosser|2021|preto',
    vehicleSlug: 'yamaha-crosser-2021-preto',
    commercialName: 'Yamaha Crosser 2021 Preto',
    expectedStatus: 'sold'
  },
  {
    localFile: 'CROSSER_2023.jpeg',
    vehicleId: 'yamaha|crosser|2023|',
    vehicleSlug: 'yamaha-crosser-2023',
    commercialName: 'Yamaha Crosser 2023',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Mercedes_C180_2015.jpeg',
    vehicleId: 'mercedes|c180|2015|',
    vehicleSlug: 'mercedes-c180-2015',
    commercialName: 'Mercedes C180 2015',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Nissao_Versao_1.6_2013.jpeg',
    vehicleId: 'nissan|versa sl|2013|prata',
    vehicleSlug: 'nissan-versa-sl-2013-prata',
    commercialName: 'Nissan Versa SL 2013 Prata',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Nova_Tornado_300L_2025.jpeg',
    vehicleId: 'honda|tornado 300l|2025|vermelho',
    vehicleSlug: 'honda-tornado-300l-2025-vermelho',
    commercialName: 'Honda Tornado 300L 2025 Vermelho',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Onix_2020.jpeg',
    vehicleId: 'chevrolet|onix|2020|',
    vehicleSlug: 'chevrolet-onix-2020',
    commercialName: 'Chevrolet Onix 2020',
    expectedStatus: 'announced'
  },
  {
    localFile: 'PCX _2023.jpeg',
    vehicleId: 'honda|pcx|2023|branca',
    vehicleSlug: 'honda-pcx-2023-branca',
    commercialName: 'Honda PCX 2023 Branca',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Sandero_GT_Line_2016.jpeg',
    vehicleId: 'renault|sandero gt line|2016|branco',
    vehicleSlug: 'renault-sandero-gt-line-2016-branco',
    commercialName: 'Renault Sandero GT Line 2016 Branco',
    expectedStatus: 'sold'
  },
  {
    localFile: 'Montana_2013.jpeg',
    vehicleId: 'chevrolet|montana|2013|branca',
    vehicleSlug: 'chevrolet-montana-2013-branca',
    commercialName: 'Chevrolet Montana 2013 Branca',
    expectedStatus: 'announced'
  },
  {
    localFile: 'Toyota_land_PRADO_2005.jpeg',
    vehicleId: 'toyota|land prado|2005|',
    vehicleSlug: 'toyota-land-prado-2005',
    commercialName: 'Toyota Land Prado 2005',
    expectedStatus: 'announced'
  }
];

function getJpegInfo(buffer) {
  let offset = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) break;
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xD9 || marker === 0xDA) break;

    const length = buffer.readUInt16BE(offset);

    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    } else if (marker === 0xE1) {
      const exifHeader = buffer.subarray(offset + 2, offset + 8).toString('ascii');
      if (exifHeader.startsWith('Exif')) {
        const tiffOffset = offset + 8;
        const isLittleEndian = buffer.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
        const readUInt16 = (pos) => isLittleEndian ? buffer.readUInt16LE(pos) : buffer.readUInt16BE(pos);
        const readUInt32 = (pos) => isLittleEndian ? buffer.readUInt32LE(pos) : buffer.readUInt32BE(pos);

        const firstIFDOffset = readUInt32(tiffOffset + 4);
        const ifdPos = tiffOffset + firstIFDOffset;
        if (ifdPos + 2 <= buffer.length) {
          const numEntries = readUInt16(ifdPos);
          for (let i = 0; i < numEntries; i++) {
            const entryPos = ifdPos + 2 + i * 12;
            if (entryPos + 12 > buffer.length) break;
            const tag = readUInt16(entryPos);
            if (tag === 0x0112) {
              orientation = readUInt16(entryPos + 8);
              break;
            }
          }
        }
      }
    }
    offset += length;
  }
  return { width, height, orientation };
}

async function checkStorageObjectExists(storagePath) {
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  const res = await fetch(publicUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return { exists: false, publicUrl };
  if (res.status === 400) {
    const error = await res.json().catch(() => null);
    if (String(error?.statusCode) === '404' && error.code === 'NoSuchKey') return { exists: false, publicUrl };
  }
  if (!res.ok) throw new Error('STORAGE_READ_FAILED:' + res.status);
  const parts = [], reader = res.body.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('STORAGE_OBJECT_TOO_LARGE'); }
    parts.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(parts);
  if (res.headers.get('content-type')?.split(';')[0] !== 'image/jpeg'
    || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('STORAGE_OBJECT_NOT_JPEG');
  return { exists: true, contentLength: size, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), publicUrl };
}

async function registryRequest(method, query, body = null) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + query, {
    method, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('REGISTRY_HTTP_' + response.status);
  return response.status === 204 || response.headers.get('content-length') === '0' ? null : JSON.parse(await response.text() || 'null');
}

function assertSameLink(row, expected) {
  if (!row || ['tenant_id','vehicle_id','storage_bucket','storage_path','public_url','sha256','mime_type','file_size_bytes']
    .some(key => row[key] !== expected[key])) throw new Error('IMAGE_REGISTRY_CONFLICT');
}

async function uploadToStorage(storagePath, buffer, mimeType) {
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': mimeType,
      'x-upsert': 'false' // Do NOT overwrite silently!
    },
    body: buffer,
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    throw new Error('UPLOAD_HTTP_' + res.status);
  }
  return await res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_CONFIG_MISSING');
  const valueOf = flag => args[args.indexOf(flag) + 1];
  const selected = args.includes('--vehicle-id') ? MAPPING.filter(item => item.vehicleId === valueOf('--vehicle-id')) : MAPPING;
  if (!selected.length) throw new Error('MAPPING_VEHICLE_NOT_FOUND');
  const dir = path.resolve(__dirname, '..', 'Estoque_genesis');
  const reviewDigest = crypto.createHash('sha256').update(JSON.stringify({ tenant_id: TENANT_ID,
    items: selected.map(item => ({ ...item, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, item.localFile))).digest('hex') }))
  })).digest('hex');
  if (isApply && (!args.includes('--reviewed-mapping-sha256') || valueOf('--reviewed-mapping-sha256') !== reviewDigest)) {
    throw new Error('REVIEWED_MAPPING_DIGEST_REQUIRED:' + reviewDigest);
  }
  const inventory = await registryRequest('GET', 'genesis_inventory_vehicles?select=vehicle_id,status&tenant_id=eq.' + TENANT_ID + '&limit=200');
  for (const item of selected) {
    if (!inventory?.some(row => row.vehicle_id === item.vehicleId && row.status === item.expectedStatus)) throw new Error('INVENTORY_IDENTITY_OR_STATUS_CHANGED:' + item.vehicleId);
  }
  let registryAvailable = true;
  try { await registryRequest('GET', 'genesis_inventory_vehicle_images?select=id&tenant_id=eq.' + TENANT_ID + '&limit=1'); }
  catch (error) { if (isApply || error.message !== 'REGISTRY_HTTP_404') throw error; registryAvailable = false; }

  console.log(`=== NORIA — Integração de Fotos do Estoque Gênesis ===`);
  console.log(`Modo: ${isApply ? 'APLICAÇÃO EFETIVA (--apply)' : 'SIMULAÇÃO / DRY RUN'}`);
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Diretório local: ${dir}\n`);
  console.log(`Digest do mapeamento e bytes para revisão explícita: ${reviewDigest}`);
  console.log(`Registro de vínculos disponível: ${registryAvailable}`);

  const results = [];

  for (const item of selected) {
    const filePath = path.join(dir, item.localFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo local não encontrado: ${item.localFile}`);
    }

    const buffer = fs.readFileSync(filePath);
    const size = buffer.length;
    if (size > MAX_BYTES) {
      throw new Error(`Arquivo ${item.localFile} excede 10MB (${size} bytes)`);
    }

    // Verify JPEG magic bytes
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      throw new Error(`Arquivo ${item.localFile} não é um JPEG válido`);
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const { width, height, orientation } = getJpegInfo(buffer);
    if (width <= 0 || height <= 0) throw new Error('JPEG_DIMENSIONS_INVALID:' + item.localFile);

    const storagePath = `genesis/${TENANT_ID}/${item.vehicleSlug}/principal.jpg`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

    // Check if object already exists in Storage
    const existing = await checkStorageObjectExists(storagePath);

    let status = 'pending';
    let actionTaken = 'none';

    if (existing.exists) {
      if (existing.contentLength === size && existing.sha256 === sha256) {
        status = 'already_uploaded_identical';
        actionTaken = 'preserved_existing';
      } else {
        throw new Error('STORAGE_HASH_CONFLICT:' + storagePath);
      }
    } else if (isApply) {
      try {
        await uploadToStorage(storagePath, buffer, 'image/jpeg');
        // Validate public URL after upload
        const check = await checkStorageObjectExists(storagePath);
        if (check.exists && check.contentLength === size && check.sha256 === sha256) {
          status = 'uploaded_and_verified';
          actionTaken = 'uploaded';
        } else {
          throw new Error('UPLOAD_VERIFICATION_FAILED');
        }
      } catch (uploadErr) {
        throw uploadErr;
      }
    } else {
      status = 'ready_for_upload';
      actionTaken = 'dry_run_validated';
    }

    if ((registryAvailable && existing.exists) || isApply) {
      const expected = { tenant_id: TENANT_ID, vehicle_id: item.vehicleId, storage_bucket: BUCKET,
        storage_path: storagePath, public_url: publicUrl, sha256, mime_type: 'image/jpeg', file_size_bytes: size };
      const query = 'genesis_inventory_vehicle_images?select=*&tenant_id=eq.' + TENANT_ID + '&storage_path=eq.' + encodeURIComponent(storagePath);
      const links = await registryRequest('GET', query);
      if (links?.length) { if (links.length !== 1) throw new Error('AMBIGUOUS_IMAGE_REGISTRY'); assertSameLink(links[0], expected); }
      else if (isApply) {
        await registryRequest('POST', 'genesis_inventory_vehicle_images?on_conflict=tenant_id,storage_path', {
          ...expected, file_name: item.localFile, width, height, is_primary: true, display_order: 0
        });
        const saved = await registryRequest('GET', query);
        if (saved?.length !== 1) throw new Error('IMAGE_REGISTRY_NOT_CONFIRMED');
        assertSameLink(saved[0], expected);
      }
    }

    results.push({
      localFile: item.localFile,
      vehicleId: item.vehicleId,
      vehicleSlug: item.vehicleSlug,
      commercialName: item.commercialName,
      expectedStatus: item.expectedStatus,
      sizeBytes: size,
      sha256,
      width,
      height,
      orientation,
      storagePath,
      publicUrl,
      status,
      actionTaken
    });

    console.log(`[${status.toUpperCase()}] ${item.localFile} -> ${storagePath}`);
    console.log(`  Dimensões: ${width}x${height} | SHA256: ${sha256.slice(0, 16)}... | Ação: ${actionTaken}`);
  }

  console.log(`\n=== Resumo do Processamento ===`);
  console.log(`Total de fotos analisadas: ${results.length}`);
  console.log(`Prontas/Upload efetuado: ${results.filter(r => ['uploaded_and_verified', 'already_uploaded_identical', 'ready_for_upload'].includes(r.status)).length}`);
  console.log(`Conflitos/Erros: ${results.filter(r => ['conflict_size_mismatch', 'upload_error', 'upload_verification_failed'].includes(r.status)).length}`);

  // Save report to scratch
  const reportPath = path.resolve(__dirname, '..', 'scratch', 'upload_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Relatório detalhado salvo em: ${reportPath}`);
}

if (require.main === module) main().catch(err => {
  console.error('Falha na execução:', err);
  process.exit(1);
});
module.exports = { MAPPING, checkStorageObjectExists, assertSameLink, getJpegInfo };
