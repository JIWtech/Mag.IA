const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'n8n/workflows/magia_whatsapp_evolution_mvp.json');
const workflow = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
for (const node of [
  {
    id: 'magia-whatsapp-send-product-media', name: 'Enviar Fotos do Catalogo',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [2480, -200], parameters: {},
  },
  {
    id: 'magia-whatsapp-validate-after-media', name: 'Validar Sessao Apos Fotos',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [2680, -200], parameters: {},
  },
  {
    id: 'magia-whatsapp-session-after-media', name: 'Sessao ativa apos fotos?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [2880, -200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: '={{ $json.should_send_response }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
        combinator: 'and',
      }, options: {},
    },
  },
  {
    id: 'magia-whatsapp-validate-session', name: 'Validar Sessao Antes do Envio',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [2200, 100], parameters: {},
  },
  {
    id: 'magia-whatsapp-session-current', name: 'Sessao ainda ativa?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [2420, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: '={{ $json.should_send_response }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
        combinator: 'and',
      }, options: {},
    },
  },
  {
    id: 'magia-whatsapp-response-cancelled', name: 'Responder Resposta Cancelada',
    type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [2640, 340],
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { ok: true, ignored: true, reason: $json.response_discard_reason, external_message_id: $json.messageId } }}',
      options: {},
    },
  },
]) {
  if (!workflow.nodes.some((entry) => entry.name === node.name)) workflow.nodes.push(node);
}
for (const [nodeName, file] of [
  ['Preparar Contexto JIW', 'whatsapp_prepare_context.js'],
  ['Preparar Evento Enviado', 'whatsapp_prepare_sent.js'],
  ['Enviar Fotos do Catalogo', 'whatsapp_send_product_media.js'],
  ['Validar Sessao Antes do Envio', 'whatsapp_validate_session.js'],
  ['Validar Sessao Apos Fotos', 'whatsapp_validate_session.js'],
]) {
  const node = workflow.nodes.find((entry) => entry.name === nodeName);
  if (!node) throw new Error(`Node missing: ${nodeName}`);
  node.parameters.jsCode = fs.readFileSync(path.join(root, 'n8n/code', file), 'utf8').trimEnd();
}
const memory = workflow.nodes.find((node) => node.name === 'Memoria Redis da Conversa');
if (!memory) throw new Error('Redis conversation memory node missing');
memory.parameters.sessionKey = '={{ $json.memory_session_key }}';
const model = workflow.nodes.find((node) => node.name === 'Gemini Chat Model');
if (!model) throw new Error('Gemini model node missing');
model.parameters.modelName = "={{ $json.whatsapp_ai_model || 'models/gemini-2.5-flash' }}";
model.parameters.options = "={{ $json.whatsapp_ai_options || { temperature: 0.3 } }}";
const connect = (node) => [{ node, type: 'main', index: 0 }];
workflow.connections['Restaurar Contexto para Envio'] = { main: [connect('Validar Sessao Antes do Envio')] };
workflow.connections['Validar Sessao Antes do Envio'] = { main: [connect('Sessao ainda ativa?')] };
workflow.connections['Sessao ainda ativa?'] = { main: [connect('Enviar Fotos do Catalogo'), connect('Responder Resposta Cancelada')] };
workflow.connections['Enviar Fotos do Catalogo'] = { main: [connect('Validar Sessao Apos Fotos')] };
workflow.connections['Validar Sessao Apos Fotos'] = { main: [connect('Sessao ativa apos fotos?')] };
workflow.connections['Sessao ativa apos fotos?'] = { main: [connect('Enviar Resposta pela Evolution'), connect('Responder Resposta Cancelada')] };
fs.writeFileSync(target, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Updated WhatsApp media/context nodes and session guard. Credentials preserved.');
