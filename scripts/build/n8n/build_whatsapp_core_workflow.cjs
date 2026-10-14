const fs = require('node:fs');
const path = require('node:path');

require('./build_whatsapp_core.cjs');

const root = path.resolve(__dirname, '../../..');
const file = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
const core = workflow.nodes.find(node => node.name === 'CORE | Motor conversacional único');
const revision = 'conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14';

if (!core?.parameters?.jsCode?.includes(revision)) throw new Error('Generated CORE revision is missing');
if (!workflow.connections || !Object.keys(workflow.connections).length) throw new Error('Workflow connections are missing');

// The imported production export is the graph source. The build only refreshes
// the reviewed Code-node body and never recreates IDs, credentials or layout.
workflow.meta = { ...(workflow.meta || {}), magiaCoreRevision: revision };
fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Validated importable WhatsApp CORE (${revision}); graph identity preserved.`);
