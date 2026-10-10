const fs = require('fs');
const path = require('path');

const n8nScripts = [
  'scripts/build_command_router_workflow.js',
  'scripts/build_telegram_multitenant_workflow.js',
  'scripts/build_whatsapp_core.cjs',
  'scripts/build_whatsapp_core_workflow.cjs',
  'scripts/build_whatsapp_follow_up_workflow.cjs',
  'scripts/build_whatsapp_media_nodes.cjs'
];

for (const s of n8nScripts) {
  const content = fs.readFileSync(s, 'utf8');
  console.log('=== ' + s + ' ===');
  const pathMatches = content.match(/path\.(?:join|resolve)\([^)]+\)/g) || [];
  pathMatches.forEach(p => console.log('   ' + p));
}
