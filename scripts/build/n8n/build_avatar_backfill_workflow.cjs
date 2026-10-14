const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'n8n/code/whatsapp_avatar_backfill.js');
const workflow = path.join(root, 'n8n/workflows/Busca de fotos (perfil) conversas antigas.json');
const json = JSON.parse(fs.readFileSync(workflow, 'utf8'));
const node = json.nodes.find(item => item.id === 'b86637ce-1e0a-42d4-ab2a-174b17fe4f1d');
if (!node || node.type !== 'n8n-nodes-base.code') throw new Error('Avatar Code node not found');
node.parameters.jsCode = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(workflow, `${JSON.stringify(json, null, 2)}\n`);
