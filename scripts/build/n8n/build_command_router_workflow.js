const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const codePath = path.join(root, 'n8n', 'code', 'command_router.js');
const workflowPath = path.join(root, 'n8n', 'workflows', 'magia_command_router.json');
const routerCode = fs.readFileSync(codePath, 'utf8');

const workflow = {
  id: 'magiaCommandRouter01',
  name: 'Mag.IA/Core - Command Router',
  active: true,
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'magia-command',
        responseMode: 'responseNode',
        options: {},
      },
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [0, 0],
      id: '9655d9a3-cf8e-4cb1-a81f-34e7d3a66a51',
      name: 'Webhook MagIA Command',
      webhookId: 'magia-command-webhook',
    },
    {
      parameters: {
        jsCode: routerCode,
      },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [260, 0],
      id: '7e24c48f-6389-4e08-a987-a75312254c14',
      name: 'Executar Comando',
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json }}',
        options: {
          responseHeaders: {
            entries: [
              { name: 'Access-Control-Allow-Origin', value: '*' },
              { name: 'Access-Control-Allow-Headers', value: 'content-type, authorization' },
            ],
          },
        },
      },
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [520, 0],
      id: '2d730961-29d8-424e-a9f6-264dd351fe02',
      name: 'Responder Interface',
    },
  ],
  connections: {
    'Webhook MagIA Command': {
      main: [[{ node: 'Executar Comando', type: 'main', index: 0 }]],
    },
    'Executar Comando': {
      main: [[{ node: 'Responder Interface', type: 'main', index: 0 }]],
    },
  },
  settings: {
    executionOrder: 'v1',
  },
  staticData: null,
  meta: {},
  pinData: {},
  versionId: 'manual-reply-v3-authenticated',
  activeVersionId: 'manual-reply-v3-authenticated',
  versionCounter: 3,
  triggerCount: 0,
  tags: [],
};

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`Generated ${workflowPath}`);
