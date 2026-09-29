const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const code = fs.readFileSync(path.join(__dirname,'../n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const execute = new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code);
const services=[{external_id:'bronze',category:'Bronze',name:'Bronze Classico',description:'Bronze em maquina',price:99.99,billing_unit:'sessao',notes:'',active:true}];

async function run({ texts=['Oi','Quero agendar','Bronze Classico','29/09/2099 as 10h','Maria'], response='Perfeito [ACAO: CRIAR_AGENDAMENTO|nome=Maria|servico=Bronze Classico|data=2099-09-29|hora=10:00|duracao=120|status=pending_payment]', history=[], appointments=[], stale=false, sendError=false, failAppointment=false, closeAt=null, enabled=true, grounded=false, businessFacts={}, scheduling=null, available=['10:00'], availabilityError=false, sessionMode=false, usage={}, boundaryChanged=false }={}) {
  const calls=[]; const events=[]; const saved=[]; const finishes=[]; let sent=0; let generated=0;
  const input={tenant_id:'t-clinic',tenant_slug:'clinic',remoteJid:'5511111111111@s.whatsapp.net',instance:'clinic'};
  const environment={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_ENABLED:'true',GEMINI_API_KEY:'fake',
    EVOLUTION_API_URL_CLINIC:'https://evo.test',EVOLUTION_API_KEY_CLINIC:'fake',EVOLUTION_INSTANCE_CLINIC:'clinic'};
  const settings={whatsapp_processing_mode:enabled?'conversation_core_v1':'',ai_model:'gemini-2.5-flash-lite',ai_enabled:true,
    system_prompt:'Atendente da clinica',payment_signal_enabled:true,appointment_payment_trigger:'SINAL PAGO',
    payment_signal_ack_message:'Ta bom! Vou confirmar aqui, um momento',payment_signal_confirmation_message:'Reserva efetuada!',
    default_ai_appointment_status:'pending_payment',timezone:'America/Sao_Paulo',service_categories:['bronze'],gemini_daily_limit:80};
  if (grounded) Object.assign(settings,{grounding_mode:'canonical_v2',ai_model:'gemini-2.5-flash',
    system_prompt:'ONLY CANONICAL TENANT PROMPT',prompt_revision:'test-v2',business_facts:businessFacts});
  if (scheduling) settings.appointment_scheduling = scheduling;
  if (sessionMode) settings.attendance_lifecycle = 'session_v2';
  const request=async ({method,url,body})=>{
    const u=new URL(url);calls.push({method,url,body});
    if(u.hostname==='evo.test'){sent++;if(sendError)throw Error('timeout');return {key:{id:'sent-1'}};}
    if(u.hostname==='generativelanguage.googleapis.com'){generated++;return {candidates:[{content:{parts:[{text:typeof response==='object'?JSON.stringify(response):response}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:10}};}
    assert.equal(u.hostname,'db.test');
    const table=u.pathname.split('/').at(-1);
    if(table==='magia_claim_turn')return {claimed:true,token:'claim-1',boundary_id:closeAt?'close-1':'initial',messages:texts.map((text,i)=>({event_id:'e'+i,id:'m'+i,text,name:'Cliente',received_at:new Date(Date.now()-1000).toISOString()}))};
    if(table==='magia_commit_turn')return stale?{committed:false,reason:'new_messages'}:{committed:true};
    if(table==='magia_finish_turn'){finishes.push(body.p_outcome);return {finished:true};}
    if(table==='magia_appointment_availability'){if(availabilityError)throw Error('RPC unavailable');return {available_starts:available};}
    if(['magia_reserve_appointment','magia_reserve_session_appointment'].includes(table)){
      if(failAppointment)throw Error('SLOT_UNAVAILABLE');
      const a={id:'a-created',status:'pending_payment',starts_at:body.p_date+'T13:00:00Z',metadata:{unit_id:body.p_unit}};
      saved.push(a);return a;
    }
    if(table==='tenants')return [{id:'t-clinic',slug:'clinic',status:'active',name:'Clinica'}];
    if(table==='tenant_settings')return [{timezone:'America/Sao_Paulo',settings}];
    if(table==='ai_agents')return [{model:'gemini-2.5-flash-lite',max_tokens:500,temperature:0.45}];
    if(table==='channels')return [{external_id:'clinic'}];
    if(table==='tenant_service_catalog'||table==='search_tenant_service_catalog')return services;
    if(table==='channel_events'){
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
  const result=await execute.call({helpers:{httpRequest:request}},input,environment,{},()=>usage);
  return {result:result.json,calls,events,saved,finishes,sent,generated};
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

const scheduling=JSON.parse(fs.readFileSync(path.join(__dirname,'../clients/clinica_nubia_oficial/scheduling.json')));
const singleUnitScheduling=structuredClone(scheduling);
// Generic multi-unit behavior must remain supported, independent of the clinic's current catalog.
scheduling.units.rio={...structuredClone(scheduling.units.angra),name:'Rio',aliases:['rio']};
scheduling.service_resources.bronze='classico';
singleUnitScheduling.service_resources.bronze='classico';
const schedulingState={...blankState,customer_name:'Maria',service_id:'bronze',date:'2099-09-29',time:'10:00',
  name_evidence:'e4',service_evidence:'e2',date_evidence:'e3',time_evidence:'e3',unit_id:'angra',unit_evidence:'e5'};
const schedulingTexts=['Oi','Quero agendar','Bronze Classico','29/09/2099 as 10h','Maria','Angra'];

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
  assert.equal(r.events[0].ai_error,'daily_limit_reached');
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
test('unavailable times produce alternatives without creating or promising a booking',async()=>{
  const r=await run({grounded:true,scheduling,texts:schedulingTexts,available:['11:30','13:00'],response:{action:'create_appointment',reply:'Certo',state:schedulingState}});
  assert.equal(r.saved.length,0);assert.match(r.calls.find(c=>c.url.includes('sendText')).body.text,/11:30, 13:00/);
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
    assert.ok(r.events[0].raw_payload.grounding.blocked_reason);
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
