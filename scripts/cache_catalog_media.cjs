// Copies the configured Wikimedia demo catalog to controlled public Storage.
// Dry run by default. Never uploads conversation attachments or changes prompts.
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
const tenant = args.find(arg => arg.startsWith('--tenant='))?.slice(9);
const apply = args.includes('--apply');
const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = 'product-catalog';
const maxBytes = 10 * 1024 * 1024;
const headers = { apikey: key, Authorization: 'Bearer ' + key };

async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options,
    headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Supabase HTTP ' + response.status + ' on ' + path.split('?')[0]);
  return response;
}

async function download(source, attempt = 0) {
  let target = new URL(source);
  for (let redirect = 0; redirect < 6; redirect++) {
    if (target.protocol !== 'https:' || !['commons.wikimedia.org', 'upload.wikimedia.org'].includes(target.hostname)) {
      throw new Error('Unsupported source host: ' + target.hostname);
    }
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'MagIA-CatalogImport/1.0 (https://www.noriasync.com.br/)' } });
    if (response.status === 429 && attempt < 2) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)
        : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : 15 * (attempt + 1);
      await response.body?.cancel();
      if (!Number.isFinite(seconds) || seconds > 90) throw new Error('Image rate limited; retry later');
      console.log('Rate limited; waiting ' + Math.max(1, seconds) + ' seconds');
      await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000));
      return download(source, attempt + 1);
    }
    if ([301,302,303,307,308].includes(response.status)) {
      target = new URL(response.headers.get('location'), target);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error('Image HTTP ' + response.status + ': ' + source);
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!['image/jpeg','image/png','image/webp'].includes(mime)) throw new Error('Invalid image type: ' + mime);
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error('Image exceeds 10 MiB');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Image exceeds 10 MiB');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const magic = bytes.subarray(0,12);
    if (!(mime === 'image/jpeg' && magic[0] === 255 && magic[1] === 216)
      && !(mime === 'image/png' && magic.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      && !(mime === 'image/webp' && magic.toString('ascii',0,4) === 'RIFF' && magic.toString('ascii',8,12) === 'WEBP')) {
      throw new Error('Invalid image signature');
    }
    return { bytes, mime, size };
  }
  throw new Error('Too many image redirects');
}

async function main() {
  if (!tenant || !base || !key) throw new Error('Use --tenant=slug with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const tenants = await (await api('/rest/v1/tenants?select=id&slug=eq.' + encodeURIComponent(tenant))).json();
  if (tenants.length !== 1) throw new Error('Tenant not found or ambiguous');
  const id = tenants[0].id;
  const path = '/rest/v1/tenant_settings?tenant_id=eq.' + id;
  const rows = await (await api(path + '&select=settings,updated_at')).json();
  if (rows.length !== 1) throw new Error('Expected one tenant settings row');
  const original = rows[0];
  const settings = structuredClone(original.settings);
  if (!Array.isArray(settings.product_media_catalog)) throw new Error('Expected product_media_catalog array');
  const files = [];
  for (const category of settings.product_media_catalog) {
    for (const item of category.items || []) {
      if (String(item.url).startsWith(base + '/storage/v1/object/public/' + bucket + '/' + id + '/')) continue;
      const image = await download(item.url);
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mime];
      const object = id + '/' + createHash('sha256').update(image.bytes).digest('hex') + '.' + extension;
      files.push({ item, object, ...image });
      console.log(JSON.stringify({ category: category.category_key, file: item.file_name, bytes: image.size, status: 'downloaded' }));
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  if (!apply || !files.length) {
    console.log(JSON.stringify({ mode: apply ? 'already_cached' : 'dry_run', images: files.length, bytes: files.reduce((n,f) => n + f.size,0) }));
    return;
  }
  const buckets = await (await api('/storage/v1/bucket')).json();
  const existing = buckets.find(b => b.id === bucket);
  if (existing && !existing.public) throw new Error('Existing bucket is private; refusing to change its visibility');
  if (!existing) await api('/storage/v1/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: maxBytes, allowed_mime_types: ['image/jpeg','image/png','image/webp'] }) });
  for (const file of files) {
    await api('/storage/v1/object/' + bucket + '/' + file.object, { method: 'POST',
      headers: { 'Content-Type': file.mime, 'x-upsert': 'true', 'cache-control': '31536000' }, body: file.bytes });
    const publicUrl = base + '/storage/v1/object/public/' + bucket + '/' + file.object;
    const check = await fetch(publicUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    if (!check.ok || !check.headers.get('content-type')?.startsWith('image/')) throw new Error('Storage image not accessible');
    file.item.source_url = file.item.source_url || file.item.url;
    file.item.url = publicUrl;
    file.item.storage_bucket = bucket;
    file.item.storage_path = file.object;
  }
  // Refuse to overwrite a concurrent tenant configuration edit.
  if (!original.updated_at) throw new Error('Missing updated_at for optimistic concurrency check');
  const updated = await (await api(path + '&updated_at=eq.' + encodeURIComponent(original.updated_at), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ settings }),
  })).json();
  if (updated.length !== 1) throw new Error('Settings changed concurrently; uploaded files retained, catalog not overwritten');
  console.log(JSON.stringify({ mode: 'applied', tenant, bucket, images: files.length, bytes: files.reduce((n,f) => n + f.size,0) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
