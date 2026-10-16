const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '../n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));

const node = workflow.nodes.find(n => n.name === 'Confirmar Mídia WhatsApp');
if (!node) {
  console.error('Node Confirmar Mídia WhatsApp not found');
  process.exit(1);
}

const oldScopeSnippet = 'if (tenantId && eventId && externalMessageId && chatId) {\\r\\n  const base = String($env.SUPABASE_URL || \'\').replace(/\\\\/$/, \'\');\\r\\n  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;\\r\\n  const scope = `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&channel_type=eq.whatsapp&external_conversation_id=eq.${encodeURIComponent(chatId)}&id=eq.${encodeURIComponent(eventId)}&external_message_id=eq.${encodeURIComponent(externalMessageId)}`;';

const newScopeSnippet = 'if (tenantId && eventId) {\\r\\n  const base = String($env.SUPABASE_URL || \'\').replace(/\\\\/$/, \'\');\\r\\n  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;\\r\\n  const scope = `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&id=eq.${encodeURIComponent(eventId)}`;';

if (node.parameters.jsCode.includes('tenant_id=eq.${encodeURIComponent(tenantId)}&channel_type=eq.whatsapp')) {
  node.parameters.jsCode = node.parameters.jsCode.replace(
    /if\s*\(tenantId\s*&&\s*eventId\s*&&\s*externalMessageId\s*&&\s*chatId\)\s*\{\s*const base = String\(\$env\.SUPABASE_URL[\s\S]*?external_message_id=eq\.\$\{encodeURIComponent\(externalMessageId\)\}`;/,
    'if (tenantId && eventId) {\r\n  const base = String($env.SUPABASE_URL || \'\').replace(/\\/$/, \'\');\r\n  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;\r\n  const scope = `${base}/rest/v1/channel_events?tenant_id=eq.${encodeURIComponent(tenantId)}&id=eq.${encodeURIComponent(eventId)}`;'
  );
  fs.writeFileSync(file, JSON.stringify(workflow, null, 2) + '\n');
  console.log('Successfully updated Confirmar Mídia WhatsApp scope in NORIA CORE workflow');
} else {
  console.log('Scope already updated or pattern not found');
}
