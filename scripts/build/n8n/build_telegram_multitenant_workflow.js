const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const codePath = path.join(root, 'n8n', 'code', 'telegram_multitenant_process.js');
const workflowPath = path.join(root, 'n8n', 'workflows', 'magia_telegram_multitenant.json');
const processCode = fs.readFileSync(codePath, 'utf8');

const workflow = {
  id: 'magiaTelegramMultiTenant01',
  name: 'Mag.IA/Core - Telegram Multi-tenant',
  active: true,
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'telegram',
        responseMode: 'responseNode',
        options: {},
      },
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [0, 0],
      id: 'telegram-multitenant-webhook-node',
      name: 'Webhook Telegram Multi-tenant',
      webhookId: 'telegram-multitenant-webhook',
    },
    {
      parameters: {
        jsCode: processCode,
      },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [280, 0],
      id: 'telegram-multitenant-process-node',
      name: 'Processar Tenant e Responder',
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json.telegram_response }}',
        options: {},
      },
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [560, 0],
      id: 'telegram-multitenant-respond-node',
      name: 'Responder Telegram',
    },
  ],
  connections: {
    'Webhook Telegram Multi-tenant': {
      main: [[{ node: 'Processar Tenant e Responder', type: 'main', index: 0 }]],
    },
    'Processar Tenant e Responder': {
      main: [[{ node: 'Responder Telegram', type: 'main', index: 0 }]],
    },
  },
  settings: {
    executionOrder: 'v1',
  },
  staticData: null,
  meta: {},
  pinData: {},
  versionId: 'telegram-multitenant-v1',
  activeVersionId: 'telegram-multitenant-v1',
  versionCounter: 1,
  triggerCount: 0,
  tags: [],
};

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`Generated ${workflowPath}`);
