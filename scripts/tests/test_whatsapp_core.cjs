const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const code = fs.readFileSync(path.join(__dirname,'../../n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const execute = new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code);
const services=[{external_id:'bronze',category:'Bronze',name:'Bronze Classico',description:'Bronze em maquina',price:99.99,billing_unit:'sessao',notes:'',active:true}];

async function run({ texts=['Oi','Quero agendar','Bronze Classico','29/09/2099 as 10h','Maria'], response='Perfeito [ACAO: CRIAR_AGENDAMENTO|nome=Maria|servico=Bronze Classico|data=2099-09-29|hora=10:00|duracao=120|status=pending_payment]', history=[], appointments=[], stale=false, sendError=false, failAppointment=false, closeAt=null, enabled=true, grounded=false, businessFacts={}, scheduling=null, available=['10:00'], availabilityError=false, sessionMode=false, usage={}, boundaryChanged=false, audio=false, transcript='Quero bronze', audioFailure='', audioCache=null, audioMedia=null, mediaFixtures={}, contact=null, contactExclusionEnabled=false, contactExclusion=null, failExclusion=false, exclusionBeforeSend=null,tenantSlug='clinic' }={}) {
  const calls=[]; const events=[]; const saved=[]; const finishes=[]; const uploads=[]; let sent=0; let generated=0; let exclusionCalls=0;
  const input={tenant_id:'t-clinic',tenant_slug:tenantSlug,remoteJid:'5511111111111@s.whatsapp.net',instance:'clinic'};
  const environment={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_ENABLED:'true',GEMINI_API_KEY:'fake',
    EVOLUTION_API_URL_CLINIC:'https://evo.test',EVOLUTION_API_KEY_CLINIC:'fake',EVOLUTION_INSTANCE_CLINIC:'clinic',
    EVOLUTION_API_URL_CLINICA_NUBIA_OFICIAL:'https://evo.test',EVOLUTION_API_KEY_CLINICA_NUBIA_OFICIAL:'fake',EVOLUTION_INSTANCE_CLINICA_NUBIA_OFICIAL:'clinic'};
  const settings={whatsapp_processing_mode:enabled?'conversation_core_v1':'',ai_model:'gemini-2.5-flash-lite',ai_enabled:true,
    system_prompt:'Atendente da clinica',payment_signal_enabled:true,appointment_payment_trigger:'SINAL PAGO',
    payment_signal_ack_message:'Ta bom! Vou confirmar aqui, um momento',payment_signal_confirmation_message:'Reserva efetuada!',
    default_ai_appointment_status:'pending_payment',timezone:'America/Sao_Paulo',service_categories:['bronze'],gemini_daily_limit:80,contact_exclusion_enabled:contactExclusionEnabled};
  if (grounded) Object.assign(settings,{grounding_mode:'canonical_v2',ai_model:'gemini-2.5-flash',
    system_prompt:'ONLY CANONICAL TENANT PROMPT',prompt_revision:'test-v2',business_facts:businessFacts});
  if (scheduling) settings.appointment_scheduling = scheduling;
  if (sessionMode) settings.attendance_lifecycle = 'session_v2';
  settings.whatsapp_audio_enabled=audio;
  const request=async ({method,url,body,headers})=>{
    const u=new URL(url);calls.push({method,url,body});
    if(u.pathname.includes('getBase64FromMediaMessage')) {
      if(audioFailure==='download')throw Error('timeout with private URL');
      const fixture=mediaFixtures[body?.message?.key?.id];
      if(fixture) return fixture;
      return {mimetype:audioFailure==='format'?'image/png':'audio/ogg; codecs=opus',base64:Buffer.from('OggS test audio').toString('base64')};
    }
    if(u.hostname==='evo.test'){sent++;if(sendError)throw Error('timeout');return {key:{id:'sent-1'}};}
    if(u.hostname==='generativelanguage.googleapis.com'&&body.contents[0].parts[0].inlineData) {
      if(audioFailure==='transcription')throw Error('timeout');
      return {candidates:[{finishReason:audioFailure==='truncated'?'MAX_TOKENS':'STOP',content:{parts:[{text:JSON.stringify({intelligible:audioFailure!=='silent',text:transcript})}]}}]};
    }
    if(u.hostname==='generativelanguage.googleapis.com'){generated++;return {candidates:[{content:{parts:[{text:typeof response==='object'?JSON.stringify(response):response}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:10}};}
    assert.equal(u.hostname,'db.test');
    if(u.pathname.includes('/storage/v1/object/')) {
      if(audioFailure==='storage') throw Error('Storage unavailable');
      assert.ok(Buffer.isBuffer(body), 'audio upload must send binary bytes, not a Base64 text file');
      uploads.push({url,body,headers});
      return {Key:'stored'};
    }
    const table=u.pathname.split('/').at(-1);
    if(table==='magia_contact_exclusion_status'){
      if(failExclusion)throw Error('RPC unavailable');
      exclusionCalls++;
      if(exclusionBeforeSend && exclusionCalls > 1) return exclusionBeforeSend;
      return contactExclusion || { blocked: false, reason: 'not_excluded' };
    }
    if(table==='magia_claim_turn')return {claimed:true,token:'claim-1',boundary_id:closeAt?'close-1':'initial',messages:texts.map((text,i)=>({event_id:'e'+i,id:'m'+i,text,name:'Cliente',received_at:new Date(Date.now()-1000).toISOString()}))};
    if(table==='magia_commit_turn')return stale?{committed:false,reason:'new_messages'}:{committed:true};
    if(table==='magia_finish_turn'){finishes.push(body.p_outcome);return {finished:true};}
    if(table==='magia_begin_turn_delivery')return {id:'delivery-1',status:'attempting'};
    if(table==='magia_confirm_turn_delivery')return {confirmed:true};
    if(table==='magia_appointment_availability'){if(availabilityError)throw Error('RPC unavailable');return {available_starts:available};}
    if(['magia_reserve_appointment','magia_reserve_session_appointment'].includes(table)){
      if(failAppointment)throw Error('SLOT_UNAVAILABLE');
      const a={id:'a-created',status:'pending_payment',starts_at:body.p_date+'T13:00:00Z',metadata:{unit_id:body.p_unit}};
      saved.push(a);return a;
    }
    if(table==='tenants')return [{id:'t-clinic',slug:tenantSlug,status:'active',name:'Clinica'}];
    if(table==='tenant_settings')return [{timezone:'America/Sao_Paulo',settings}];
    if(table==='ai_agents')return [{model:'gemini-2.5-flash-lite',max_tokens:500,temperature:0.45}];
    if(table==='channels')return [{external_id:'clinic'}];
    if(table==='contacts')return contact ? [contact] : [];
    if(table==='tenant_service_catalog'||table==='search_tenant_service_catalog')return services;
    if(table==='channel_events'){
      if(method==='GET'&&u.searchParams.get('id')) {
        const id=u.searchParams.get('id').slice(3);
        assert.equal(u.searchParams.get('tenant_id'),'eq.t-clinic');
        assert.equal(u.searchParams.get('external_conversation_id'),'eq.5511111111111@s.whatsapp.net');
        return [{id,external_message_id:audioFailure==='scope'?'another':id.replace('e','m'),raw_payload:{content_type:'audio',
          audio_metadata:{seconds:audioFailure==='long'?121:10},...(audioCache?{audio_processing:audioCache}:{}),...(audioMedia?{media:audioMedia}:{})}}];
      }
      if(method==='PATCH'&&body.raw_payload?.audio_processing) {
        if(audioFailure==='persist')throw Error('DB failed');
        events.push(body);
        return [{id:'cached'}];
      }
      if(method==='PATCH'){events.push(body);return [{}];}
      if(method==='POST'){events.push(body);return [{id:'out'}];}
      if(u.searchParams.get('or')?.includes('sender_type.eq.human'))return [];
      if(u.searchParams.get('or')?.includes('conversation_closed'))return closeAt?[{id:boundaryChanged?'close-2':'close-1',created_at:closeAt}]:[];
      return history.filter(e=>!closeAt||Date.parse(e.created_at)>Date.parse(closeAt)).reverse();
    }
    if(table==='appointments'){
      if(method==='POST'){if(failAppointment)throw Error('DB unavailable');saved.push(body);return [{id:'a-created',...body}];}
      assert.equal(u.searchParams.get('tenant_id'),'eq.t-clinic');
      if(method==='PATCH'){saved.push(body);return [{...appointments[0],...body}];}
      return appointments;
    }
    throw Error('Unexpected '+method+' '+u.pathname);
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const body = options.body;
    if (typeof url === 'string' && url.includes('/storage/v1/object/')) {
      if (audioFailure === 'storage') {
        return {
          ok: false,
          status: 500,
          text: async () => 'Storage unavailable',
        };
      }
      if (method === 'POST') {
        assert.ok(Buffer.isBuffer(body) || body instanceof Uint8Array, 'audio upload must send binary bytes, not a Base64 text file');
        uploads.push({ url, body, headers });
        calls.push({ method: 'POST', url, body, headers });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ Key: 'stored' }),
        };
      }
      if (method === 'HEAD') {
        const lastUpload = uploads.find(u => u.url === url) || uploads[uploads.length - 1];
        const len = lastUpload ? lastUpload.body.length : 0;
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(len),
          }),
        };
      }
    }
    return origFetch ? origFetch(url, options) : { ok: false, status: 500 };
  };

  let result;
  try {
    result = await execute.call({helpers:{httpRequest:request}},input,environment,{},()=>usage);
  } finally {
    globalThis.fetch = origFetch;
  }
  return {result:result.json,calls,events,saved,finishes,uploads,sent,generated};
}

test('one combined generation creates one pending appointment and one WhatsApp reply',async()=>{
  const r=await run();assert.equal(r.result.ok,true,JSON.stringify(r.result));assert.equal(r.generated,1);assert.equal(r.sent,1);
  assert.equal(r.saved[0].status,'pending_payment');assert.equal(r.saved[0].channel_type,'whatsapp');
  assert.equal(r.saved[0].starts_at,'2099-09-29T13:00:00.000Z');
  assert.equal(r.result.grouped,5);assert.equal(r.events.filter(e=>e.direction==='inbound').length,0);
  const gemini=r.calls.find(c=>c.url.includes('generateContent'));assert.match(gemini.body.contents.at(-1).parts[0].text,/Oi[\s\S]*Maria/);
  assert.ok(!r.calls.find(c=>c.url.includes('sendText')).body.text.includes('[ACAO'));
});
test('SINAL PAGO marks payment_reported, sends only ack, does not call model',async()=>{
  const r=await run({texts:['SINAL PAGO'],appointments:[{id:'a',status:'pending_payment',starts_at:'2099-09-29T13:00:00Z',created_at:'2099-01-01',metadata:{}}]});
  assert.equal(r.generated,0);assert.equal(r.saved[0].status,'payment_reported');assert.equal(r.sent,1);
  assert.equal(r.events[0].stage,'Verificar Sinal');assert.equal(r.events[0].handoff,true);
  assert.equal(r.calls.find(c=>c.url.includes('sendText')).body.text,'Ta bom! Vou confirmar aqui, um momento');
});
test('human lock silences future messages including repeated SINAL PAGO',async()=>{
  const r=await run({texts:['SINAL PAGO'],history:[{handoff:true,stage:'Verificar Sinal',service:'pagamento_sinal'}]});
  assert.equal(r.result.human_lock,true);assert.equal(r.sent,0);assert.equal(r.generated,0);
});
test('payment negation does not report payment',async()=>{
  const r=await run({texts:['Ainda nao paguei o sinal'],response:'Tudo bem!'});
  assert.equal(r.generated,1);assert.equal(r.saved.length,0);
});
test('new messages during generation discard output before appointment or send',async()=>{
  const r=await run({stale:true});assert.equal(r.saved.length,0);assert.equal(r.sent,0);assert.deepEqual(r.finishes,['retry']);
});
test('booking write failure never claims reservation was created',async()=>{
  const r=await run({failAppointment:true});assert.equal(r.saved.length,0);
  assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/Não consegui registrar/);
});
test('uncertain provider timeout never retries automatically',async()=>{
  const r=await run({texts:['oi'],response:'Ola!',sendError:true});assert.equal(r.sent,1);
  assert.equal(r.result.delivery_uncertain,true);assert.deepEqual(r.finishes,['uncertain']);
});
test('messages queued before closing are cancelled rather than reopening attendance',async()=>{
  const r=await run({closeAt:new Date().toISOString()});assert.equal(r.sent,0);assert.equal(r.generated,0);assert.deepEqual(r.finishes,['cancelled']);
});
test('core cannot run for tenant without explicit enablement',async()=>{
  const r=await run({enabled:false});assert.equal(r.result.ok,false);assert.equal(r.sent,0);assert.equal(r.generated,0);
});

test('accented action tags still create a pending appointment',async()=>{
  const r=await run({response:'Pronto [A\u00c7\u00c3O: CRIAR_AGENDAMENTO|nome=Maria|servico=Bronze Classico|data=2099-09-29|hora=10:00|duracao=120|status=pending_payment]'});
  assert.equal(r.saved[0]?.status,'pending_payment');
});

test('a repeated payment report cannot downgrade a confirmed appointment',async()=>{
  const r=await run({texts:['SINAL PAGO'],appointments:[{id:'a',status:'confirmed',starts_at:'2099-09-29T13:00:00Z',created_at:'2099-01-01',metadata:{}}]});
  assert.equal(r.saved.length,0);assert.equal(r.generated,0);
});

test('grouped model input includes explicit ISO dates and tenant-owned style',async()=>{
  const r=await run({texts:['Oi','amanha as 10h'],response:'Qual servico?'});
  const prompt=r.calls.find(c=>c.url.includes('generateContent')).body.system_instruction.parts[0].text;
  assert.match(prompt,/- Hoje: \d{4}-\d{2}-\d{2}/);
  assert.match(prompt,/interprete todas como um pedido unico/);
  assert.doesNotMatch(prompt,/PERSONALIDADE OBRIGATORIA/i);
});

const blankState={customer_name:'',service_id:'',date:'',time:'',name_evidence:'',service_evidence:'',date_evidence:'',time_evidence:'',unit_id:'',unit_evidence:''};

const scheduling=JSON.parse(fs.readFileSync(path.join(__dirname,'../../clients/clinica_nubia_oficial/scheduling.json')));
const singleUnitScheduling=structuredClone(scheduling);
// Generic multi-unit behavior must remain supported, independent of the clinic's current catalog.
scheduling.units.rio={...structuredClone(scheduling.units.angra),name:'Rio',aliases:['rio']};
scheduling.service_resources.bronze='classico';
singleUnitScheduling.service_resources.bronze='classico';
const schedulingState={...blankState,customer_name:'Maria',service_id:'bronze',date:'2099-09-29',time:'10:00',
  name_evidence:'e4',service_evidence:'e2',date_evidence:'e3',time_evidence:'e3',unit_id:'angra',unit_evidence:'e5'};
const schedulingTexts=['Oi','Quero agendar','Bronze Classico','29/09/2099 as 10h','Maria','Angra'];

test('audio is transcribed before a single grouped answer and counted separately',async()=>{
  const usage={};
  const r=await run({grounded:true,audio:true,texts:['[audio]','por favor'],usage,
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.result.ok,true);assert.equal(r.sent,1);assert.equal(r.generated,1);
  assert.equal(Object.values(usage)[0],2);
  const input=r.calls.find(c=>c.url.includes('generateContent')&&!c.body.contents[0].parts[0].inlineData).body.contents[0].parts[0].text;
  assert.match(input,/Quero bronze/);assert.match(input,/por favor/);assert.doesNotMatch(input,/\[audio\]/);
  const audioPatch = r.events.find(e => e.raw_payload?.audio_processing);
  assert.equal(audioPatch?.raw_payload?.audio_processing?.text, 'Quero bronze');
  // Storage belongs to the native ingestion nodes that run before this core.
  // The core may use the audio bytes for Gemini, but never uploads them itself.
  assert.equal(audioPatch?.raw_payload?.media, undefined);
  assert.equal(r.calls.filter(c=>c.url.includes('/storage/v1/object/channel-media/')).length,0);
  assert.equal(r.uploads.length,0);
  assert.equal(r.events.find(e => e.service)?.raw_payload, undefined);
  assert.ok(!JSON.stringify(r.events).includes('base64'));
});

test('image, video, document and sticker do not invoke Storage from the conversation core',async()=>{
  const fixtures={
    image:{mimetype:'image/jpeg',base64:Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]).toString('base64')},
    video:{mimetype:'video/mp4',base64:Buffer.from('000000186674797069736f6d','hex').toString('base64')},
    document:{mimetype:'application/pdf',base64:Buffer.from('%PDF-1.7').toString('base64')},
    sticker:{mimetype:'image/webp',base64:Buffer.from('524946460000000057454250','hex').toString('base64')},
  };
  for(const [kind,fixture] of Object.entries(fixtures)) {
    const r=await run({grounded:true,texts:['['+kind+']'],mediaFixtures:{m0:fixture},
      response:{action:'reply',reply:'Recebi seu anexo.',state:blankState}});
    assert.equal(r.result.ok,true,kind);
    assert.equal(r.events.some(e=>e.raw_payload?.media?.kind===kind),false,kind);
    assert.equal(r.uploads.length,0,kind);
    assert.equal(r.calls.some(c=>c.url.includes('/storage/v1/object/channel-media/')),false,kind);
    assert.ok(!JSON.stringify(r.events).includes(fixture.base64),kind);
  }
});

test('spoken booking date and time become evidence under the original audio event id',async()=>{
  const r=await run({grounded:true,audio:true,scheduling:singleUnitScheduling,sessionMode:true,
    texts:['Oi','Quero agendar','Bronze Classico','[audio]','Maria'],transcript:'29/09/2099 as 10h',
    response:{action:'create_appointment',reply:'Certo',state:{...schedulingState,unit_id:'',unit_evidence:''}}});
  assert.equal(r.result.ok,true);assert.equal(r.saved.length,1);assert.equal(r.sent,1);
});

test('audio failures hand off once without inventing contents or creating bookings',async()=>{
  for(const audioFailure of ['download','format','transcription','truncated','silent','scope','long','persist']) {
    const r=await run({grounded:true,audio:true,texts:['[audio]'],audioFailure});
    assert.equal(r.sent,1,audioFailure);assert.equal(r.generated,0);assert.equal(r.saved.length,0);
    const outbound=r.events.find(e=>e.direction==='outbound');
    assert.equal(outbound.handoff,true);assert.match(outbound.ai_error,/audio_/);
    assert.equal(r.events.filter(e=>e.ai_error).length,1);
    assert.doesNotMatch(JSON.stringify(r.events),/private URL/);
  }
});

test('cached audio with a stored file is not downloaded or transcribed again',async()=>{
  const r=await run({grounded:true,audio:true,texts:['[audio]'],audioCache:{version:'whatsapp_audio_v1',status:'transcribed',text:'Quero bronze'},
    audioMedia:{kind:'audio',status:'stored',bucket:'channel-media',storagePath:'clinic/whatsapp/old.ogg'},
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.result.ok,true);assert.equal(r.generated,1);
  assert.ok(!r.calls.some(c=>c.url.includes('getBase64FromMediaMessage')||c.body?.contents?.[0]?.parts?.[0]?.inlineData));
});
test('legacy cached audio stays transcribed without direct Storage retry',async()=>{
  const r=await run({grounded:true,audio:true,texts:['[audio]'],audioCache:{version:'whatsapp_audio_v1',status:'transcribed',text:'Quero bronze'},
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.result.ok,true);assert.equal(r.generated,1);
  assert.ok(!r.calls.some(c=>c.url.includes('getBase64FromMediaMessage')));
  assert.ok(!r.calls.some(c=>c.url.includes('/storage/v1/object/channel-media/')));
  assert.ok(!r.calls.some(c=>c.url.includes('generateContent')&&c.body?.contents?.[0]?.parts?.[0]?.inlineData));
  assert.equal(r.events.some(e=>e.raw_payload?.media?.status==='stored'),false);
});

test('audio respects human lock, quota, batching and stale-turn fences',async()=>{
  const locked=await run({audio:true,texts:['[audio]'],history:[{handoff:true}]});
  assert.equal(locked.sent,0);assert.ok(!locked.calls.some(c=>c.url.includes('getBase64FromMediaMessage')));
  const exhausted=await run({audio:true,texts:['[audio]'],usage:{['gemini_clinic_'+new Date().toISOString().slice(0,10)]:80}});
  const exhaustedOutbound=exhausted.events.find(e=>e.direction==='outbound');
  assert.match(exhaustedOutbound.ai_error,/daily_limit_reached/);
  assert.equal(exhausted.events.filter(e=>e.ai_error).length,1);
  assert.ok(!exhausted.calls.some(c=>c.url.includes('getBase64FromMediaMessage')));
  const stale=await run({grounded:true,audio:true,texts:['[audio]'],stale:true,response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(stale.sent,0);assert.equal(stale.saved.length,0);assert.deepEqual(stale.finishes,['retry']);
  const batch=await run({audio:true,texts:['[audio]','[audio]','[audio]']});
  const inboundErrors = batch.events.filter(e => e.direction !== 'outbound' && e.ai_error);
  assert.equal(inboundErrors.length, 0);
  const batchOutbound = batch.events.find(e => e.direction === 'outbound');
  assert.equal(batchOutbound.ai_error, 'audio_batch_limit');
  assert.equal(batch.events.filter(e => e.ai_error).length, 1);
});

test('two audios retain both message IDs and produce only one answer',async()=>{
  const r=await run({grounded:true,audio:true,texts:['[audio]','[audio]'],response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.sent,1);assert.equal(r.generated,1);
  const audioPatches = r.events.filter(e => e.raw_payload?.audio_processing);
  assert.equal(audioPatches.length, 2);
  assert.equal(r.events.find(e => e.service)?.raw_payload, undefined);
});

test('transcriptions from previous turns remain available as evidence in the same session',async()=>{
  const r=await run({grounded:true,texts:['Oi'],history:[{id:'old-audio',direction:'inbound',message_text:'[audio]',created_at:'2026-09-29T10:00:00Z',
    raw_payload:{audio_transcriptions:{'old-audio':{version:'whatsapp_audio_v1',status:'transcribed',text:'Quero bronze'}}}}],
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  const input=r.calls.find(c=>c.url.includes('generateContent')).body.contents[0].parts[0].text;
  assert.match(input,/Quero bronze/);assert.doesNotMatch(input,/\[audio\]/);
});

test('single unit accepts Sim, Sexta-feira and Jacuacanga without demanding unit evidence',async()=>{
  for(const text of ['Sim','Sexta-feira','Jacuacanga']) {
    const r=await run({grounded:true,scheduling:singleUnitScheduling,texts:[text],
      response:{action:'reply',reply:'Qual servico voce deseja?',state:{...blankState,unit_id:'angra',unit_evidence:'missing'}}});
    assert.equal(r.result.ok,true);assert.equal(r.events[0].handoff,false);
    assert.doesNotMatch(r.calls.find(c=>c.url.includes('sendText')).body.text,/regi|Rio/);
  }
});

test('single unit books without customer region text while preserving all other evidence checks',async()=>{
  const r=await run({grounded:true,scheduling:singleUnitScheduling,texts:schedulingTexts.slice(0,5),
    response:{action:'create_appointment',reply:'Certo',state:{...schedulingState,unit_id:'',unit_evidence:''}}});
  assert.equal(r.saved.length,1);assert.equal(r.events[0].handoff,false);
  assert.equal(r.calls.find(c=>c.url.includes('magia_reserve_appointment')).body.p_unit,'angra');
});

test('optional follow-up failure never changes a successfully sent reply to human handoff',async()=>{
  // Unimplemented follow-up RPC in this harness deliberately throws.
  const r=await run({texts:['Oi'],response:'Como posso ajudar?'});
  assert.equal(r.result.ok,true);assert.equal(r.sent,1);assert.equal(r.result.follow_ups_scheduled,0);
  assert.ok(r.result.follow_up_error);assert.deepEqual(r.finishes,['done']);
  assert.ok(!r.events.some(e=>e.service==='technical_error'));
});

const archivedBooking={id:'old-booking',status:'confirmed',starts_at:'2099-09-28T13:00:00Z',created_at:'2025-01-01',
  contact_name:'OLD_CUSTOMER',metadata:{conversation_session_id:'initial',service_id:'bronze',unit_id:'angra'}};
const closedYesterday=()=>new Date(Date.now()-86400000).toISOString();

test('fresh attendance excludes archived history and previous future appointments',async()=>{
  const r=await run({grounded:true,closeAt:closedYesterday(),texts:['Oi'],appointments:[archivedBooking],
    history:[{id:'old-event',created_at:'2025-01-01',direction:'inbound',message_text:'OLD_CUSTOMER Angra'}],
    response:{action:'reply',reply:'Como posso ajudar?',state:blankState}});
  assert.equal(r.generated,1);assert.equal(r.sent,1);
  assert.doesNotMatch(JSON.stringify(r.calls.find(c=>c.url.includes('generateContent')).body),/OLD_CUSTOMER|old-booking|old-event/);
  assert.equal(r.saved.length,0);
});

test('another booking for the same customer uses session RPC and preserves the previous booking',async()=>{
  const r=await run({grounded:true,scheduling,sessionMode:true,closeAt:closedYesterday(),texts:schedulingTexts,
    appointments:[archivedBooking],response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,1);
  const call=r.calls.find(c=>c.url.includes('magia_reserve_session_appointment'));
  assert.equal(call.body.p_session,'close-1');
  assert.ok(!r.calls.some(c=>c.method==='PATCH'&&new URL(c.url).pathname.endsWith('/appointments')));
});

test('payment after closing never changes an appointment from the previous attendance',async()=>{
  const r=await run({closeAt:closedYesterday(),texts:['SINAL PAGO'],appointments:[{...archivedBooking,status:'pending_payment'}]});
  assert.equal(r.saved.length,0);assert.equal(r.sent,1);assert.equal(r.events[0].handoff,true);
});

test('multiple pending reservations require human payment matching',async()=>{
  const r=await run({texts:['SINAL PAGO'],appointments:[{...archivedBooking,status:'pending_payment'},
    {...archivedBooking,id:'another',status:'pending_payment'}]});
  assert.equal(r.saved.length,0);assert.equal(r.events[0].stage,'Verificar Sinal');
});

test('explicit prior reference can recover one verified same-contact booking without old bot prose',async()=>{
  const r=await run({grounded:true,closeAt:closedYesterday(),texts:['Meu agendamento anterior'],appointments:[archivedBooking]});
  assert.equal(r.generated,0);assert.equal(r.sent,1);assert.equal(r.events[0].handoff,false);
  assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/confirmado/);
});

test('missing or ambiguous previous context has a warm handoff, never guesses',async()=>{
  for(const appointments of [[],[archivedBooking,{...archivedBooking,id:'another'}]]) {
    const r=await run({grounded:true,texts:['Falei ontem com voces'],appointments});
    assert.equal(r.generated,0);assert.equal(r.events[0].handoff,true);
    assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/momentinho/);
  }
});

test('reference to another contact never searches private archived appointments',async()=>{
  const r=await run({grounded:true,texts:['Falei pelo outro numero'],appointments:[archivedBooking]});
  assert.equal(r.events[0].handoff,true);assert.equal(r.generated,0);
  assert.ok(!r.calls.some(c=>new URL(c.url).pathname.endsWith('/appointments')&&!c.url.includes('starts_at=')));
});

test('close racing the claimed turn cancels it without a response or new human lock',async()=>{
  const r=await run({closeAt:closedYesterday(),boundaryChanged:true});
  assert.equal(r.sent,0);assert.equal(r.generated,0);assert.equal(r.events.length,0);
  assert.deepEqual(r.finishes,['cancelled']);
});

test('daily limit remains tenant-wide after closure, with a specific diagnostic and warm handoff',async()=>{
  const key='gemini_clinic_'+new Date().toISOString().slice(0,10);
  const usage={[key]:80};
  const r=await run({grounded:true,closeAt:closedYesterday(),texts:['Oi'],usage});
  assert.equal(r.generated,0);assert.equal(r.sent,1);assert.equal(usage[key],80);
  const outbound=r.events.find(e=>e.direction==='outbound');
  assert.equal(outbound.ai_error,'daily_limit_reached');
  assert.equal(r.events.filter(e=>e.ai_error).length,1);
  assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/momentinho/);
});
test('unit is asked before booking when customer has not selected a region',async()=>{
  const r=await run({grounded:true,scheduling,response:{action:'create_appointment',reply:'Certo',state:{...schedulingState,unit_id:'',unit_evidence:''}}});
  assert.equal(r.saved.length,0);assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/regi\u00e3o/);
});
test('capacity booking checks availability and uses atomic RPC, never plain appointment insert',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,1);assert.equal(r.result.appointment_id,'a-created');
  assert.ok(r.calls.find(c=>c.url.includes('magia_appointment_availability')));
  assert.equal(r.calls.find(c=>c.url.includes('magia_reserve_appointment')).body.p_unit,'angra');
  assert.ok(!r.calls.some(c=>c.method==='POST'&&c.url.endsWith('/appointments')));
  assert.equal(r.sent,1);
});
test('Núbia blocks only duplicate or overlapping future reservations before the reserve RPC',async()=>{
  const base={id:'existing',status:'pending_payment',starts_at:'2099-09-29T13:00:00Z',ends_at:'2099-09-29T14:30:00Z',metadata:{service_id:'bronze'}};
  const fullNameTexts=[...schedulingTexts];fullNameTexts[4]='Maria Souza';
  const fullNameState={...schedulingState,customer_name:'Maria Souza'};
  const duplicate=await run({tenantSlug:'clinica_nubia_oficial',grounded:true,scheduling,texts:fullNameTexts,appointments:[base],
    response:{action:'create_appointment',reply:'Certo',state:fullNameState}});
  assert.equal(duplicate.saved.length,0);
  assert.equal(duplicate.events.at(-1).handoff,true);
  assert.equal(duplicate.events.at(-1).raw_payload.appointment_creation.reason,'NB_DUPLICATE_FUTURE_APPOINTMENT');
  const separate=await run({tenantSlug:'clinica_nubia_oficial',grounded:true,scheduling,texts:fullNameTexts,
    appointments:[{...base,starts_at:'2099-09-30T13:00:00Z',ends_at:'2099-09-30T14:30:00Z'}],
    response:{action:'create_appointment',reply:'Certo',state:fullNameState}});
  assert.equal(separate.saved.length,1);
});
test('unavailable times produce alternatives without creating or promising a booking',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,available:['11:30','13:00'],response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,0);assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/11:30, 13:00/);
});

test('selected available time advances to name instead of repeating the slot menu',async()=>{
  for(const action of ['reply','check_availability','create_appointment']) {
    const r=await run({grounded:true,scheduling:singleUnitScheduling,texts:schedulingTexts,
      available:['10:00','11:30'],response:{action,reply:'Certo, 10:00. Qual seu nome completo?',
        state:{...schedulingState,customer_name:'',name_evidence:'',unit_id:'',unit_evidence:''}}});
    assert.equal(r.events[0].handoff,false);assert.equal(r.saved.length,0);
    const reply=r.calls.find(c=>c.url.includes('sendText')).body.text;
    assert.match(reply,/nome completo/);assert.doesNotMatch(reply,/Qual hor|11:30/);
  }
});

test('a selected valid time never licenses invented alternative times',async()=>{
  const r=await run({grounded:true,scheduling:singleUnitScheduling,texts:schedulingTexts,
    available:['10:00'],response:{action:'reply',reply:'Horarios disponiveis: 10:00, 18:20.',state:schedulingState}});
  const reply=r.calls.find(c=>c.url.includes('sendText')).body.text;
  assert.match(reply,/Posso registrar/);assert.doesNotMatch(reply,/18:20/);assert.equal(r.saved.length,0);
});

test('selecting Quero 15 ja falei is time evidence, not an age or service price',async()=>{
  for(const [text,valid] of [['Quero 15, ja falei',true],['Prefiro 15',true],['15',true],['Quero 15 dias',false],['Quero 15/10',false]]) {
    const r=await run({grounded:true,scheduling:singleUnitScheduling,
      texts:['Bronze Classico','29/09/2099',text],available:['15:00','16:30'],
      response:{action:'reply',reply:'Certo, 15:00. Qual seu nome?',state:{...blankState,
        service_id:'bronze',service_evidence:'e0',date:'2099-09-29',date_evidence:'e1',time:'15:00',time_evidence:'e2'}}});
    assert.equal(r.events[0].handoff,!valid,text);
    if(valid)assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/nome completo/);
  }
});

test('sequential service, date, selected time and name persist one pending reservation before payment',async()=>{
  const history=[];
  const choices=[
    {text:'Quero agendar Bronze Classico',action:'reply',reply:'Para qual dia?',state:{...blankState,service_id:'bronze',service_evidence:'e0'}},
    {text:'29/09/2099',action:'check_availability',reply:'',state:{...blankState,service_id:'bronze',service_evidence:'h0',date:'2099-09-29',date_evidence:'e0'}},
    {text:'15:00',action:'reply',reply:'Certo, 15:00. Qual seu nome completo?',state:{...blankState,service_id:'bronze',service_evidence:'h0',date:'2099-09-29',date_evidence:'h1',time:'15:00',time_evidence:'e0'}},
    {text:'Maria Souza',action:'create_appointment',reply:'',state:{...blankState,service_id:'bronze',service_evidence:'h0',date:'2099-09-29',date_evidence:'h1',time:'15:00',time_evidence:'h2',customer_name:'Maria Souza',name_evidence:'e0'}},
  ];
  let booking;
  for(const [i,choice] of choices.entries()) {
    const r=await run({grounded:true,scheduling:singleUnitScheduling,sessionMode:true,history,texts:[choice.text],
      available:['15:00','16:30'],response:{action:choice.action,reply:choice.reply,state:choice.state}});
    assert.equal(r.result.ok,true);assert.equal(r.sent,1);assert.equal(r.events[0].handoff,false);
    const reply=r.calls.find(c=>c.url.includes('sendText')).body.text;
    if(i===1)assert.match(reply,/15:00, 16:30/);
    if(i===2){assert.match(reply,/nome completo/);assert.doesNotMatch(reply,/16:30/);}
    if(i<3)assert.equal(r.saved.length,0);
    else {assert.equal(r.saved.length,1);booking=r.saved[0];assert.equal(booking.status,'pending_payment');assert.match(reply,/pendente/);}
    history.push({id:'h'+i,direction:'inbound',message_text:choice.text,created_at:new Date(Date.now()-5000+ i).toISOString()});
    history.push({id:'a'+i,direction:'outbound',message_text:reply,created_at:new Date(Date.now()-4999+i).toISOString(),raw_payload:{grounding:{revision:'canonical_v2',prompt_revision:'test-v2'}}});
  }
  const paid=await run({grounded:true,texts:['SINAL PAGO'],appointments:[{...booking,created_at:new Date().toISOString()}]});
  assert.equal(paid.saved[0].status,'payment_reported');assert.equal(paid.events[0].stage,'Verificar Sinal');
  assert.equal(paid.sent,1);assert.equal(paid.generated,0);
  assert.equal(paid.calls.find(c=>c.url.includes('sendText')).body.text,'Ta bom! Vou confirmar aqui, um momento');
});
test('model cannot offer invented plural horarios disponiveis or infer the weekday grid',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,available:['11:30'],response:{action:'reply',reply:'Temos horarios disponiveis as 15:00 e 16:30.',state:schedulingState}});
  const reply=r.calls.find(c=>c.url.includes('sendText')).body.text;
  assert.match(reply,/11:30/);assert.doesNotMatch(reply,/15:00|16:30/);assert.equal(r.saved.length,0);
});
test('failed availability consult escalates without fallback to unchecked insert',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,availabilityError:true,response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,0);assert.equal(r.events[0].handoff,true);
});
test('last place lost after consultation is not falsely confirmed',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,failAppointment:true,response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,0);assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/indispon\u00edvel/);
});
test('selected Rio location is exact reference only, Angra address never leaks into it',async()=>{
  const facts={locations:[{id:'angra',address:'Angra official street',verified:true},{id:'rio',address:'Salao Esthefany Campos. Em frente ao colegio Nazira, ao lado da confeccao de roupa.',verified:true}]};
  const r=await run({grounded:true,scheduling,businessFacts:facts,texts:['Qual o endereco do Rio?']});
  assert.equal(r.generated,0);const reply=r.calls.find(c=>c.url.includes('sendText')).body.text;
  assert.match(reply,/Salao Esthefany/);assert.doesNotMatch(reply,/Angra/);
});
test('close boundary cannot reuse the region from an old attendance',async()=>{
  const r=await run({grounded:true,scheduling,businessFacts:{locations:[]},texts:['Qual o endereco?']});
  assert.equal(r.generated,0);assert.equal(r.saved.length,0);
  assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/regi\u00e3o/);
});
test('unknown address never invokes a model or invents a street',async()=>{
  const r=await run({grounded:true,texts:['Qual o endereco?']});
  assert.equal(r.generated,0);assert.equal(r.events[0].handoff,true);
  assert.doesNotMatch(r.calls.find(c=>c.url.includes('sendText')).body.text,/Flores|123|Sao Paulo/);
});
test('verified address is returned verbatim without model generation',async()=>{
  const address='Avenida Oficial, 200 - Cidade Oficial';
  const r=await run({grounded:true,texts:['Onde fica?'],businessFacts:{locations:[{name:'Unidade',address,verified:true}]}});
  assert.equal(r.generated,0);assert.equal(r.events[0].handoff,false);
  assert.ok(r.calls.find(c=>c.url.includes('sendText')).body.text.includes(address));
});
test('full customer history survives twelve events and old hallucinated replies are excluded',async()=>{
  const history=[{id:'old-name',direction:'inbound',message_text:'Meu nome e Maria Antiga',created_at:'2026-09-20T10:00:00Z'},
    {id:'wrong',direction:'outbound',message_text:'Rua das Flores 123',created_at:'2026-09-20T10:00:10Z'},
    ...Array.from({length:25},(_,i)=>({id:'old'+i,direction:'inbound',message_text:'duvida '+i,created_at:'2026-09-20T11:00:00Z'}))];
  const r=await run({grounded:true,texts:['Eu ja falei'],history,response:{action:'reply',reply:'Certo, Maria. Vamos continuar.',state:blankState}});
  const req=r.calls.find(c=>c.url.includes('generateContent'));
  assert.equal(req.body.system_instruction.parts[0].text,'ONLY CANONICAL TENANT PROMPT');
  const data=JSON.parse(req.body.contents[0].parts[0].text);
  assert.equal(data.customer_messages[0].id,'old-name');
  assert.doesNotMatch(req.body.contents[0].parts[0].text,/Rua das Flores/);
  assert.ok(!r.calls.some(c=>c.url.includes('/ai_agents')));
});
test('structured booking uses catalog and customer evidence, not prose tags',async()=>{
  const r=await run({grounded:true,response:{action:'create_appointment',reply:'Vou registrar.',state:{
    customer_name:'Maria',service_id:'bronze',date:'2099-09-29',time:'10:00',name_evidence:'e4',service_evidence:'e2',date_evidence:'e3',time_evidence:'e3'}}});
  assert.equal(r.saved[0]?.status,'pending_payment');assert.equal(r.result.appointment_id,'a-created');
});
test('unsupported booking evidence, imaginary price and false registration fail closed',async()=>{
  for(const output of [
    {action:'create_appointment',reply:'Pronto',state:{...blankState,customer_name:'Nome inventado',name_evidence:'e0'}},
    {action:'reply',reply:'Seu agendamento esta confirmado',state:blankState},
    {action:'reply',reply:'O valor e R$ 80,00',state:blankState},
    {action:'reply',reply:'Minha memoria falhou, pode me lembrar?',state:blankState},
  ]) {
    const r=await run({grounded:true,response:output});assert.equal(r.saved.length,0);assert.equal(r.events[0].handoff,true);
    const outbound = r.events.find(e => e.direction === 'outbound'); assert.ok(outbound?.raw_payload?.grounding?.blocked_reason);
  }
});
test('unrequested invented address in generated prose is replaced with official facts',async()=>{
  const r=await run({grounded:true,texts:['Ola'],response:{action:'reply',reply:'Estamos na Rua das Flores 123',state:blankState},
    businessFacts:{locations:[{name:'Unidade',address:'Endereco aprovado',verified:true}]}});
  const sent=r.calls.find(c=>c.url.includes('sendText')).body.text;
  assert.match(sent,/Endereco aprovado/);assert.doesNotMatch(sent,/Flores/);
});
test('untranscribed audio escalates instead of pretending to understand',async()=>{
  const r=await run({grounded:true,texts:['[audio]','Pode me ajudar?']});assert.equal(r.generated,0);assert.equal(r.events[0].handoff,true);
});
test('answer about an existing booking uses database status, never imaginary confirmation',async()=>{
  const r=await run({grounded:true,texts:['Esta confirmado?'],appointments:[{id:'existing',status:'pending_payment',title:'Bronze Classico',starts_at:'2099-09-29T13:00:00Z'}],
    response:{action:'reply',reply:'Seu agendamento esta confirmado',state:blankState}});
  const sent=r.calls.find(c=>c.url.includes('sendText')).body.text;
  assert.match(sent,/aguardando o pagamento/);assert.doesNotMatch(sent,/confirmado/);assert.equal(r.saved.length,0);
});
test('context overflow escalates rather than silently losing previous booking details',async()=>{
  const r=await run({grounded:true,texts:['oi'],history:Array.from({length:251},(_,i)=>({id:'old'+i,direction:'inbound',message_text:'info',created_at:'2026-09-20T10:00:00Z'}))});
  assert.equal(r.generated,0);assert.equal(r.events[0].handoff,true);
});

test('regression A: text + audio in same turn ensures text event never receives audio_processing or transcriptions',async()=>{
  const r=await run({grounded:true,audio:true,texts:['[audio]','por favor agende'],
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.result.ok,true);
  const audioPatch = r.events.find(e => e.raw_payload?.audio_processing);
  assert.ok(audioPatch, 'audio event must receive audio_processing');
  assert.equal(audioPatch.raw_payload.audio_processing.text, 'Quero bronze');
  // Batch patch for inbound messages must NEVER include raw_payload
  const batchPatch = r.events.find(e => e.service);
  assert.equal(batchPatch.raw_payload, undefined, 'batch patch must never contain raw_payload');
  // Inbound messages must never receive synthetic audio_transcriptions map
  assert.ok(!r.events.some(e => e.raw_payload?.audio_transcriptions), 'no audio_transcriptions map on inbound events');
});

test('regression B: audio event preserves content_type, audio_metadata and audio_processing',async()=>{
  const r=await run({grounded:true,audio:true,texts:['[audio]'],
    response:{action:'reply',reply:'Para qual dia?',state:blankState}});
  assert.equal(r.result.ok,true);
  const audioPatch = r.events.find(e => e.raw_payload?.audio_processing);
  assert.ok(audioPatch);
  assert.equal(audioPatch.raw_payload.content_type, 'audio');
  assert.equal(audioPatch.raw_payload.audio_metadata.seconds, 10);
  assert.equal(audioPatch.raw_payload.audio_processing.status, 'transcribed');
  assert.equal(audioPatch.raw_payload.audio_processing.text, 'Quero bronze');
});

test('regression F: 5 grouped messages with 1 failure produce exactly 1 logical ai_error, never 5 copies',async()=>{
  const todayKey = new Date().toISOString().slice(0,10);
  const r=await run({texts:['m0','m1','m2','m3','m4'],usage:{['gemini_clinic_'+todayKey]:80}});
  // The batch patch across all 5 messages must NOT replicate ai_error across all messages
  const batchPatch = r.events.find(e => e.service);
  assert.equal(batchPatch.ai_error, undefined, 'batch patch must not replicate ai_error');
  // Inbound messages must NOT receive top-level ai_error (only outbound/processing event carries it)
  const inboundErrors = r.events.filter(e => e.direction !== 'outbound' && e.ai_error);
  assert.equal(inboundErrors.length, 0, 'zero inbound records of ai_error');
  // Outbound assistant event records ai_error
  const outbound = r.events.find(e => e.direction === 'outbound');
  assert.equal(outbound?.ai_error, 'daily_limit_reached', 'outbound event carries ai_error');
  // Total events with top-level ai_error must be exactly 1
  const totalErrors = r.events.filter(e => e.ai_error);
  assert.equal(totalErrors.length, 1, 'exactly 1 top-level event with ai_error');
});

test('regression H: core build preserves non-destructive saveEvent without batch raw_payload',async()=>{
  const generatedCode = fs.readFileSync(path.join(__dirname,'../../n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
  assert.ok(generatedCode.includes('async function saveEvent(event)'), 'saveEvent must exist in generated code');
  assert.ok(!generatedCode.includes('audio_transcriptions:turn.audio_transcriptions'), 'destructive audio_transcriptions map must not be re-introduced in saveEvent');
  assert.ok(generatedCode.includes('// CRÍTICO: NUNCA incluir raw_payload aqui'), 'non-destructive saveEvent comments must be present');
});

test('exclusion A: contact_exclusion_enabled=false allows normal AI operation', async () => {
  const r = await run({ contactExclusionEnabled: false });
  assert.equal(r.result.ok, true);
  assert.equal(r.generated, 1);
  assert.equal(r.sent, 1);
});

test('exclusion B: contact_exclusion_enabled=true + RPC blocked=false allows normal AI operation', async () => {
  const r = await run({
    contactExclusionEnabled: true,
    contactExclusion: { blocked: false, reason: 'not_excluded', resolved_phone: '5511111111111' },
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.generated, 1);
  assert.equal(r.sent, 1);
});

test('exclusion C: contact_exclusion_enabled=true + RPC blocked=true blocks AI and sends no external messages', async () => {
  const r = await run({
    contactExclusionEnabled: true,
    contactExclusion: { blocked: true, reason: 'contact_excluded', resolved_phone: '5511999999999' },
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.result.skipped, true);
  assert.equal(r.result.reason, 'contact_excluded');
  assert.equal(r.generated, 0, 'Gemini must never be called');
  assert.equal(r.sent, 0, 'Evolution must never send message to customer');
  assert.ok(r.finishes.includes('done'), 'turn must be finished with complete(done)');
  const exclusionEvent = r.events.find(e => e.service === 'contact_excluded');
  assert.ok(exclusionEvent, 'contact_excluded event must be recorded');
  assert.equal(exclusionEvent.handoff, true);
  assert.equal(exclusionEvent.stage, 'Atendimento humano');
  assert.equal(exclusionEvent.ai_provider, 'contact_exclusion');
});

test('exclusion D: contact exclusion RPC failure fails closed with no customer response', async () => {
  const r = await run({
    contactExclusionEnabled: true,
    failExclusion: true,
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.result.skipped, true);
  assert.equal(r.result.reason, 'contact_exclusion_unavailable');
  assert.equal(r.generated, 0);
  assert.equal(r.sent, 0);
  assert.ok(r.finishes.includes('done'));
  const exclusionEvent = r.events.find(e => e.service === 'contact_excluded');
  assert.ok(exclusionEvent);
  assert.equal(exclusionEvent.service, 'contact_excluded');
});

test('exclusion F: status changes to excluded before send triggers second barrier in sendChannelMessage', async () => {
  const r = await run({
    contactExclusionEnabled: true,
    contactExclusion: { blocked: false, reason: 'not_excluded' },
    exclusionBeforeSend: { blocked: true, reason: 'contact_excluded_race', resolved_phone: '5511999999999' },
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.sent, 0, 'outbound send must be aborted before provider call');
  assert.equal(r.result.cancelled, true);
  assert.equal(r.result.reason, 'contact_excluded_race');
  const raceEvent = r.events.find(e => e.service === 'contact_excluded');
  assert.ok(raceEvent, 'must record exclusion when second barrier blocks');
  assert.equal(raceEvent.handoff, true);
  assert.equal(raceEvent.stage, 'Atendimento humano');
});

test('exclusion G: contact_exclusion_enabled + useCore=false causes Selecionar Motor to throw and block legacy fallback', async () => {
  const selectCode = fs.readFileSync(path.join(__dirname, '../../n8n/code/whatsapp_select_core.js'), 'utf8');
  const selectFn = new AsyncFunction('$json', '$env', selectCode);
  const context = {
    helpers: {
      httpRequest: async ({ url }) => {
        if (url.includes('/rest/v1/tenants')) return [{ id: 't-1', status: 'active' }];
        if (url.includes('/rest/v1/tenant_settings')) {
          return [{
            settings: {
              contact_exclusion_enabled: true,
              whatsapp_processing_mode: 'legacy',
            },
          }];
        }
        return [];
      }
    }
  };

  await assert.rejects(
    async () => {
      await selectFn.call(context, { tenant_slug: 'genesis' }, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' });
    },
    /Contact exclusions require the guarded conversation core; legacy fallback blocked/
  );
});

test('session boundary regression: a human lock before conversation_closed cannot silence the new attendance', async () => {
  const closeAt='2026-10-05T18:51:39.000Z';
  const r=await run({texts:['Oi, novo atendimento'],response:'Olá! Como posso ajudar?',closeAt,history:[
    {id:'old-human',direction:'outbound',sender_type:'human',message_text:'Atendimento humano anterior',created_at:'2026-10-05T18:50:20.000Z',raw_payload:{}}
  ]});
  assert.equal(r.result.ok,true);
  assert.equal(r.result.skipped,undefined);
  assert.equal(r.sent,1);
  assert.equal(r.generated,1);
});

test('session boundary regression: a new audio transcript after closing is processed in its own attendance', async () => {
  const closeAt='2026-10-05T18:51:39.000Z';
  const r=await run({texts:['[audio]'],audio:true,transcript:'teste',response:'Áudio recebido. Como posso ajudar?',closeAt,history:[
    {id:'old-ai',direction:'outbound',ai_provider:'rules',message_text:'Resposta antiga',created_at:'2026-10-05T18:50:20.000Z',raw_payload:{}}
  ]});
  assert.equal(r.result.ok,true);
  assert.equal(r.sent,1);
  assert.equal(r.generated,1);
  assert.ok(r.events.some(event=>event.raw_payload?.audio_processing?.text==='teste'));
});
