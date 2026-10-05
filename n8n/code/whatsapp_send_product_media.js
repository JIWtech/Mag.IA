const base = $json;
function env(name, fallback = '') {
  try { return String($env[name] || fallback).trim(); } catch (_) { return fallback; }
}
function cleanUrl(value) {
  const markdown = String(value).match(/\((https?:\/\/[^)]+)\)/);
  return (markdown ? markdown[1] : String(value)).trim().replace(/\/$/, '');
}
function invalid(value) {
  return !value || /COLE_AQUI|SEU_TOKEN|AJUSTAR/.test(value);
}
const slug = String(base.tenant_slug || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const url = cleanUrl(env('EVOLUTION_API_URL_' + slug, env('EVOLUTION_API_URL')));
const apiKey = env('EVOLUTION_API_KEY_' + slug, env('EVOLUTION_API_KEY'));
const instance = String(base.instance || env('EVOLUTION_INSTANCE_' + slug, env('EVOLUTION_INSTANCE'))).trim();

function safeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  const status = Number(error?.statusCode || error?.response?.status || error?.httpCode
    || message.match(/(?:status code|status|HTTP)\s*[:=]?\s*(\d{3})/i)?.[1]) || null;
  let detail = message;
  for (const secret of [apiKey, env('SUPABASE_SERVICE_ROLE_KEY'), env('GEMINI_API_KEY')]) {
    if (secret) detail = detail.split(secret).join('[REDACTED]');
  }
  detail = detail.replace(/(?:Bearer\s+)[^\s"']+/gi, 'Bearer [REDACTED]');
  return { http_status: status, error: status ? 'evolution_http_' + status : 'evolution_request_failed',
    error_detail: detail.slice(0,500), error_code: String(error?.code || '').slice(0,60) };
}

const items = Array.isArray(base.product_media_matches) ? base.product_media_matches.slice(0,3) : [];
const delivery = { revision: 'media-before-text-v1', sent: [] };
if (!items.length) delivery.skipped = 'no_product_media';
else if (!base.should_send_response || base.handoff) delivery.skipped = 'session_or_handoff_blocked';
else if ([url, apiKey, instance].some(invalid)) delivery.skipped = 'missing_or_placeholder_evolution_media_env';
else if (!(base.remoteJid || base.phone)) delivery.skipped = 'missing_recipient_number';
else {
  for (const item of items) {
    try {
      const response = await this.helpers.httpRequest({
        method: 'POST', url: url + '/message/sendMedia/' + encodeURIComponent(instance),
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: {
          number: String(base.remoteJid || base.phone),
          mediatype: 'image', mimetype: item.mimetype || 'image/jpeg',
          caption: item.caption || item.title || '', media: item.url,
          fileName: item.file_name || 'produto.jpg',
        },
        json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 15000,
      });
      if (response?.statusCode >= 400) {
        const error = new Error(typeof response.body === 'string' ? response.body : JSON.stringify(response.body));
        error.statusCode = response.statusCode;
        throw error;
      }
      const payload = response?.body || response;
      const messageId = payload?.key?.id || payload?.data?.key?.id || payload?.message?.key?.id;
      delivery.sent.push({ ok: Boolean(messageId), status: messageId ? 'accepted' : 'unconfirmed',
        message_id: messageId || null, title: item.title || '', url: item.url,
        http_status: response?.statusCode || null });
    } catch (error) {
      delivery.sent.push({ ok: false, status: 'failed', title: item.title || '', url: item.url, ...safeError(error) });
    }
  }
}

let responseText = base.responseText;
let stage = base.stage;
if (items.length && !base.handoff && base.should_send_response) {
  const accepted = delivery.sent.filter(item => item.ok).length;
  if (accepted === items.length) {
    responseText = base.tenant_settings?.product_media_sent_message
      || 'Separei estas op\u00e7\u00f5es para voc\u00ea. Qual chamou mais sua aten\u00e7\u00e3o?';
    stage = 'Produtos apresentados';
  } else if (accepted) {
    responseText = 'Enviei parte das fotos, mas algumas falharam. Podemos come\u00e7ar por estas op\u00e7\u00f5es?';
    stage = 'Produtos apresentados';
  } else {
    responseText = base.tenant_settings?.product_media_failure_message
      || 'N\u00e3o consegui enviar as fotos agora. Desculpe! Podemos tentar novamente em instantes.';
    stage = 'Qualificacao';
  }
}
return { json: { ...base, responseText, stage, product_media_delivery: delivery } };
