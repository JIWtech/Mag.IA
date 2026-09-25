const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const fn=new AsyncFunction('$json','$env','$vars',fs.readFileSync(path.join(__dirname,'../n8n/code/command_router.js'),'utf8'));

async function run({status='payment_reported',chat='chat',member=true,race=false,failSend=false,metadata={}}={}) {
  const row={id:'appt',tenant_id:'clinic',channel_type:'whatsapp',external_conversation_id:chat,status,metadata,updated_at:'2026-09-25T10:00:00Z'};
  let sends=0;const writes=[];
  const req=async({method,url,body})=>{
    const u=new URL(url);const table=u.pathname.split('/').at(-1);
    if(u.hostname==='evo.test'){sends++;if(failSend)throw Error('timeout');return {key:{id:'confirmed-message'}};}
    if(table==='user')return {id:'owner',email:'owner@example.test'};
    if(table==='tenants')return [{id:'clinic',slug:'clinic',status:'active'}];
    if(table==='tenant_members')return member?[{role:'owner',status:'active'}]:[];
    if(table==='tenant_settings')return [{settings:{whatsapp_processing_mode:'conversation_core_v1',payment_signal_confirmation_message:'Reserva confirmada! Regras de cancelamento.'}}];
    if(table==='appointments'){
      assert.equal(u.searchParams.get('tenant_id'),'eq.clinic');
      if(method==='GET')return [{...row}];
      if(race&&u.searchParams.has('updated_at'))return [];
      Object.assign(row,body);writes.push(body);return [{...row}];
    }
    if(table==='channel_events'){writes.push(body);return [{id:'event'}];}
    throw Error('Unexpected '+url);
  };
  const input={headers:{authorization:'Bearer test'},body:{command:'confirm_payment_signal',tenant_slug:'clinic',payload:{appointment_id:'appt',channel_type:'whatsapp',external_conversation_id:'chat'}}};
  const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',EVOLUTION_API_URL_CLINIC:'https://evo.test',EVOLUTION_API_KEY_CLINIC:'fake',EVOLUTION_INSTANCE_CLINIC:'clinic'};
  return {result:(await fn.call({helpers:{httpRequest:req}},input,env,{})).json,sends,writes,row};
}
test('operator click sends receipt once then confirms appointment and emits kanban event',async()=>{
  const r=await run();assert.equal(r.result.ok,true,JSON.stringify(r.result));assert.equal(r.sends,1);assert.equal(r.row.status,'confirmed');
  assert.equal(r.writes.at(-1).stage,'Agendamento confirmado');
});
test('confirmed appointment is idempotent, cannot send receipt again',async()=>{
  const r=await run({status:'confirmed'});assert.equal(r.result.ok,true);assert.equal(r.sends,0);
});
test('wrong contact or unauthorized operator cannot send or change payment',async()=>{
  for(const options of [{chat:'other'},{member:false},{status:'pending_payment'}]){
    const r=await run(options);assert.equal(r.result.ok,false);assert.equal(r.sends,0);assert.equal(r.writes.length,0);
  }
});
test('concurrent click loses optimistic lock before send',async()=>{
  const r=await run({race:true});assert.equal(r.result.ok,false);assert.equal(r.sends,0);
});
test('uncertain delivery remains blocked and is never confirmed or blindly resent',async()=>{
  const r=await run({failSend:true});assert.equal(r.result.ok,false);assert.equal(r.row.status,'payment_reported');
  assert.equal(r.row.metadata.signal_confirmation_state,'uncertain');
  const retry=await run({metadata:r.row.metadata});assert.equal(retry.sends,0);assert.equal(retry.result.ok,false);
});
