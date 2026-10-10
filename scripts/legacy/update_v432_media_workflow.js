const fs = require('fs');
const path = require('path');

const workflowPath = path.join(
  __dirname,
  '../..',
  'n8n',
  'workflows',
  'magia_telegram_multitenant_v4_3_2_media_context_hidden.json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = workflow.nodes.find((item) => item.name === 'Processar Tenant e Responder' && item.parameters?.jsCode);
if (!node) throw new Error('Nó "Processar Tenant e Responder" não encontrado.');

const helpers = String.raw`

function storageExtension(media = {}) {
  const fromName = String(media.fileName || '').match(/\.([a-z0-9]{1,10})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const byMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
  return byMime[media.mimeType] || 'bin';
}

async function persistTelegramMedia(context, media, externalMessageId) {
  if (!media?.fileId) return null;

  const base = {
    kind: media.category || 'document',
    originalKind: media.kind || '',
    caption: originalTextOrCaption || '',
    fileName: media.fileName || '',
    mimeType: media.mimeType || 'application/octet-stream',
    size: Number(media.fileSize || 0),
    duration: Number(media.duration || 0),
    width: Number(media.width || 0) || null,
    height: Number(media.height || 0) || null,
    source: 'telegram',
  };
  const bucket = env('TELEGRAM_MEDIA_BUCKET', 'channel-media');

  try {
    const downloaded = await downloadTelegramMedia(context, media);
    const path = [tenantSlug, 'telegram', String(chatId), String(externalMessageId) + '.' + storageExtension(base)]
      .map((part) => encodeURIComponent(part))
      .join('/');
    await helpers.httpRequest({
      method: 'POST',
      url: supabaseUrl('/storage/v1/object/' + encodeURIComponent(bucket) + '/' + path),
      headers: {
        apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
        'Content-Type': base.mimeType,
        'x-upsert': 'true',
      },
      body: Buffer.from(downloaded.base64, 'base64'),
      json: false,
      timeout: 45000,
    });
    return { ...base, bucket, storagePath: path, size: downloaded.bytes, status: 'stored' };
  } catch (error) {
    return {
      ...base,
      status: 'storage_error',
      error: String(error?.message || error).slice(0, 180),
      errorCode: error?.code || 'media_storage_error',
    };
  }
}
`;

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index === -1) throw new Error(`Âncora não encontrada: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

let code = node.parameters.jsCode;
if (code.includes('async function persistTelegramMedia(context, media, externalMessageId)')) {
  console.log('Workflow já contém a persistência de mídia. Nenhuma alteração feita.');
  process.exit(0);
}

code = replaceOnce(
  code,
  '\nfunction encodeFilter(value) {',
  helpers + '\nfunction encodeFilter(value) {',
  'helpers antes de encodeFilter',
);

code = replaceOnce(
  code,
  '  const classification = classify(context);\n',
  '  const storedMedia = media ? await persistTelegramMedia(context, media, externalMessageId) : null;\n\n  const classification = classify(context);\n',
  'persistência antes da classificação',
);

code = replaceOnce(
  code,
  '        telegram_update: update,\n        human_lock_source:',
  '        telegram_update: update,\n        ...(storedMedia ? { media: storedMedia } : {}),\n        human_lock_source:',
  'payload do evento bloqueado',
);

const finalPayload = '      telegram_update: update,\n\n      // Separação intencional:';
code = replaceOnce(
  code,
  finalPayload,
  '      telegram_update: update,\n      ...(storedMedia ? { media: storedMedia } : {}),\n\n      // Separação intencional:',
  'payload final',
);

node.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`Updated ${workflowPath}`);
