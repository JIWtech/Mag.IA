const fs = require('node:fs');
const path = require('node:path');
require('./build_whatsapp_core.cjs');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'n8n/workflows/magia_whatsapp_evolution_mvp.json');
const workflow = JSON.parse(fs.readFileSync(file,'utf8'));
const names = { sync:'Sincronizar Contato WhatsApp', route:'Selecionar Motor WhatsApp', gate:'Usar Core Conversacional?', enqueue:'Registrar Mensagem na Fila',
  ack:'Confirmar Recebimento Core', wait:'Aguardar Janela de Mensagens', worker:'Processar Conversa WhatsApp',
  tick:'Recuperar Fila WhatsApp', recover:'Ler Fila WhatsApp' };
const code = (name,source,position,mode='runOnceForAllItems') => ({ id:name, name, type:'n8n-nodes-base.code',typeVersion:2,
  position,parameters:{ mode,jsCode:fs.readFileSync(path.join(root,'n8n/code',source),'utf8').trimEnd() }});
const nodes = [
  code(names.sync,'whatsapp_sync_contact.js',[280,-300]),
  code(names.route,'whatsapp_select_core.js',[500,-300]),
  {id:names.gate,name:names.gate,type:'n8n-nodes-base.if',typeVersion:2.2,position:[720,-300],parameters:{conditions:{
    options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{
      leftValue:'={{ $json.use_conversation_core }}',rightValue:true,operator:{type:'boolean',operation:'equals'}}],combinator:'and'},options:{}}},
  code(names.enqueue,'whatsapp_enqueue_core.js',[960,-560]),
  {id:names.ack,name:names.ack,type:'n8n-nodes-base.respondToWebhook',typeVersion:1,position:[1180,-560],parameters:{respondWith:'json',responseBody:'={{ { ok: true, queued: true } }}',options:{}}},
  {id:names.wait,name:names.wait,type:'n8n-nodes-base.wait',typeVersion:1.1,position:[1400,-560],parameters:{resume:'timeInterval',amount:'={{ $json.core_wait_seconds }}',unit:'seconds'}},
  code(names.worker,'whatsapp_conversation_core.generated.js',[1640,-560],'runOnceForEachItem'),
  {id:names.tick,name:names.tick,type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[1180,-850],parameters:{rule:{interval:[{field:'seconds',secondsInterval:10}]}}},
  code(names.recover,'whatsapp_recover_core.js',[1400,-850]),
];
for (const node of nodes) {
  const old = workflow.nodes.find(n=>n.name===node.name);
  if(old) Object.assign(old,{parameters:node.parameters}); else workflow.nodes.push(node);
}
const to = node => [{node,type:'main',index:0}];
// The native media ingestion path is installed independently.  Rebuilding the
// opt-in Core must retain it when present; otherwise inbound audio/image/video
// would reach the acknowledgement before its binary Storage finalizer.
const enqueueNext = workflow.nodes.some(node=>node.name==='Preparar Mídia WhatsApp')
  ? 'Preparar Mídia WhatsApp'
  : names.ack;
workflow.connections['Mensagem valida?'].main[0]=to(names.sync);
workflow.connections[names.sync]={main:[to(names.route)]};
workflow.connections[names.route]={main:[to(names.gate)]};
workflow.connections[names.gate]={main:[to(names.enqueue),to('Consultar Deduplicacao no Redis')]};
workflow.connections[names.enqueue]={main:[to(enqueueNext)]};
workflow.connections[names.ack]={main:[to(names.wait)]};
workflow.connections[names.wait]={main:[to(names.worker)]};
workflow.connections[names.tick]={main:[to(names.recover)]};
workflow.connections[names.recover]={main:[to(names.worker)]};
fs.writeFileSync(file,(JSON.stringify(workflow,null,2)+'\n').replace(/\r?\n/g, '\r\n'));
console.log('Built opt-in WhatsApp core path; original processing path preserved.');
