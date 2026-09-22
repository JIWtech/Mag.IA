const base = $('Preparar Resposta JIW').item.json;
const sent = $json;
function env(name, fallback = '') {
  try { return $env[name] || fallback; } catch (error) { return fallback; }
}
function cleanEnvUrl(value) {
  const raw = String(value || '').trim();
  const markdown = raw.match(/\((https?:\/\/[^)]+)\)/);
  if (markdown) return markdown[1].replace(/\/$/, '');
  const plain = raw.match(/https?:\/\/[^\]\s)]+/);
  return (plain ? plain[0] : raw).replace(/\/$/, '');
}
function isInvalidEnv(value) {
  const raw = String(value || '').trim();
  return !raw || raw.includes('COLE_AQUI') || raw.includes('SEU_TOKEN') || raw.includes('AJUSTAR');
}
function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
async function sendProductMedia() {
  const mediaItems = Array.isArray(base.product_media_matches) ? base.product_media_matches.slice(0, 3) : [];
  if (!mediaItems.length) return { sent: [], skipped: 'no_product_media', diagnostics: base.catalog_diagnostics || null };

  const slugKey = normalizeKey(base.tenant_slug);
  const baseUrl = cleanEnvUrl(env('EVOLUTION_API_URL_' + slugKey, env('EVOLUTION_API_URL', '')));
  const apiKey = env('EVOLUTION_API_KEY_' + slugKey, env('EVOLUTION_API_KEY', ''));
  const instance = base.instance || env('EVOLUTION_INSTANCE_' + slugKey, env('EVOLUTION_INSTANCE', ''));
  if (isInvalidEnv(baseUrl) || isInvalidEnv(apiKey) || isInvalidEnv(instance)) {
    return { sent: [], skipped: 'missing_or_placeholder_evolution_media_env', required_env: ['EVOLUTION_API_URL_' + slugKey, 'EVOLUTION_API_KEY_' + slugKey, 'EVOLUTION_INSTANCE_' + slugKey] };
  }

  const number = String(base.phone || base.remoteJid || '').replace(/@.*/, '');
  if (!number) return { sent: [], skipped: 'missing_recipient_number' };

  const results = [];
  for (const item of mediaItems) {
    try {
      const response = await this.helpers.httpRequest({
        method: 'POST',
        url: baseUrl + '/message/sendMedia/' + encodeURIComponent(instance),
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: {
          number,
          mediatype: 'image',
          mimetype: item.mimetype || 'image/jpeg',
          caption: item.caption || item.title || item.category_label || '',
          media: item.url,
          fileName: item.file_name || 'produto.jpg',
        },
        json: true,
        timeout: 15000,
      });
      const messageId = response?.key?.id || response?.data?.key?.id || response?.message?.key?.id;
      results.push({ ok: Boolean(messageId), status: messageId ? 'accepted' : 'unconfirmed', title: item.title || '', url: item.url, message_id: messageId || null });
    } catch (error) {
      const status = Number(error?.statusCode || error?.response?.status || error?.httpCode || 0) || null;
      results.push({ ok: false, status: 'failed', title: item.title || '', url: item.url, http_status: status, error: status ? 'evolution_http_' + status : 'evolution_request_failed' });
    }
  }
  return { sent: results };
}
const mediaDelivery = await sendProductMedia.call(this);
const externalMessageId = String(sent?.key?.id || sent?.message?.key?.id || sent?.id || base.messageId + ':reply');
return { json: { ...base, externalMessageId, direction: 'outbound', sender_type: 'assistant', messageText: base.responseText, delivery_status: 'sent', raw_payload: { provider: 'evolution_api', response: sent, product_media_delivery: mediaDelivery, product_media_matches: base.product_media_matches || [], catalog_diagnostics: base.catalog_diagnostics || null } } };
