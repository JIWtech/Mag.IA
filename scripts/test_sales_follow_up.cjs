const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../n8n/code/whatsapp_follow_up_dispatch.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function run({sales=true,blocked=false,race=false,guardError=false,sendError=false,saveError=false,changed=false}={}){
  const calls=[],finishes=[];let checks=0,sends=0,models=0;
  const job={id:'job',lease_token:'lease',tenant_id:'tenant',tenant_slug:'client',channel_type:'whatsapp',
    external_conversation_id:'5521988887777@s.whatsapp.net',anchor_created_at:'2026-10-01T12:00:00Z',anchor_event_id:'anchor',step_key:'3h'};
  const settings={...(sales?{conversation_capability:'sales_v1',contact_exclusion_enabled:true}:{}),
    ai_model:'gemini-2.5-flash',system_prompt:'Prompt',sales_follow_up:{enabled:true,messages:{'3h':'Podemos continuar seu atendimento?'}}};
  const request=async({url,method,body})=>{
    calls.push({url,method,body});const u=new URL(url),table=u.pathname.split('/').at(-1);
    if(table==='magia_claim_followup_jobs')return [job];
    if(table==='tenant_settings')return [{settings}];
    if(table==='magia_validate_sales_followup'){
      checks++;assert.equal(body.p_job,job.id);assert.equal(body.p_lease,job.lease_token);
      if(guardError)throw Error('Guard unavailable');return {allowed:!blocked&&!(race&&checks>1)};
    }
    if(table==='magia_finish_followup_job'){finishes.push(body);return true;}
    if(table==='appointments'){assert.equal(sales,false);return [];}
    if(table==='channel_events'){
      if(method==='POST'){if(saveError)throw Error('Database timeout');return [{id:'sent'}];}
      return changed?[{direction:'inbound',sender_type:'contact'}]:[];
    }
    if(table==='channels')return [{external_id:'client'}];
    if(u.hostname==='evo.test'){sends++;if(sendError)throw Error('ETIMEDOUT');return {key:{id:'msg'}};}
    if(u.hostname==='generativelanguage.googleapis.com'){models++;return {candidates:[{finishReason:'STOP',content:{parts:[{text:'{"reply":"Podemos continuar?"}'}]}}]};}
    throw Error('Unexpected '+url);
  };
  const result=await new AsyncFunction('$env',code).call({helpers:{httpRequest:request}},
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_API_KEY:'fake',
      EVOLUTION_API_URL_CLIENT:'https://evo.test',EVOLUTION_API_KEY_CLIENT:'fake',EVOLUTION_INSTANCE_CLIENT:'client'});
  return {result,calls,finishes,checks,sends,models};
}
test('sales sends configured message with two live guards, without model, documents or appointments',async()=>{
  const r=await run();assert.equal(r.sends,1);assert.equal(r.checks,2);assert.equal(r.models,0);
  assert.equal(r.finishes[0].p_status,'sent');
  const event=r.calls.find(c=>c.method==='POST'&&c.url.endsWith('/channel_events')).body;
  assert.equal(event.ai_provider,'configured_follow_up');
});
test('excluded/human/paused lead or changed conversation cancels before any send',async()=>{
  for(const flags of [{blocked:true},{race:true},{changed:true}]){
    const r=await run(flags);assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'cancelled');
  }
});
test('failed eligibility never permits sending',async()=>{
  const r=await run({guardError:true});assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'failed');
});
test('any failure after send begins is uncertain, including persistence failure',async()=>{
  for(const flags of [{sendError:true},{saveError:true}]){
    const r=await run(flags);assert.equal(r.sends,1);assert.equal(r.finishes[0].p_status,'uncertain');
  }
});
test('non-sales existing follow-up keeps its model and appointment checks',async()=>{
  const r=await run({sales:false});assert.equal(r.sends,1);assert.equal(r.models,1);assert.equal(r.checks,0);
  assert.equal(r.calls.filter(c=>c.url.includes('/appointments?')).length,2);
});
