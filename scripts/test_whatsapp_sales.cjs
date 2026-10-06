const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const sales=JSON.parse(fs.readFileSync(path.join(root,'clients/wesley_automoveis/sales.json')));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'clients/wesley_automoveis/estoque_referencia.json'))).vehicles;
const stock='/*O_o*/\ngoogle.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{
  cols:['MODELO','MARCA','PRECO','COR','KM','ANO','COMBUSTIVEL'].map(label=>({label})),
  rows:inventory.map(v=>({c:[v.model,v.brand,v.price_cents/100,v.color,v.km,v.year,v.fuel].map(v=>({v}))}))}})+');';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const code=fs.readFileSync(path.join(root,'n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const blank={intent:'unknown',transaction_mode:'unknown',customer_name:'',name_evidence:'',product_id:'',product_evidence:'',product_variant_evidence:'',deposit_cents:null,deposit_evidence:'',
  intent_evidence_id:'',
  sell_brand:'',sell_model:'',sell_year:null,sell_brand_evidence:'',sell_model_evidence:'',sell_year_evidence:'',
  sell_vehicle:{brand:'',model:'',year:null,raw_mention:'',description_summary:'',reported_facts:[],concerns:[],maintenance_history:[],evidence_ids:[],
    maintenance_reported:false,maintenance_evidence_ids:[],condition_reported:false,condition_evidence_ids:[]},
  buy_interest:{brand:'',model:'',year:null,raw_mention:'',product_id:'',evidence_ids:[]}};
const selected={...blank,intent:'buy',transaction_mode:'buy',customer_name:'Maria Souza',name_evidence:'e1',product_id:'renault|sandero gt line|2016|branco',
  product_evidence:'e0',deposit_cents:1289400,deposit_evidence:'e2'};

function validateFollowUpJobsTableOperation(method, u, body) {
  const allowedColumns = new Set([
    'id', 'tenant_id', 'policy_id', 'channel_type', 'external_conversation_id',
    'contact_name', 'anchor_event_id', 'step_key', 'objective', 'due_at',
    'status', 'lease_token', 'locked_until', 'attempt_count', 'sent_event_id',
    'error', 'created_at', 'updated_at'
  ]);
  const allowedStatuses = new Set(['pending', 'processing', 'sent', 'cancelled', 'failed', 'uncertain']);
  if (body && typeof body === 'object') {
    for (const col of Object.keys(body)) {
      if (!allowedColumns.has(col)) {
        throw new Error(`column "${col}" of relation "follow_up_jobs" does not exist`);
      }
    }
    if (body.status && !allowedStatuses.has(body.status)) {
      throw new Error(`new row for relation "follow_up_jobs" violates check constraint "follow_up_jobs_status_check"`);
    }
  }
  return [{ id: 'job', status: body?.status || 'cancelled' }];
}

async function run({texts=['Quero Sandero GT Line','Maria Souza','Entrada de R$ 12.894,00'],
  response={action:'register_interest',reason:'none',reply:'',state:selected},
  lead=null,history=[],stale=false,stockError=false,priceChanged=false,humanRace=false,disabled=false,
  collect=false,media=false,ocr=null,imageClassification='vehicle_photo',visualKinds=null,visualFinishReason='STOP',documents=[],sendError=false,inboundPayloads={},mediaPatchFailure=false,teamAgents=undefined,contactName='Maria',contact=null,
  followUpEnabled=false,salesFollowUp=null,followUpFailure=false,followUpJobsScheduled=1,
  audioEnabled=false,audioTranscript='teste',boundary=null,boundaryId=boundary?'close-1':'initial',businessFacts=null}={}) {
  const calls=[],sent=[],saved=[];let generated=0,reads=0,currentLead=lead;
  const settings={conversation_capability:'sales_v1',whatsapp_processing_mode:'conversation_core_v1',grounding_mode:'canonical_v2',
    system_prompt:'Sales test',ai_model:'gemini-3.5-flash-lite',ai_enabled:!disabled,gemini_daily_limit:80,whatsapp_audio_enabled:audioEnabled,
    business_facts:businessFacts||{locations:[{verified:true,address:'Endereco oficial'}]},
    sdr_rules:{hot_lead_percent:30,minimum_purchase_year:1995,rejected_purchase_brands:['Peugeot','Citroen']},
    sales:{...sales,collect_documents:collect},
    follow_up_enabled:followUpEnabled,
    ...(salesFollowUp?{sales_follow_up:salesFollowUp}:{})};
  const request=async({url,method,body})=>{
    calls.push({url,method,body});const u=new URL(url),table=u.pathname.split('/').at(-1);
    assert.ok(!/appointments|appointment_/.test(u.pathname),'Sales cannot access appointments');
    if(u.hostname==='docs.google.com'){reads++;if(stockError)throw Error('PRIVATE_ERROR');return priceChanged&&reads>1?stock.replace('42980','42981'):stock;}
    if(u.hostname==='evo.test') {
      if(u.pathname.includes('getBase64'))return texts.some(text=>text==='[audio]')
        ? {mimetype:'audio/ogg',base64:Buffer.from('OggS test audio').toString('base64')}
        : {mimetype:'image/jpeg',base64:Buffer.from('fake-jpeg').toString('base64')};
      if(sendError)throw Error('timeout');sent.push(body.text);return {key:{id:'out'}};
    }
    if(u.hostname==='generativelanguage.googleapis.com'){
      if(body.system_instruction?.parts?.[0]?.text?.includes('Transcreva fielmente')) {
        return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({intelligible:true,text:audioTranscript})}]}}]};
      }
      if(body.contents[0].parts[0].inlineData) {
        const visual=body.contents[0].parts[1]?.text?.includes('Classifique visualmente');
        const batch=body.contents[0].parts.at(-1)?.text?.includes('Classifique cada imagem');
        const count=body.contents[0].parts.filter(part=>part.inlineData).length;
        const kinds=visualKinds===null?Array.from({length:count},(_,i)=>Array.isArray(imageClassification)?imageClassification[i]:imageClassification):visualKinds;
        return {candidates:[{finishReason:batch?visualFinishReason:'STOP',content:{parts:[{text:JSON.stringify(batch?{kinds}:visual?{kind:imageClassification}:(ocr||{kind:'document',name:'Maria',cpf:'',cnh:'12345678901',birth_date:''}))}]}}]};
      }
      generated++;return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]};
    }
    if(table==='tenants')return [{id:'tenant-sales',slug:'sales',status:'active',name:'Sales'}];
    if(table==='tenant_settings')return [{settings}];
    if(table==='channels')return [{external_id:'sales-instance'}];
    if(table==='contacts')return contact ? [contact] : [];
    if(table==='team_agents')return teamAgents !== undefined ? teamAgents : [{id:'2b927dd1-8f69-4b33-9bdf-6abc2968c1cf',name:'Wesley',role:'Atendente'}];
    if(table==='magia_claim_turn')return {claimed:true,token:'token',boundary_id:boundaryId,messages:texts.map((text,i)=>({id:'m'+i,event_id:'e'+i,text,received_at:new Date().toISOString(),contact_name:contactName}))};
    if(table==='magia_commit_turn')return {committed:!stale,reason:stale?'new_messages':undefined};
    if(table==='magia_finish_turn')return {};
    if(table==='magia_schedule_followups') {
      if(followUpFailure) throw Error('FOLLOWUP_RPC_FAILED');
      return followUpJobsScheduled;
    }
    if(table==='sales_leads')return currentLead?[humanRace?{...currentLead,revision:99}:currentLead]:[];
    if(table==='sales_documents')return documents;
    if(table==='magia_sales_save'){
      if(humanRace)throw Error('SALES_CONTROL_CHANGED');
      const hot=body.p_state.deposit_cents*100>=body.p_product?.price_cents*30;
      const stage=body.p_register?(body.p_state.intent==='sell'?sales.stage_keys.appraisal:hot?sales.stage_keys.hot:sales.stage_keys.human):body.p_stage;
      currentLead={id:'lead-1',revision:1,stage_key:stage,state:body.p_state,ai_locked:!sales.stages[stage].allow_ai,interest_registered:body.p_register};
      saved.push(body);return currentLead;
    }
    if(table==='magia_sales_reopen_correction'){
      currentLead={...(currentLead||{id:'lead-1',revision:0}),revision:(currentLead?.revision||0)+1,ai_locked:false,
        state:{...(currentLead?.state||{}),intent:body.p_new_intent,transaction_mode:body.p_new_intent}};
      saved.push({table:'magia_sales_reopen_correction',...body});
      return currentLead;
    }
    if(table==='channel_events'){
      const idParam = u.searchParams.get('id');
      if(method==='PATCH') {
        if(mediaPatchFailure && body.raw_payload?.sales_media) {
          throw Error('DB media patch failed');
        }
        if(idParam && idParam.startsWith('eq.')) {
          const id = idParam.slice(3);
          if(inboundPayloads[id]) {
            inboundPayloads[id] = { ...inboundPayloads[id], ...body.raw_payload };
          }
        }
        return [{id:'event'}];
      }
      if(method==='GET'&&idParam) {
        const id = idParam.startsWith('eq.') ? idParam.slice(3) : idParam;
        const raw = inboundPayloads[id] || {};
        return [{id, external_message_id: id.replace('e','m'), raw_payload: raw}];
      }
      if(method!=='GET')return [{id:'event'}];
      if(u.searchParams.get('or')?.includes('conversation_closed'))return boundary?[boundary]:[];
      if(u.searchParams.get('or')?.includes('sender_type.eq.human'))return [];
      const after=String(u.searchParams.get('created_at')||'').replace(/^gt\./,'');
      return history.filter(row=>!after||!row.created_at||Date.parse(row.created_at)>Date.parse(after)).reverse();
    }
    if(table==='follow_up_jobs') return validateFollowUpJobsTableOperation(method, u, body);
    throw Error('Unexpected '+table);
  };
  const result=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code).call({helpers:{httpRequest:request}},
    {tenant_slug:'sales',tenant_id:'tenant-sales',remoteJid:'5511999999999@s.whatsapp.net',instance:'sales-instance'},
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_ENABLED:'true',GEMINI_API_KEY:'fake',
      EVOLUTION_API_URL_SALES:'https://evo.test',EVOLUTION_API_KEY_SALES:'fake',EVOLUTION_INSTANCE_SALES:'sales-instance'}, {},()=>({}));
  return {result:result.json,calls,saved,sent,generated};
}

async function completedBuyAndSellCatalogChoice() {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_model:'Siena',sell_model_evidence:'e0',sell_year:2014,sell_year_evidence:'e0',
    sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2014,evidence_ids:['e0'],maintenance_reported:true,maintenance_evidence_ids:['e1'],condition_reported:true,condition_evidence_ids:['e1']}};
  const history=[
    {id:'e0',direction:'inbound',message_text:'Quero vender meu Siena 2014 e comprar outro carro',raw_payload:{}},
    {id:'e1',direction:'inbound',message_text:'A manutenção está em dia e não há avarias',raw_payload:{}},
    {id:'e2',direction:'inbound',message_text:'[image]',raw_payload:{sales_media:[{event_id:'e2',kind:'vehicle_photo',readable:true}]}}
  ];
  const catalog=await run({texts:['quais veículos vocês têm?'],lead:{id:'lead-1',revision:0,stage_key:'sales_qualifying',state,ai_locked:false},history,
    response:{action:'catalog',reason:'none',reply:'',state}});
  const catalogPayload=catalog.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(catalogPayload.pending_requirement,'purchase_product');
  return run({texts:['5'],lead:{id:'lead-1',revision:1,stage_key:'sales_qualifying',state:catalog.saved[0].p_state,ai_locked:false},
    history:[...history,{id:'a0',direction:'outbound',ai_provider:'sales_core',message_text:catalog.sent[0],raw_payload:catalogPayload}],
    response:{action:'reply',reason:'none',reply:'Certo',state:catalog.saved[0].p_state}});
}

async function enqueueCore(input, out = {}) {
  const enqueue=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_enqueue_core.js'),'utf8'));
  let queued; const events = [];
  const res = await enqueue.call({helpers:{httpRequest:async request=>{
    if (request.url.includes('/channel_events')) { events.push(request.body); return [{ id: 'evt-1' }]; }
    queued=request.body;return { queued: true };
  }}},input,
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'});
  out.result = res?.json;
  out.events = events;
  return queued;
}

const sanderoReferral={source:'external_ad_reply',title:'Renault Sandero GT Line 2016',body:'Confira as condições',source_id:'ad-123',source_url:'https://fb.me/ad-123',media_type:'image'};

test('sales registers an interest with exact 30% score, no appointments',async()=>{
  const r=await run();assert.equal(r.result.ok,true);assert.equal(r.saved[0].p_register,true);
  assert.equal(r.result.handoff,true);
  assert.equal(r.result.lead_id,'lead-1');assert.match(r.sent[0],/Seu interesse foi registrado/);
});
test('selected vehicle and entry retain evidence across separate messages',async()=>{
  const r=await run({
    texts:['Quero Sandero GT Line','Entrada de R$ 12.894,00','Maria Souza'],
    response:{action:'register_interest',reason:'none',reply:'',state:{...selected,name_evidence:'e2',deposit_evidence:'e1'}}
  });
  assert.equal(r.saved[0].p_state.customer_name,'Maria Souza');
  assert.equal(r.saved[0].p_state.product_id,'renault|sandero gt line|2016|branco');
  assert.equal(r.saved[0].p_state.deposit_cents,1289400);
});
test('vehicle model shorthand and split variant evidence do not cause a handoff',async()=>{
  const r=await run({texts:['Quero o Sandero','branco 2016','Entrada de R$ 12.894,00','Maria Souza'],
    response:{action:'register_interest',reason:'none',reply:'',state:{...selected,product_evidence:'e0',product_variant_evidence:'e1'}}});
  assert.equal(r.saved[0].p_product.model.toUpperCase(),'SANDERO GT LINE');
  assert.equal(r.saved[0].p_state.product_variant_evidence,'e1');assert.equal(r.result.handoff,false);
});
test('verified price at the end of a sentence is not treated as an invented value',async()=>{
  const r=await run({response:{action:'reply',reason:'none',reply:'O valor dele e R$ 42.980,00',state:selected}});
  assert.equal(r.result.ok,true);assert.equal(r.sent[0],'O valor dele e R$ 42.980,00');
});
test('new messages or human transition discard all commercial side effects',async()=>{
  const stale=await run({stale:true});assert.equal(stale.result.skipped,true);assert.equal(stale.saved.length,0);
  const race=await run({humanRace:true});assert.equal(race.result.ok,false);assert.equal(race.result.skipped,true);
});
test('locked or disabled sales does not generate, download stock or respond to reset',async()=>{
  const locked=await run({lead:{id:'lead-1',revision:0,stage_key:'sales_human',state:selected,ai_locked:true}});
  assert.equal(locked.generated,0);assert.equal(locked.sent.length,0);assert.equal(locked.result.human_lock,true);
  const disabled=await run({disabled:true});assert.equal(disabled.generated,0);assert.equal(disabled.sent.length,0);
});
test('after-sales is persisted and silent',async()=>{
  const r=await run({texts:['O carro que comprei quebrou'],response:{action:'handoff',reason:'after_sales',reply:'',state:{...blank,intent:'after_sales'}}});
  assert.equal(r.sent.length,0);assert.equal(r.saved[0].p_stage,'sales_after_sales');assert.equal(r.result.handoff,true);
});
test('stock failure, invalid prices and unsupported booking actions fail to human',async()=>{
  const variants=[{stockError:true},{response:{action:'create_appointment',reason:'none',reply:'',state:blank}},
    {response:{action:'reply',reason:'none',reply:'Custa R$ 1,00',state:blank}}];
  for(const flags of variants){const r=await run(flags);assert.equal(r.saved[0].p_register,false);assert.equal(r.result.handoff,true);}
});
test('ambiguous PCX in inventory without color or year clears candidate and continues qualifying without human handoff',async()=>{
  const r=await run({texts:['Quero PCX'],response:{action:'reply',reason:'none',reply:'Certo',state:{...blank,product_id:'honda|pcx|2023|branca',product_evidence:'e0'}}});
  assert.equal(r.saved[0].p_register,false);
  assert.equal(r.result.handoff,false, 'tolerant validation keeps qualifying without human handoff');
});
test('price changed during registration does not confirm an interest at stale price',async()=>{
  const r=await run({priceChanged:true});assert.equal(r.saved[0].p_register,false);assert.doesNotMatch(r.sent[0],/foi registrado/);
});
test('CPF/CNH required by tenant do not disappear behind a register action',async()=>{
  const r=await run({collect:true});assert.equal(r.saved[0].p_register,false);assert.match(r.sent[0],/CNH/);
});
test('document extraction is saved privately, not in commercial model context',async()=>{
  const r=await run({texts:['[document]'],response:{action:'reply',reason:'none',reply:'Qual veiculo te interessa?',state:blank}});
  assert.equal(r.saved[0].p_documents[0].extracted.cnh,'12345678901');
  const commercial=r.calls.find(c=>c.url.includes('generateContent')&&!c.body.contents[0].parts[0].inlineData);
  assert.ok(!JSON.stringify(commercial.body).includes('12345678901'));
  assert.ok(!JSON.stringify(r.calls.filter(c=>c.url.includes('/channel_events')&&c.method!=='GET')).includes('12345678901'));
});
test('document captions do not bypass document extraction and prior photos remain available for appraisal',async()=>{
  const image=await run({texts:['[document]\nMinha CNH'],response:{action:'reply',reason:'none',reply:'Qual veiculo te interessa?',state:blank}});
  assert.equal(image.saved[0].p_documents.length,1);
  const state={...blank,intent:'sell',transaction_mode:'sell',customer_name:'Maria Souza',name_evidence:'e3',sell_brand:'Fiat',sell_brand_evidence:'e0',
    sell_model:'Uno',sell_model_evidence:'e1',sell_year:2010,sell_year_evidence:'e2',
    sell_vehicle:{brand:'Fiat',model:'Uno',year:2010,raw_mention:'',description_summary:'',reported_facts:[],concerns:[],maintenance_history:[],evidence_ids:['e0','e1','e2']}};
  const photo=await run({texts:['Fiat','Uno','2010','Maria Souza'],
    lead:{id:'lead-1',revision:1,stage_key:'sales_qualifying',state,ai_locked:false},
    history:[{id:'intent',direction:'inbound',message_text:'Quero vender meu Uno',raw_payload:{}},
      {id:'old',direction:'inbound',message_text:'[image]',created_at:new Date().toISOString(),
      raw_payload:{sales_media:[{event_id:'old',kind:'vehicle_photo',readable:false}]}}],
    response:{action:'register_interest',reason:'none',reply:'',state}});
  assert.equal(photo.saved[0].p_register,false);
  assert.match(photo.sent[0],/Para começarmos a avaliação do Uno|envie mais fotos/);
});
test('unreadable documents never invent identity fields',async()=>{
  const r=await run({texts:['[document]'],ocr:{kind:'document',name:'',cpf:'',cnh:'',birth_date:''}});
  assert.equal(r.generated,0);assert.equal(r.result.handoff,true);assert.equal(r.saved[0].p_documents.length,0);
});
test('buy-and-sell with a textual purchase model asks for sale model when sale model is missing',async()=>{
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_vehicle:{brand:'',model:'',year:null,raw_mention:'',description_summary:'',reported_facts:[],concerns:[],maintenance_history:[],evidence_ids:[]},
    buy_interest:{brand:'',brand_evidence:'',model:'Corsa',model_evidence:'e0',year:null,year_evidence:'',
      raw_mention:'quero vender esse e comprar um corsa',product_id:'',evidence_ids:['e0']}};
  const r=await run({texts:['Quero vender meu carro e comprar um corsa'],
    response:{action:'reply',reason:'none',reply:'Qual é o modelo do veículo que deseja vender?',state}});
  assert.equal(r.saved[0].p_state.transaction_mode,'buy_and_sell');
  assert.equal(r.saved[0].p_state.buy_interest.model,'Corsa');
  assert.equal(r.saved[0].p_stage,'sales_qualifying');
  assert.equal(r.result.handoff,false);
  assert.match(r.sent[0],/modelo do ve[íi]culo que você quer vender/);
});
test('a persisted purchase model survives a later photo-only sale message and qualifies appraisal',async()=>{
  const persisted={...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_vehicle:{brand:'Fiat',model:'Siena',year:2010,raw_mention:'',description_summary:'',reported_facts:[],concerns:[],maintenance_history:[],evidence_ids:['e-prior-1']},
    buy_interest:{brand:'',brand_evidence:'',model:'Corsa',model_evidence:'e-prior-0',year:null,year_evidence:'',
      raw_mention:'quero comprar um corsa',product_id:'',evidence_ids:['e-prior-0']}};
  const candidate={...persisted};
  const r=await run({texts:['[image]'],lead:{id:'lead-1',revision:0,stage_key:'sales_qualifying',state:persisted,ai_locked:false},
    history:[
      {id:'e-prior-0',direction:'inbound',message_text:'Quero comprar um corsa',created_at:new Date().toISOString(),raw_payload:{}},
      {id:'e-prior-1',direction:'inbound',message_text:'Tenho Siena 2010',created_at:new Date().toISOString(),raw_payload:{}}
    ],
    response:{action:'reply',reason:'none',reply:'Certo',state:candidate}});
  assert.equal(r.saved[0].p_state.buy_interest.model,'Corsa');
  assert.equal(r.saved[0].p_state.sell_vehicle.model,'Siena');
  assert.equal(r.saved[0].p_stage,'sales_qualifying');
  assert.equal(r.result.handoff,false);
});
test('a vehicle photo alone cannot create a sale identity without evidence',async()=>{
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_brand:'Fiat',sell_brand_evidence:'e0',sell_model:'Siena',sell_model_evidence:'e0',sell_year:2005,sell_year_evidence:'e0',
    sell_vehicle:{brand:'',model:'',year:null,raw_mention:'',description_summary:'',reported_facts:[],concerns:[],maintenance_history:[],evidence_ids:['e0']},
    buy_interest:{brand:'',brand_evidence:'',model:'',model_evidence:'',year:null,year_evidence:'',raw_mention:'',product_id:'',evidence_ids:[]}};
  const r=await run({texts:['[image]'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const outbound=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(r.saved[0].p_state.intent,'unknown');
  assert.equal(r.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(r.saved[0].p_state.sell_model,'');
  assert.equal(r.saved[0].p_state.sell_vehicle.model,'');
  assert.equal(r.saved[0].p_state.sell_vehicle.year,null);
  assert.equal(r.saved[0].p_stage,'sales_new');
  assert.equal(outbound.body.raw_payload.pending_requirement,undefined);
  assert.equal(r.sent[0],'Recebi a foto. Como posso ajudar você?');
  assert.equal(r.result.handoff,false);
});
test('clear buy-and-sell qualifies trade-in and appraisal instead of immediate human handoff',async()=>{
  const state=(brand='Fiat')=>({...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_brand:brand,sell_brand_evidence:'e0',sell_model:brand==='Peugeot'?'208':'Siena',sell_model_evidence:'e1',sell_year:2007,sell_year_evidence:'e2',
    sell_vehicle:{brand,model:brand==='Peugeot'?'208':'Siena',year:2007,raw_mention:'',description_summary:'Sem avarias',reported_facts:['manutencao ok'],concerns:[],maintenance_history:['revisado'],evidence_ids:['e0','e1','e2']},
    buy_interest:{brand:'',brand_evidence:'',model:'Corsa',model_evidence:'e3',year:null,year_evidence:'',raw_mention:'quero comprar um corsa',product_id:'',evidence_ids:['e3']}});
  const r=await run({texts:['Fiat','Siena','2007','Corsa'],history:[{id:'intent',direction:'inbound',message_text:'Quero vender meu Siena e comprar um Corsa',raw_payload:{}}],response:{action:'reply',reason:'none',reply:'Certo',state:state('Fiat')}});
  assert.equal(r.saved[0].p_stage,'sales_qualifying');
  assert.equal(r.result.handoff,false);
  assert.match(r.sent[0],/Siena/);
});
test('assistant text payload never inherits an inbound media envelope',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_core_overrides.js'),'utf8'),context);
  const payload=context.textReplyAuditPayload({
    media:{kind:'image',bucket:'channel-media',storagePath:'tenant/inbound.jpg'},
    magia_normalized:{media:{kind:'image',url:'https://example.test/customer.jpg'}},
    data:{message:{imageMessage:{url:'https://example.test/customer.jpg'}}},
    sales_lead_id:'lead-1',sales_revision:2,
  });
  assert.equal(payload.media,undefined);
  assert.equal(payload.magia_normalized,undefined);
  assert.equal(payload.data,undefined);
  assert.equal(payload.sales_lead_id,'lead-1');
  assert.equal(payload.sales_revision,2);
  assert.equal(payload.message_origin,'assistant_text_reply');
});
test('split seller details are accepted and excluded brands are not registered',async()=>{
  const state={...blank,intent:'sell',sell_brand:'Peugeot',sell_brand_evidence:'e0',sell_model:'208',sell_model_evidence:'e1',sell_year:2020,sell_year_evidence:'e2'};
  const r=await run({texts:['Peugeot','208','2020'],history:[{id:'intent',direction:'inbound',message_text:'Quero vender meu carro',raw_payload:{}}],response:{action:'register_interest',reason:'none',reply:'',state}});
  assert.equal(r.saved[0].p_register,false);assert.match(r.sent[0],/não se enquadra/);
});
test('inventory typed numbers are preserved, duplicate identities fail closed',()=>{
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const rows=context.salesParseInventory(stock);assert.equal(rows.length,6);assert.equal(rows[4].price_cents,4298000);
  assert.equal(context.salesAmount('Entrada de R$ 12.894,00'),1289400);
  assert.equal(context.salesAmount('Tenho 15 mil'),1500000);
  assert.equal(context.salesAmount('Nao tenho 15 mil'),null);
  assert.equal(context.salesAmount('entrada 30%'),null);
  const data=JSON.parse(stock.slice(stock.indexOf('(')+1,-2));
  data.table.rows.push(data.table.rows[0]);
  assert.throws(()=>context.salesParseInventory('google.visualization.Query.setResponse('+JSON.stringify(data)+');'),/AMBIGUOUS_INVENTORY_ID/);
});
test('pending onboarded channel cannot enter legacy fallback; existing legacy tenant still can',async()=>{
  const selector=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_select_core.js'),'utf8'));
  const input={tenant_slug:'legacy',instance:'new-instance',tenant_resolution:{source:'env_fallback'}};
  const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'};
  const helpers={httpRequest:async({url})=>url.includes('/channels?')?[{status:'pending',config:{onboarding_package:'wesley'}}]:[]};
  await assert.rejects(selector.call({helpers},input,env),/do not use fallback/);
  helpers.httpRequest=async({url})=>url.includes('/channels?')?[]:url.includes('/tenants?')?[{id:'legacy',status:'active'}]:[{settings:{}}];
  const legacy=await selector.call({helpers},input,env);assert.equal(legacy.json.use_conversation_core,false);
  helpers.httpRequest=async({url})=>url.includes('/tenants?')?[{id:'sales',status:'active'}]:[{settings:{conversation_capability:'sales_v1',whatsapp_processing_mode:'conversation_core_v1'}}];
  const commercial=await selector.call({helpers},{...input,tenant_slug:'sales',tenant_resolution:{source:'channels.external_id'}},env);
  assert.equal(commercial.json.core_sales,true);
});
test('media queue markers change only for sales capability',async()=>{
  const enqueue=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_enqueue_core.js'),'utf8'));
  for(const sales of [false,true]) {
    let queued;
    await enqueue.call({helpers:{httpRequest:async request=>{queued=request.body;return {};}}},
      {core_sales:sales,core_quiet_ms:8000,core_fragment_ms:12000,messageText:'Minha CNH',
        raw_payload:{data:{message:{imageMessage:{}}}}},
      {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'});
    assert.equal(queued.p_message.text,sales?'[image]\nMinha CNH':'Minha CNH');
  }
});

test('regression C: document + text in same turn ensures text never receives sales_media or document data',async()=>{
  const inboundPayloads = {
    e0: { content_type: 'document', original_id: 'doc_123' },
    e1: { content_type: 'text', original_id: 'txt_456' },
  };
  await run({
    texts: ['[document]\nMinha CNH', 'Seguem meus dados para analise'],
    collect: true,
    ocr: { kind: 'document', name: 'Maria Souza', cpf: '', cnh: '12345678901', birth_date: '' },
    inboundPayloads,
  });
  assert.ok(inboundPayloads.e0.sales_media, 'document event must receive sales_media');
  assert.equal(inboundPayloads.e0.sales_media[0].kind, 'document');
  assert.equal(inboundPayloads.e0.original_id, 'doc_123', 'original fields must be preserved');
  assert.equal(inboundPayloads.e1.sales_media, undefined, 'text event must never receive sales_media');
  assert.equal(inboundPayloads.e1.original_id, 'txt_456', 'text event original fields preserved');
});

test('regression D: photo event isolates sales_media strictly to photo event',async()=>{
  const inboundPayloads = {
    e0: { content_type: 'image', custom_tag: 'front_photo' },
    e1: { content_type: 'text', custom_tag: 'comment' },
  };
  await run({
    texts: ['[image]', 'Segue a foto do meu carro'],
    history: [{id:'a0',direction:'outbound',message_text:'Envie uma foto do veículo.',raw_payload:{pending_requirement:'vehicle_photo'}}],
    response: { action: 'register_interest', reason: 'none', reply: 'Recebi a foto', state: selected },
    inboundPayloads,
  });
  assert.ok(inboundPayloads.e0.sales_media, 'photo event must receive sales_media');
  assert.equal(inboundPayloads.e0.sales_media[0].kind, 'vehicle_photo');
  assert.equal(inboundPayloads.e0.custom_tag, 'front_photo');
  assert.equal(inboundPayloads.e1.sales_media, undefined, 'text event must not receive sales_media');
  assert.equal(inboundPayloads.e1.custom_tag, 'comment');
});

test('regression E: custom unknown fields in inbound raw_payload are 100% preserved after processing',async()=>{
  const inboundPayloads = {
    e0: {
      content_type: 'image',
      custom_crm_sync_id: 'crm_987654',
      webhook_received_timestamp: 1727900000,
      extra_vendor_metadata: { source: 'campaign_alpha', click_id: 'clk_111' },
    },
  };
  await run({
    texts: ['[image]'],
    response: { action: 'register_interest', reason: 'none', reply: 'Obrigado', state: selected },
    inboundPayloads,
  });
  assert.equal(inboundPayloads.e0.custom_crm_sync_id, 'crm_987654');
  assert.equal(inboundPayloads.e0.webhook_received_timestamp, 1727900000);
  assert.deepEqual(inboundPayloads.e0.extra_vendor_metadata, { source: 'campaign_alpha', click_id: 'clk_111' });
  assert.ok(inboundPayloads.e0.sales_media);
});

test('regression G: salesVehiclePhotoCount correctly recovers individual photo classifications from history',async()=>{
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const history = [
    { id: 'ev_photo_1', raw_payload: { sales_media: [{ event_id: 'ev_photo_1', kind: 'vehicle_photo', readable: true }] } },
    { id: 'ev_text_2', raw_payload: { message_text: 'texto sem midia' } },
    { id: 'ev_doc_3', raw_payload: { sales_media: [{ event_id: 'ev_doc_3', kind: 'document', readable: true }] } },
    { id: 'ev_photo_4', raw_payload: { sales_media: [{ event_id: 'ev_photo_4', kind: 'vehicle_photo', readable: true }] } },
  ];
  const count = context.salesVehiclePhotoCount(history, []);
  assert.equal(count, 2, 'must count exactly the 2 vehicle_photos, ignoring text and document');
});

// =========================================================================
// PARITY AND INTEGRITY REGRESSION SUITE (Items A through J)
// =========================================================================

test('parity A: buy_and_sell does not go directly to human, continues qualification', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'buy_and_sell',
    sell_vehicle: { brand: 'Fiat', model: 'Siena', year: 2010, raw_mention: 'Siena 2010', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
    buy_interest: { brand: 'Chevrolet', model: 'Corsa', year: null, raw_mention: 'Corsa', product_id: '', evidence_ids: ['e1'] },
  };
  const r = await run({
    texts: ['Quero vender meu Siena 2010 e comprar um Corsa'],
    response: { action: 'reply', reason: 'none', reply: 'Qual e o modelo?', state }
  });
  assert.equal(r.saved[0].p_state.transaction_mode, 'buy_and_sell');
  assert.notEqual(r.saved[0].p_stage, 'sales_human', 'must NOT route immediately to sales_human');
  assert.equal(r.saved[0].p_stage, 'sales_qualifying', 'stays in sales_qualifying');
  assert.equal(r.result.handoff, false, 'must not trigger human handoff lock');
});

test('parity B: sell_vehicle and buy_interest coexist in state', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'buy_and_sell',
    sell_vehicle: { brand: 'Fiat', model: 'Siena', year: 2010, raw_mention: 'Siena 2010', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
    buy_interest: { brand: 'Chevrolet', model: 'Corsa', year: null, raw_mention: 'Corsa', product_id: '', evidence_ids: ['e1'] },
  };
  const r = await run({
    texts: ['Tenho um Siena 2010 e quero comprar um Corsa'],
    response: { action: 'reply', reason: 'none', reply: 'Certo', state }
  });
  const savedState = r.saved[0].p_state;
  assert.equal(savedState.sell_vehicle.model, 'Siena');
  assert.equal(savedState.sell_vehicle.year, 2010);
  assert.equal(savedState.buy_interest.model, 'Corsa');
});

test('parity C: salesCorrectedIntent exists and triggers reopen correction when intent flips', async () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    salesModeFor: (s={}) => s.transaction_mode || s.intent || 'unknown'
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const corrected1 = context.salesCorrectedIntent('não quero vender, quero comprar', { state: { intent: 'sell', transaction_mode: 'sell' } });
  assert.equal(corrected1, 'buy');
  const corrected2 = context.salesCorrectedIntent('não quero comprar, quero vender', { state: { intent: 'buy', transaction_mode: 'buy' } });
  assert.equal(corrected2, 'sell');
  const noFlip = context.salesCorrectedIntent('quero financiar', { state: { intent: 'buy', transaction_mode: 'buy' } });
  assert.equal(noFlip, '');

  // Integration: lead locked in human reopened via salesCorrectedIntent
  const r = await run({
    texts: ['não quero vender, quero comprar Sandero'],
    lead: { id: 'lead-1', revision: 2, stage_key: 'sales_human', ai_locked: true, state: { intent: 'sell', transaction_mode: 'sell' } },
    response: { action: 'reply', reason: 'none', reply: 'Perfeito, vamos ver a compra!', state: selected }
  });
  const reopenCall = r.saved.find(s => s.table === 'magia_sales_reopen_correction');
  assert.ok(reopenCall, 'magia_sales_reopen_correction must be called');
  assert.equal(reopenCall.p_new_intent, 'buy');
});

test('parity D: salesPurchaseCandidate exists and selects candidate from inventory', () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const messages = [{ id: 'm1', text: 'Quero ver o Sandero GT Line 2016 branco' }];
  const match = context.salesPurchaseCandidate(messages, inventory);
  assert.ok(match.product, 'must find matching product');
  assert.equal(match.product.model.toUpperCase(), 'SANDERO GT LINE');
  assert.equal(match.evidenceId, 'm1');
});

test('parity E: salesPurchaseProductQuestion exists and formats options when multiple candidates exist', () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const parsedInv = context.salesParseInventory(stock);
  const messages = [{ id: 'm1', text: 'Tem PCX?' }];
  const question = context.salesPurchaseProductQuestion(messages, parsedInv);
  assert.match(question, /Encontrei estas op/i);
  assert.match(question, /BRANCA/i);
  assert.match(question, /PRATA/i);
});

test('parity F: salesValidate clears unproven fields tolerantly instead of throwing handoff error', () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    salesAmount: text => {
      const m = String(text||'').match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?)/);
      if (!m) return null;
      return Math.round(parseFloat(m[1].replace(/\./g,'').replace(',','.')) * 100);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const messages = [{ id: 'm1', text: 'Olá boa tarde' }];
  const rawResult = {
    action: 'reply',
    reply: 'Boa tarde! Como posso ajudar?',
    reason: 'none',
    state: {
      ...context.salesEmptyState(),
      customer_name: 'Carlos Fake',
      name_evidence: 'm1',
      deposit_cents: 500000,
      deposit_evidence: 'm1',
      product_id: 'nonexistent-id',
      product_evidence: 'm1'
    }
  };
  const validated = context.salesValidate(rawResult, messages, inventory);
  assert.equal(validated.state.customer_name, '', 'name without evidence is cleared');
  assert.equal(validated.state.deposit_cents, null, 'deposit without evidence is cleared');
  assert.equal(validated.state.product_id, '', 'product without evidence is cleared');
  assert.equal(validated.product, null);
});

test('parity G: source, generated core and generated workflow are identical', () => {
  const ts = require('../app/node_modules/typescript');
  function getFunctions(fileContent) {
    const ast = ts.createSourceFile('file.js', fileContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const map = new Map();
    ast.statements.filter(ts.isFunctionDeclaration).forEach(node => {
      map.set(node.name.text, node.getText(ast));
    });
    return map;
  }
  const wf = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/magia_whatsapp_evolution_mvp.json'), 'utf8'));
  const genCode = wf.nodes.find(n => n.name === 'Processar Conversa WhatsApp').parameters.jsCode;
  const genFuncs = getFunctions(genCode);
  const salesFuncs = getFunctions(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'));

  const targets = [
    'salesSchema','salesEmptyState','salesModeFor','salesMergeState','salesSanitizeSemanticState',
    'salesValidate','salesPurchaseCandidate','salesPurchaseProductQuestion','salesGenerate',
    'salesVehiclePhotoCount','salesDescriptionComplete','salesLastPendingRequirement',
    'salesBuyAndSellAcknowledgement','salesPendingRequirementReply','salesAppraisalDecision',
    'salesCorrectedIntent','salesClassifyImages','salesReadMedia','runSalesTurn'
  ];
  for (const name of targets) {
    assert.ok(genFuncs.has(name), name + ' must exist in generated workflow');
    assert.ok(salesFuncs.has(name), name + ' must exist in whatsapp_sales.js');
    const genNorm = genFuncs.get(name).replace(/\r?\n/g, '\n').trim();
    const srcNorm = salesFuncs.get(name).replace(/\r?\n/g, '\n').trim();
    assert.equal(genNorm, srcNorm, name + ' in generated workflow must be identical to sales.js');
  }

});

test('parity H: sales_media persistence failure throws SALES_MEDIA_PERSISTENCE_FAILED and does not send false confirmation', async () => {
  const r = await run({
    texts: ['[image]'],
    response: { action: 'reply', reason: 'none', reply: 'Foto recebida com sucesso!', state: selected },
    mediaPatchFailure: true
  });
  // Since saveEvent threw SALES_MEDIA_PERSISTENCE_FAILED before sendChannelMessage:
  assert.equal(r.result.ok, false, 'turn must fail');
  assert.equal(r.result.error, 'SALES_MEDIA_PERSISTENCE_FAILED', 'error must be typed SALES_MEDIA_PERSISTENCE_FAILED');
  assert.equal(r.sent.length, 0, 'no message confirming media registration is sent to client');
});

test('parity I: 1 logical turn error produces exactly 1 top-level ai_error event, never on inbound', async () => {
  const r = await run({ stockError: true });
  // Total events with top-level ai_error
  const channelEvents = r.calls.filter(c => c.url.includes('/channel_events') && ['POST', 'PATCH'].includes(c.method));
  const callsWithAiError = channelEvents.filter(c => c.body?.ai_error);
  assert.equal(callsWithAiError.length, 1, 'exactly 1 top-level event with ai_error');
  // Inbound batch patch must not have ai_error
  const batchPatch = channelEvents.find(c => c.method === 'PATCH' && c.url.includes('&id=in.('));
  assert.equal(batchPatch?.body?.ai_error, undefined, 'inbound batch patch must NOT have ai_error');
});

test('parity J: individual inbound raw_payload preserved without batch overwrite', async () => {
  const inboundPayloads = {
    e0: { custom_source: 'fb_ad_campaign_1', original_text: 'hello' },
    e1: { custom_source: 'fb_ad_campaign_2', original_text: 'world' }
  };
  await run({
    texts: ['Tenho Corsa', 'Quero Sandero'],
    inboundPayloads
  });
  assert.equal(inboundPayloads.e0.custom_source, 'fb_ad_campaign_1');
  assert.equal(inboundPayloads.e1.custom_source, 'fb_ad_campaign_2');
  assert.equal(inboundPayloads.e0.original_text, 'hello');
  assert.equal(inboundPayloads.e1.original_text, 'world');
});

// =========================================================================
// PRODUCTION BUG FIX SUITE (Bugs 1, 2, 3, 4 & Anti-Repetition & Corsa/Siena)
// =========================================================================

test('bug 1 & anti-repetition: IA pede descrição do veículo, cliente envia foto adicional -> não repete pergunta literalmente', async () => {
  const fiestaState = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model:'Fiesta Flex 1.6',sell_model_evidence:'e0',
    sell_vehicle: { brand: 'Ford', model: 'Fiesta Flex 1.6', year: 2012, raw_mention: 'Fiesta', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
  };
  const r = await run({
    texts: ['[image]'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero vender Fiesta Flex 1.6', created_at: '2026-10-03T10:00:00Z', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Recebi as fotos do Fiesta Flex 1.6. Agora me conte como está a manutenção e se há algum detalhe ou avaria.', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: {pending_requirement:'vehicle_description'} }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Recebi as fotos', state: fiestaState }
  });
  // Must NOT repeat the long maintenance prompt! Must acknowledge photo cleanly
  assert.match(r.sent[0],/já conta para a avaliação/i);
  assert.match(r.sent[0],/manutenção|avaria/i);
});

test('bug 1: IA pede buy_model, cliente pergunta "quais vocês têm?" -> catálogo com estoque permitido, buy_interest.model vazio', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'buy_and_sell',
    sell_vehicle: { brand: 'Fiat', model: 'Siena', year: 2007, raw_mention: 'Siena 2007', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
    buy_interest: { brand: '', model: '', year: null, raw_mention: '', product_id: '', evidence_ids: [] },
  };
  const r = await run({
    texts: ['quais vocês têm?'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero vender um Siena 2007 e comprar outro', created_at: '2026-10-03T10:00:00Z', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'E qual modelo de veículo você procura comprar?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: {} }
    ],
    response: { action: 'catalog', reason: 'none', reply: 'Aqui está nosso catálogo', state }
  });
  // Must respect action catalog! Must show inventory and NOT repeat "E qual modelo..."
  assert.equal(r.saved[0].p_state.buy_interest.model, '');
  assert.match(r.sent[0], /Qual deles chamou mais sua atenção?/);
  assert.ok(!r.sent[0].includes('E qual modelo de veículo você procura comprar?'));
});

test('bug 1: IA pede buy_model, cliente responde "Corsa" -> salva Corsa e não pergunta buy_model novamente', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'buy_and_sell',
    sell_vehicle: { brand: 'Fiat', model: 'Siena', year: 2007, raw_mention: 'Siena 2007', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
    buy_interest: { brand: 'Chevrolet', model: 'Corsa', year: null, raw_mention: 'Corsa', product_id: '', evidence_ids: ['e1'] },
  };
  const r = await run({
    texts: ['Corsa'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero vender um Siena 2007 e comprar outro', created_at: '2026-10-03T10:00:00Z', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'E qual modelo de veículo você procura comprar?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: {} }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Certo, Corsa!', state }
  });
  assert.equal(r.saved[0].p_state.buy_interest.model, 'Corsa');
  assert.ok(!r.sent[0].includes('E qual modelo de veículo você procura comprar?'));
});

test('bug 3: IA pede descrição, cliente responde manutenção/avaria útil -> requisito de descrição satisfeito', async () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    salesText: (v, max = 220) => typeof v === 'string' && v.trim().length <= max && !/[\n\[\]]/.test(v.trim()) ? v.trim() : '',
    salesTextList: v => Array.isArray(v) ? v.slice(0, 20) : [],
    salesModeFor: (s={}) => s.transaction_mode || s.intent || 'unknown'
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);

  // Useful maintenance description
  const stateUseful = {
    sell_vehicle: {
      model: 'Fiesta',
      maintenance_reported: true,
      maintenance_evidence_ids: ['e1'],
      condition_reported: false,
      condition_evidence_ids: []
    }
  };
  assert.equal(context.salesDescriptionComplete(stateUseful), true, 'Useful description must satisfy requirement');

  // Superficial only like "uso diário" must NOT be sufficient alone
  const stateSuperficial = {
    sell_vehicle: {
      model: 'Fiesta',
      maintenance_reported: false,
      maintenance_evidence_ids: [],
      condition_reported: false,
      condition_evidence_ids: []
    }
  };
  assert.equal(context.salesDescriptionComplete(stateSuperficial), false, 'Superficial only must NOT satisfy requirement');
});

test('bug 3: IA pede foto, cliente manda 1 foto válida do veículo -> requisito de foto satisfeito', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model:'Uno',sell_model_evidence:'e0',
    sell_vehicle: { brand: 'Fiat', model: 'Uno', year: 2010, raw_mention: 'Uno 2010', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'],
      maintenance_reported:true,maintenance_evidence_ids:['e0'],condition_reported:false,condition_evidence_ids:[] },
  };
  const r = await run({
    texts: ['[image]'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero vender Uno 2010 revisado sem avarias', created_at: '2026-10-03T10:00:00Z', raw_payload: {} }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Recebi', state }
  });
  // 1 photo + useful description completes appraisal
  assert.equal(r.saved[0].p_stage, 'sales_appraisal', 'must advance to sales_appraisal with 1 photo + description');
  assert.match(r.sent[0], /Obrigado pelas fotos e informa/);
});

test('bug 3: cliente manda imagem de CNH -> NÃO conta como vehicle_photo', async () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    salesText: (v, max = 220) => typeof v === 'string' && v.trim().length <= max && !/[\n\[\]]/.test(v.trim()) ? v.trim() : '',
    salesTextList: v => Array.isArray(v) ? v.slice(0, 20) : [],
    salesValidCpf: () => '',
    turn: {
      messages: [
        { event_id: 'e_doc_1', id: 'm1', text: '[image]\nFoto da minha CNH' }
      ]
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);
  const media = [{event_id:'e_doc_1',kind:'document',readable:false,extracted:{kind:'document'}}];
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, 'document', 'Document image must be classified as kind: document');
  assert.notEqual(media[0].kind, 'vehicle_photo', 'Document image must NOT be vehicle_photo');
  const count = context.salesVehiclePhotoCount([], media);
  assert.equal(count, 0, 'Document image must NOT count towards vehicle photos');
});

test('bug 3: cliente corrige Siena -> Palio -> foto vinculada à avaliação antiga não completa Palio', () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    salesText: (v, max = 220) => typeof v === 'string' && v.trim().length <= max && !/[\n\[\]]/.test(v.trim()) ? v.trim() : '',
    salesTextList: v => Array.isArray(v) ? v.slice(0, 20) : []
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);

  const history = [
    { id: 'e0', external_message_id: 'm0', message_text: 'Quero vender um Siena', raw_payload: {} },
    { id: 'e1', external_message_id: 'm1', message_text: '[image]', raw_payload: { sales_media: [{ event_id: 'e1', kind: 'vehicle_photo', readable: true }] } },
    { id: 'e2', external_message_id: 'm2', message_text: 'Na verdade não é um Siena, é um Palio', raw_payload: {} }
  ];

  // Appraisal for Palio anchored at e2
  const palioState = {
    sell_model_evidence: 'e2',
    sell_vehicle: { model: 'Palio', evidence_ids: ['e0','e2'] }
  };
  const countPalio = context.salesVehiclePhotoCount(history, [], palioState);
  assert.equal(countPalio, 0, 'Palio must NOT inherit the old Siena photo');

  // Siena anchored at e0 would count
  const sienaState = {
    sell_model_evidence: 'e0',
    sell_vehicle: { model: 'Siena', evidence_ids: ['e0'] }
  };
  const countSiena = context.salesVehiclePhotoCount(history, [], sienaState);
  assert.equal(countSiena, 1, 'Siena includes its own photo');
});

test('bug 4: estoque contém Siena, NÃO contém Corsa; cliente: "quero comprar Corsa e vender meu Siena" -> NÃO seleciona Siena como product_id de compra', () => {
  const context = vm.createContext({
    normalizeText: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), 'utf8'), context);

  // Stock has Siena, but DOES NOT have Corsa
  const stockWithSiena = [
    { id: 'fiat|siena|2010|prata', name: 'Fiat Siena', model: 'Siena', brand: 'Fiat', year: 2010, color: 'prata', price_cents: 2500000 }
  ];

  const messages = [
    { id: 'm1', text: 'Quero comprar um Corsa e vender meu Siena' }
  ];

  const state = {
    sell_vehicle: { model: 'Siena', evidence_ids: ['m1'] },
    buy_interest: { model: 'Corsa', evidence_ids: ['m1'] }
  };

  const match = context.salesPurchaseCandidate(messages, stockWithSiena, state);
  assert.equal(match.product, null, 'Must NOT select Siena as purchase candidate when customer is selling Siena');
  assert.equal(match.candidates.length, 0, 'No candidate should match Corsa from Siena stock');
});

test('catálogo + buy_and_sell: cliente quer vender Siena 2007 e comprar outro, depois "Quais vocês têm?" -> catálogo oficial, buy_interest.model vazio', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'buy_and_sell',
    sell_model:'Siena',sell_model_evidence:'e0',
    sell_vehicle: { brand: 'Fiat', model: 'Siena', year: 2007, raw_mention: 'Siena 2007', description_summary: '', reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: ['e0'] },
    buy_interest: { brand: '', model: '', year: null, raw_mention: '', product_id: '', evidence_ids: [] },
  };
  const r = await run({
    texts: ['Quais vocês têm?'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero vender um Siena 2007 e comprar outro carro', created_at: '2026-10-03T10:00:00Z', raw_payload: {} }
    ],
    response: { action: 'catalog', reason: 'none', reply: 'Catálogo', state }
  });
  assert.equal(r.saved[0].p_state.transaction_mode, 'buy_and_sell');
  assert.equal(r.saved[0].p_state.sell_vehicle.model, 'Siena');
  assert.equal(r.saved[0].p_state.sell_vehicle.year, 2007);
  assert.equal(r.saved[0].p_state.buy_interest.model, '');
  assert.ok(r.sent[0].includes('Qual deles chamou mais sua atenção?'));
  assert.ok(!r.sent[0].includes('E qual modelo de veículo você procura comprar?'));
});

test('required Corsa/Siena matrix keeps buy evidence field-specific inside one event', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const message=[{id:'m1',text:'quero comprar Corsa e vender meu Siena'}];
  const state={sell_vehicle:{model:'Siena',evidence_ids:['m1']},buy_interest:{model:'Corsa',raw_mention:'comprar Corsa',evidence_ids:['m1']}};
  const corsa={id:'gm|corsa|2005|prata',name:'GM Corsa',model:'Corsa',brand:'GM',year:2005,color:'prata',price_cents:2000000};
  const siena={id:'fiat|siena|2010|prata',name:'Fiat Siena',model:'Siena',brand:'Fiat',year:2010,color:'prata',price_cents:2500000};
  assert.equal(context.salesPurchaseCandidate(message,[corsa,siena],state).product.id,corsa.id);
  assert.equal(context.salesPurchaseCandidate(message,[siena],state).product,null);
  assert.equal(context.salesPurchaseCandidate(message,[corsa],state).product.id,corsa.id);
});

test('required image safety: CNH, uncertain image and classifier failure never satisfy vehicle_photo', async () => {
  for (const imageClassification of ['document','uncertain','invalid']) {
    const inboundPayloads={e0:{original:'image'}};
    const r=await run({texts:['[image]'],imageClassification,inboundPayloads,
      response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
    const item=inboundPayloads.e0.sales_media[0];
    assert.notEqual(item.kind,'vehicle_photo');
    if (imageClassification==='document') {
      assert.equal(item.kind,'document');
      assert.equal(item.readable,true);
      assert.equal(r.saved[0].p_documents.length,1);
    } else {
      assert.equal(item.readable,false);
      assert.equal(r.saved[0].p_documents.length,0);
    }
  }
});

test('required model anchor uses latest current-model evidence and accepts only later Palio photo', () => {
  const context=vm.createContext({
    normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
  });
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const history=[
    {id:'e0',message_text:'Siena',raw_payload:{}},
    {id:'e1',message_text:'[image]',raw_payload:{sales_media:[{event_id:'e1',kind:'vehicle_photo',readable:true}]}},
    {id:'e2',message_text:'na verdade é um Palio',raw_payload:{}},
    {id:'e3',message_text:'[image]',raw_payload:{sales_media:[{event_id:'e3',kind:'vehicle_photo',readable:true}]}}
  ];
  const state={sell_model_evidence:'e2',sell_vehicle:{model:'Palio',evidence_ids:['e0','e2']}};
  assert.equal(context.salesVehiclePhotoCount(history.slice(0,3),[],state),0);
  assert.equal(context.salesVehiclePhotoCount(history,[],state),1);
});

test('required semantic description needs an evidenced model decision, never string length', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  assert.equal(context.salesDescriptionComplete({sell_vehicle:{
    maintenance_reported:true,maintenance_evidence_ids:['e1'],condition_reported:false,condition_evidence_ids:[]
  }}),true);
  assert.equal(context.salesDescriptionComplete({sell_vehicle:{
    description_summary:'este é um texto longo sem informação concreta sobre a condição do veículo',
    maintenance_reported:false,maintenance_evidence_ids:[],condition_reported:false,condition_evidence_ids:[]
  }}),false);
  assert.equal(context.salesDescriptionComplete({sell_vehicle:{
    description_summary:'uso diário',maintenance_reported:false,maintenance_evidence_ids:[],condition_reported:false,condition_evidence_ids:[]
  }}),false);
});

test('required pending_requirement is persisted and controls anti-repetition structurally', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell',sell_brand:'Fiat',sell_brand_evidence:'e0',
    sell_model:'Uno',sell_model_evidence:'e0',sell_vehicle:{...blank.sell_vehicle,brand:'Fiat',model:'Uno',evidence_ids:['e0'],
      maintenance_reported:false,maintenance_evidence_ids:[],condition_reported:false,condition_evidence_ids:[]}};
  const r=await run({texts:['Uno'],history:[{id:'intent-0',direction:'inbound',message_text:'Quero vender meu Uno',raw_payload:{}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const outbound=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.pending_requirement,'vehicle_description');
  const next=await run({texts:['[image]'],history:[{id:'intent-0',direction:'inbound',message_text:'Quero vender meu Uno',raw_payload:{}},{id:'e0',direction:'inbound',message_text:'Uno',raw_payload:{}},
    {id:'a0',direction:'outbound',message_text:'texto livre não usado para decidir',raw_payload:{pending_requirement:'vehicle_description'}}],
    response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.match(next.sent[0],/já conta para a avaliação/i);
  assert.match(next.sent[0],/manutenção|avaria/i);
});

test('required catalog action wins even when the customer phrase is outside regex fallback', async () => {
  const r=await run({texts:['me passa as opções de hoje'],response:{action:'catalog',reason:'none',reply:'Catálogo',state:blank}});
  assert.match(r.sent[0],/Qual deles chamou mais sua atenção?/);
});

test('review: outbound pending requirement is the requirement actually asked', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_model:'Siena',sell_model_evidence:'e0',
    sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0']},
    buy_interest:{...blank.buy_interest}};
  const history=[{id:'e0',direction:'inbound',message_text:'Quero vender Siena e comprar outro carro',raw_payload:{}}];
  const buy=await run({texts:['ok'],history,response:{action:'reply',reason:'none',reply:'Certo',state}});
  const outbound=buy.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.pending_requirement,'buy_model');
  const catalog=await run({texts:['me mostre'],history,response:{action:'catalog',reason:'none',reply:'',state}});
  assert.equal(catalog.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload.pending_requirement,'purchase_product');
});

test('review: vehicle and purchase corrections reset dependent state', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const previous={...context.salesEmptyState(),product_id:'sandero',product_evidence:'s1',product_variant_evidence:'s1',
    sell_vehicle:{...context.salesEmptyState().sell_vehicle,model:'Siena',maintenance_reported:true,maintenance_evidence_ids:['s1'],condition_reported:true,condition_evidence_ids:['s1']},
    buy_interest:{...context.salesEmptyState().buy_interest,model:'Sandero',product_id:'sandero'}};
  const next={...context.salesEmptyState(),sell_vehicle:{...context.salesEmptyState().sell_vehicle,model:'Palio',evidence_ids:['p1']},
    buy_interest:{...context.salesEmptyState().buy_interest,model:'Corsa',evidence_ids:['c1']}};
  const merged=context.salesMergeState(previous,next);
  assert.equal(merged.sell_vehicle.maintenance_reported,false);assert.equal(merged.sell_vehicle.condition_reported,false);
  assert.equal(context.salesDescriptionComplete(merged),false);assert.equal(merged.product_id,'');assert.equal(merged.buy_interest.product_id,'');
});

test('review: buy variants never use sell-side year and a six-photo album uses one classifier call', async () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const pcx=[{id:'p18',model:'PCX',year:2018,color:'preta'},{id:'p23',model:'PCX',year:2023,color:'preta'}];
  const state={buy_interest:{model:'PCX',raw_mention:'quero comprar uma PCX',evidence_ids:['b']},sell_vehicle:{model:'PCX'}};
  assert.equal(context.salesPurchaseCandidate([{id:'b',text:'comprar PCX'},{id:'s',text:'vender PCX 2018'}],pcx,state).product,null);
  state.buy_interest.raw_mention='comprar PCX 2023';
  assert.equal(context.salesPurchaseCandidate([{id:'b',text:'comprar PCX 2023 e vender PCX 2018'}],pcx,state).product.id,'p23');
  const r=await run({texts:Array.from({length:6},()=> '[image]'),response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  const classifierCalls=r.calls.filter(call=>call.url.includes('generateContent')&&call.body.contents[0].parts.at(-1)?.text?.includes('Classifique cada imagem'));
  assert.equal(classifierCalls.length,1);
});

test('review: model correction resets identity fields but preserves new appraisal facts only', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const empty=context.salesEmptyState();
  const previous={...empty,sell_brand:'Fiat',sell_brand_evidence:'old',sell_model:'Siena',sell_model_evidence:'old',sell_year:2007,sell_year_evidence:'old',
    sell_vehicle:{...empty.sell_vehicle,brand:'Fiat',model:'Siena',year:2007,maintenance_reported:true,maintenance_evidence_ids:['old'],condition_reported:true,condition_evidence_ids:['old']},
    buy_interest:{...empty.buy_interest,brand:'Renault',model:'Sandero',year:2016,raw_mention:'Sandero 2016',product_id:'sandero'},product_id:'sandero',product_evidence:'old',product_variant_evidence:'old'};
  const palio={...empty,sell_model:'Palio',sell_model_evidence:'new',sell_vehicle:{...empty.sell_vehicle,model:'Palio',evidence_ids:['new']},
    buy_interest:{...empty.buy_interest,model:'Corsa',evidence_ids:['new']}};
  const reset=context.salesMergeState(previous,palio);
  assert.equal(reset.sell_vehicle.model,'Palio');assert.equal(reset.sell_vehicle.brand,'');assert.equal(reset.sell_vehicle.year,null);
  assert.equal(reset.sell_brand,'');assert.equal(reset.sell_year,null);assert.equal(reset.sell_vehicle.maintenance_reported,false);assert.equal(reset.sell_vehicle.condition_reported,false);
  assert.equal(reset.buy_interest.model,'Corsa');assert.equal(reset.buy_interest.brand,'');assert.equal(reset.buy_interest.year,null);assert.equal(reset.buy_interest.raw_mention,'');assert.equal(reset.product_id,'');
  const described=context.salesMergeState(previous,{...palio,sell_vehicle:{...palio.sell_vehicle,maintenance_reported:true,maintenance_evidence_ids:['new'],condition_reported:true,condition_evidence_ids:['new']}},['new']);
  assert.equal(described.sell_vehicle.maintenance_reported,true);assert.deepEqual([...described.sell_vehicle.maintenance_evidence_ids],['new']);
  assert.equal(described.sell_vehicle.condition_reported,true);assert.deepEqual([...described.sell_vehicle.condition_evidence_ids],['new']);
});

test('review: buy_interest year must have literal buy-side support', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const state={...context.salesEmptyState(),intent:'buy',transaction_mode:'buy',buy_interest:{...context.salesEmptyState().buy_interest,model:'PCX',year:2023,raw_mention:'quero uma PCX',evidence_ids:['m1']}};
  assert.equal(context.salesSanitizeSemanticState(state,[{id:'m1',direction:'inbound',text:'quero uma PCX'}]).buy_interest.year,null);
  state.buy_interest.raw_mention='quero uma PCX 2023';
  assert.equal(context.salesSanitizeSemanticState(state,[{id:'m1',direction:'inbound',text:'quero uma PCX 2023'}]).buy_interest.year,2023);
});

test('review: pending model requirements survive photos and both missing asks both models', async () => {
  const sell={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['s']}};
  const buy={...blank,intent:'sell',transaction_mode:'buy_and_sell',buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['b']}};
  for (const [state,requirement] of [[sell,'buy_model'],[buy,'sell_model']]) {
    const identity=requirement==='buy_model'?{id:'s',direction:'inbound',message_text:'quero vender Siena e comprar outro carro',raw_payload:{}}:{id:'b',direction:'inbound',message_text:'quero comprar Corsa e vender meu Siena',raw_payload:{}};
    const history=[identity,{id:'a0',direction:'outbound',message_text:'pergunta',raw_payload:{pending_requirement:requirement}}];
    const first=await run({texts:['[image]'],history,response:{action:'reply',reason:'none',reply:'Certo',state}});
    const firstPayload=first.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
    assert.equal(firstPayload.pending_requirement,requirement);
    const second=await run({texts:['[image]'],history:[...history,{id:'a1',direction:'outbound',message_text:'Recebi a foto.',raw_payload:firstPayload}],response:{action:'reply',reason:'none',reply:'Certo',state}});
    assert.equal(second.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload.pending_requirement,requirement);
  }
  const both=await run({texts:['quero trocar'],response:{action:'reply',reason:'none',reply:'Certo',state:{...blank,intent:'sell',transaction_mode:'buy_and_sell'}}});
  const payload=both.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(payload.pending_requirement,'buy_and_sell_models');
  assert.match(both.sent[0],/modelo.*vender/i);
  assert.match(both.sent[0],/modelo.*comprar/i);
});

test('review: incomplete or invalid visual batch fails closed for every image', async () => {
  const texts=Array.from({length:6},()=> '[image]');
  const validPayloads=Object.fromEntries(texts.map((_,index)=>['e'+index,{}]));
  const valid=await run({texts,inboundPayloads:validPayloads,visualKinds:['vehicle_photo','other','uncertain','vehicle_photo','other','uncertain'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.equal(validPayloads.e0.sales_media[0].kind,'vehicle_photo');assert.equal(validPayloads.e3.sales_media[0].kind,'vehicle_photo');
  for (const options of [
    {visualKinds:['vehicle_photo','other']},
    {visualFinishReason:'MAX_TOKENS'},
    {visualKinds:['vehicle_photo','other','uncertain','vehicle_photo','other','invalid']}
  ]) {
    const inboundPayloads=Object.fromEntries(texts.map((_,index)=>['e'+index,{}]));
    await run({texts,inboundPayloads,...options,response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
    for (const payload of Object.values(inboundPayloads)) {
      assert.equal(payload.sales_media[0].kind,'unclassified_image');assert.equal(payload.sales_media[0].readable,false);
    }
  }
});

test('final review 1: corrected Palio rejects copied old appraisal evidence', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const empty=context.salesEmptyState();
  const previous={...empty,sell_vehicle:{...empty.sell_vehicle,model:'Siena',maintenance_reported:true,maintenance_evidence_ids:['old_siena'],description_summary:'revisado'}};
  const corrected={...empty,sell_vehicle:{...empty.sell_vehicle,model:'Palio',evidence_ids:['current_model'],maintenance_reported:true,maintenance_evidence_ids:['old_siena'],description_summary:'revisado'}};
  const rejected=context.salesMergeState(previous,corrected,['current_model']);
  assert.equal(rejected.sell_vehicle.maintenance_reported,false);assert.deepEqual([...rejected.sell_vehicle.maintenance_evidence_ids],[]);assert.equal(rejected.sell_vehicle.description_summary,'');
});

test('final review 2: corrected Palio accepts only appraisal evidence from the current turn', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const empty=context.salesEmptyState();
  const previous={...empty,sell_vehicle:{...empty.sell_vehicle,model:'Siena',maintenance_reported:true,maintenance_evidence_ids:['old_siena']}};
  const corrected={...empty,sell_vehicle:{...empty.sell_vehicle,model:'Palio',evidence_ids:['current_model'],maintenance_reported:true,maintenance_evidence_ids:['old_siena']}};
  const current={...corrected,sell_vehicle:{...corrected.sell_vehicle,maintenance_evidence_ids:['current_maintenance'],description_summary:'manutenção em dia'}};
  const accepted=context.salesMergeState(previous,current,['current_model','current_maintenance']);
  assert.equal(accepted.sell_vehicle.maintenance_reported,true);assert.deepEqual([...accepted.sell_vehicle.maintenance_evidence_ids],['current_maintenance']);
});

test('final review 3: unproven nested sell year is cleared before rules can use it', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const state={...context.salesEmptyState(),intent:'sell',transaction_mode:'sell',sell_vehicle:{...context.salesEmptyState().sell_vehicle,brand:'Peugeot',model:'Siena',year:2005,evidence_ids:['m1']}};
  const sanitized=context.salesSanitizeSemanticState(state,[{id:'m1',direction:'inbound',text:'quero vender um Siena'}]);
  assert.equal(sanitized.sell_vehicle.year,null);assert.equal(sanitized.sell_year,null);
});

test('final review 4: unproven nested sell brand is cleared before rules can use it', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const state={...context.salesEmptyState(),intent:'sell',transaction_mode:'sell',sell_vehicle:{...context.salesEmptyState().sell_vehicle,brand:'Peugeot',model:'Siena',evidence_ids:['m1']}};
  const sanitized=context.salesSanitizeSemanticState(state,[{id:'m1',direction:'inbound',text:'quero vender um Siena'}]);
  assert.equal(sanitized.sell_vehicle.brand,'');assert.equal(sanitized.sell_brand,'');
});

test('final review 5: raw purchase mention never selects a variant without real buy evidence', () => {
  const context=vm.createContext({normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const stock=[{id:'pcx18',model:'PCX',year:2018,color:'preta'},{id:'pcx23',model:'PCX',year:2023,color:'branca'}];
  const bare=[{id:'m1',direction:'inbound',text:'quero uma PCX'}];
  const hallucinated={buy_interest:{model:'PCX',year:2023,raw_mention:'PCX 2023 branca',evidence_ids:['m1']}};
  const sanitized=context.salesSanitizeSemanticState({...context.salesEmptyState(),intent:'buy',transaction_mode:'buy',...hallucinated},bare);
  assert.equal(sanitized.buy_interest.year,null);assert.equal(context.salesPurchaseCandidate(bare,stock,sanitized).product,null);
  const colorOnly={buy_interest:{model:'PCX',year:null,raw_mention:'PCX branca',evidence_ids:['m1']}};
  assert.equal(context.salesPurchaseCandidate(bare,stock,colorOnly).product,null);
  const real=[{id:'m2',direction:'inbound',text:'quero uma PCX 2023 branca'}];
  const proven={buy_interest:{model:'PCX',year:2023,raw_mention:'PCX 2023 branca',evidence_ids:['m2']}};
  assert.equal(context.salesPurchaseCandidate(real,stock,proven).product.id,'pcx23');
});

test('UX A: buy_and_sell reconhece Siena à venda, Corsa de interesse e conduz a avaliação', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',
    sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2009,evidence_ids:['e0']},
    buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e0']}};
  const r=await run({texts:['Quero comprar um Corsa e vender meu Siena 2009'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.match(r.sent[0],/Siena 2009/);assert.match(r.sent[0],/Corsa/);assert.match(r.sent[0],/avaliar/i);
  assert.match(r.sent[0],/manutenção|avaria/i);
});

test('buy_and_sell A: sem modelos, pergunta os dois modelos juntos', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell'};
  const r=await run({texts:['Quero comprar e vender'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const payload=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(payload.pending_requirement,'buy_and_sell_models');
  assert.match(r.sent[0],/modelo.*vender/i);
  assert.match(r.sent[0],/modelo.*comprar/i);
  assert.doesNotMatch(r.sent[0],/manuten|avaria|foto/i);
});

test('buy_and_sell B/C: venda identificada mantém buy_model e não mistura requisitos de avaliação', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_brand:'Fiat',sell_brand_evidence:'e0',sell_model:'Uno',sell_model_evidence:'e0',sell_year:2000,sell_year_evidence:'e0',sell_vehicle:{...blank.sell_vehicle,brand:'Fiat',model:'Uno',year:2000,evidence_ids:['e0']}};
  const r=await run({texts:['Fiat Uno 2000'],history:[{id:'intent-0',direction:'inbound',message_text:'Quero comprar e vender',raw_payload:{}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const payload=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(r.saved[0].p_state.transaction_mode,'buy_and_sell');
  assert.equal(r.saved[0].p_state.sell_brand,'Fiat');
  assert.equal(r.saved[0].p_state.sell_model,'Uno');
  assert.equal(r.saved[0].p_state.sell_year,2000);
  assert.equal(payload.pending_requirement,'buy_model');
  assert.match(r.sent[0],/^Perfeito\. E qual modelo de ve[ií]culo voc[eê] quer comprar\?$/i);
  assert.doesNotMatch(r.sent[0],/manuten|avaria|foto/i);
});

test('buy_and_sell D: após resolver o modelo de compra, inicia a avaliação da venda', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_brand:'Fiat',sell_brand_evidence:'e0',sell_model:'Uno',sell_model_evidence:'e0',sell_year:2000,sell_year_evidence:'e0',sell_vehicle:{...blank.sell_vehicle,brand:'Fiat',model:'Uno',year:2000,evidence_ids:['e0']},buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e1']}};
  const r=await run({texts:['Corsa'],lead:{id:'lead-1',revision:1,stage_key:'sales_qualifying',state,ai_locked:false},history:[{id:'intent-0',direction:'inbound',message_text:'Quero comprar e vender',raw_payload:{}},{id:'e0',direction:'inbound',message_text:'Fiat Uno 2000',raw_payload:{}},{id:'a0',direction:'outbound',ai_provider:'sales_core',message_text:'Perfeito. E qual modelo de veículo você quer comprar?',raw_payload:{pending_requirement:'buy_model'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const payload=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(payload.pending_requirement,'vehicle_description');
  assert.match(r.sent[0],/manuten|avaria/i);
  assert.doesNotMatch(r.sent[0],/foto/i);
});

test('pending invariant: descrição e foto pedem somente o requisito persistido', async () => {
  const base={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_model:'Uno',sell_model_evidence:'e0',sell_vehicle:{...blank.sell_vehicle,model:'Uno',evidence_ids:['e0']},buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e1']}};
  const history=[{id:'e0',direction:'inbound',message_text:'Quero vender um Uno',raw_payload:{}},{id:'e1',direction:'inbound',message_text:'Quero comprar um Corsa',raw_payload:{}}];
  const description=await run({texts:['Corsa'],history,response:{action:'reply',reason:'none',reply:'Certo',state:base}});
  const descriptionPayload=description.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(descriptionPayload.pending_requirement,'vehicle_description');
  assert.match(description.sent[0],/manuten|avaria/i);
  assert.doesNotMatch(description.sent[0],/foto/i);

  const described={...base,sell_vehicle:{...base.sell_vehicle,maintenance_reported:true,maintenance_evidence_ids:['e0'],condition_reported:true,condition_evidence_ids:['e0']}};
  const photo=await run({texts:['manutenção em dia e sem avarias'],history,response:{action:'reply',reason:'none',reply:'Certo',state:described}});
  const photoPayload=photo.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(photoPayload.pending_requirement,'vehicle_photo');
  assert.match(photo.sent[0],/foto/i);
  assert.doesNotMatch(photo.sent[0],/manuten|avaria/i);
});

test('UX B: buy_and_sell sem modelo de compra mantém buy_model sem iniciar avaliação', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2009,evidence_ids:['e0']}};
  const r=await run({texts:['Quero vender meu Siena 2009 e comprar outro carro'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const payload=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.equal(payload.pending_requirement,'buy_model');assert.match(r.sent[0],/qual modelo.*comprar/i);assert.doesNotMatch(r.sent[0],/manuten|avaria|foto/i);
});

test('UX C: foto válida pendente de descrição recebe ACK contextual e continua a pedir descrição', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0']}};
  const r=await run({texts:['[image]'],history:[{id:'e0',direction:'inbound',message_text:'Quero vender um Siena',raw_payload:{}},{id:'a0',direction:'outbound',message_text:'Conte sobre o veículo',raw_payload:{pending_requirement:'vehicle_description'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  const payload=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  assert.notEqual(r.sent[0],'Recebi a foto.');assert.match(r.sent[0],/já conta para a avaliação/i);assert.match(r.sent[0],/manutenção|avaria/i);assert.equal(payload.pending_requirement,'vehicle_description');
});

test('UX D: ACK contextual de foto em buy_and_sell mantém o interesse em Corsa visível', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0']},buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e0']}};
  const r=await run({texts:['[image]'],history:[{id:'e0',direction:'inbound',message_text:'Quero vender Siena e comprar Corsa',raw_payload:{}},{id:'a0',direction:'outbound',message_text:'Conte sobre o veículo',raw_payload:{pending_requirement:'vehicle_description'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.notEqual(r.sent[0],'Recebi a foto.');assert.match(r.sent[0],/já conta para a avaliação/i);assert.match(r.sent[0],/Corsa/);assert.match(r.sent[0],/manutenção|avaria/i);
});

test('UX E: descrição completa e foto válida avançam sem repetir manutenção ou avarias', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0'],maintenance_reported:true,maintenance_evidence_ids:['e1'],condition_reported:true,condition_evidence_ids:['e1']}};
  const r=await run({texts:['[image]'],history:[{id:'e0',direction:'inbound',message_text:'Quero vender meu Siena',raw_payload:{}},{id:'e1',direction:'inbound',message_text:'A manutenção está em dia e não há avarias',raw_payload:{}},{id:'a0',direction:'outbound',message_text:'Envie uma foto',raw_payload:{pending_requirement:'vehicle_photo'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.doesNotMatch(r.sent[0],/manutenção|avaria/i);assert.match(r.sent[0],/encaminhar para a equipe/i);
});

test('UX F: respostas client-facing novas mantêm português brasileiro correto', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0']},buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e0']}};
  const r=await run({texts:['Quero comprar um Corsa e vender Siena'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.match(r.sent[0],/você|avaliação|veículo/);assert.doesNotMatch(r.sent[0],/\b(?:Ola|ola|Voce|voce|avaliacao|negociacao|veiculo|manutencao|informacoes)\b/);
});

test('catalog UX A: "quais são os veículos disponíveis" abre o catálogo', async () => {
  const r=await run({texts:['quais são os veículos disponíveis?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(r.sent[0],/Hoje temos estas opções/);assert.equal(r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload.pending_requirement,'purchase_product');
});

test('catalog UX B: "quais você tem" abre o catálogo', async () => {
  const r=await run({texts:['quais você tem?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(r.sent[0],/1\./);assert.match(r.sent[0],/Qual deles chamou mais sua atenção/);
});

test('catalog UX C/D: foto e descrição com pedido explícito persistem dados e mostram catálogo antes de buy_model', async () => {
  const inboundPayloads={e0:{}};
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2014,evidence_ids:['e1'],maintenance_reported:true,maintenance_evidence_ids:['e0'],condition_reported:true,condition_evidence_ids:['e0']}};
  const r=await run({texts:['[image]\nTá completo, manutenção em dia e quais são os veículos disponíveis?'],inboundPayloads,
    history:[{id:'e1',direction:'inbound',message_text:'Quero vender meu Siena 2014 e comprar outro',raw_payload:{}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.equal(inboundPayloads.e0.sales_media[0].kind,'vehicle_photo');assert.equal(r.saved[0].p_state.sell_vehicle.maintenance_reported,true);assert.equal(r.saved[0].p_state.sell_vehicle.condition_reported,true);
  assert.match(r.sent[0],/veículos disponíveis/);assert.ok(!/qual modelo de veículo você procura comprar/i.test(r.sent[0]));
});

test('catalog UX E: catálogo é numerado e preserva os preços oficiais', async () => {
  const r=await run({texts:['me mostra o estoque'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  for (const index of [1,2,3]) assert.match(r.sent[0],new RegExp('^'+index+'\\.','m'));
  assert.match(r.sent[0],/R\$ 28\.980,00/);assert.match(r.sent[0],/R\$ 18\.980,00/);assert.match(r.sent[0],/R\$ 14\.980,00/);
});

test('catalog UX F: resposta "2" resolve exatamente o segundo item exibido', async () => {
  const initial=await run({texts:['quais veículos vocês têm?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  const catalogPayload=initial.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  const buyState={...blank,intent:'buy',transaction_mode:'buy'};
  const selected=await run({texts:['2'],lead:{id:'lead-1',revision:0,stage_key:'sales_qualifying',state:buyState,ai_locked:false},history:[{id:'a0',direction:'outbound',message_text:initial.sent[0],raw_payload:catalogPayload}],response:{action:'reply',reason:'none',reply:'Certo',state:buyState}});
  assert.equal(selected.saved[0].p_state.product_id,catalogPayload.catalog_item_ids[1]);assert.match(selected.sent[0],/PCX 2023/i);
});

test('catalog UX G: "quero o 4" resolve exatamente o quarto item exibido', async () => {
  const initial=await run({texts:['quais veículos vocês têm?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  const catalogPayload=initial.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events')).body.raw_payload;
  const buyState={...blank,intent:'buy',transaction_mode:'buy'};
  const selected=await run({texts:['quero o 4'],lead:{id:'lead-1',revision:0,stage_key:'sales_qualifying',state:buyState,ai_locked:false},history:[{id:'a0',direction:'outbound',message_text:initial.sent[0],raw_payload:catalogPayload}],response:{action:'reply',reason:'none',reply:'Certo',state:buyState}});
  assert.equal(selected.saved[0].p_state.product_id,catalogPayload.catalog_item_ids[3]);assert.match(selected.sent[0],/PCX 2018/i);
});

test('catalog UX H: número sem catálogo pendente não seleciona produto', async () => {
  const state={...blank,intent:'buy',transaction_mode:'buy'};
  const r=await run({texts:['2'],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.equal(r.saved[0].p_state.product_id,'');
});

test('catalog UX I: respostas comerciais novas não usam ponto e vírgula', async () => {
  const catalog=await run({texts:['quais carros estão disponíveis?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  const photoState={...blank,intent:'sell',transaction_mode:'sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',evidence_ids:['e0']}};
  const photo=await run({texts:['[image]'],history:[{id:'e0',direction:'inbound',message_text:'Siena',raw_payload:{}},{id:'a0',direction:'outbound',message_text:'Conte sobre o veículo',raw_payload:{pending_requirement:'vehicle_description'}}],response:{action:'reply',reason:'none',reply:'Certo',state:photoState}});
  assert.doesNotMatch(catalog.sent[0],/;/);assert.doesNotMatch(photo.sent[0],/;/);
});

test('catalog UX J: respostas de catálogo continuam em português brasileiro acentuado', async () => {
  const r=await run({texts:['o que vocês têm disponível?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(r.sent[0],/opções|atenção/);assert.doesNotMatch(r.sent[0],/\b(?:Nao|Voce|veiculos|opcoes|atencao)\b/);
});

test('UX naturalidade: após o reconhecimento inicial, não repete modelo e ano sem necessidade', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2014,evidence_ids:['e0']},buy_interest:{...blank.buy_interest,model:'Corsa',evidence_ids:['e0']}};
  const r=await run({texts:['certo'],history:[{id:'e0',direction:'inbound',message_text:'Quero vender Siena 2014 e comprar Corsa',raw_payload:{}},{id:'a0',direction:'outbound',ai_provider:'sales_core',message_text:'Entendi: você quer vender seu Siena 2014.',raw_payload:{pending_requirement:'vehicle_description'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.match(r.sent[0],/seu carro/i);assert.doesNotMatch(r.sent[0],/Siena 2014/);
});

test('UX fechamento A: buy_and_sell completo e escolha 5 confirmam Sandero uma vez e fazem handoff', async () => {
  const r=await completedBuyAndSellCatalogChoice();
  const reply=r.sent[0];
  assert.equal((reply.match(/Renault Sandero GT Line 2016/g)||[]).length,1);
  assert.doesNotMatch(reply,/Siena/i);assert.doesNotMatch(reply,/SANDERO GT LINE/);
  assert.match(reply,/avaliação.*encaminhada|encaminhada.*avaliação/i);assert.match(reply,/equipe.*negociação/i);
  assert.equal(r.result.handoff,true);
});

test('UX fechamento B: a escolha do produto não repete o mesmo modelo comprado', async () => {
  const r=await completedBuyAndSellCatalogChoice();
  assert.equal((r.sent[0].match(/Sandero GT Line/g)||[]).length,1);
});

test('UX fechamento C: a resposta final não repete o modelo do veículo vendido', async () => {
  const r=await completedBuyAndSellCatalogChoice();
  assert.doesNotMatch(r.sent[0],/Siena/i);
});

test('UX fechamento D: buy_and_sell sem modelo de compra mantém a pergunta de compra isolada', async () => {
  const state={...blank,intent:'sell',transaction_mode:'buy_and_sell',sell_vehicle:{...blank.sell_vehicle,model:'Siena',year:2014,evidence_ids:['e0']}};
  const r=await run({texts:['certo'],history:[{id:'e0',direction:'inbound',message_text:'Quero vender Siena 2014 e comprar outro carro',raw_payload:{}},{id:'a0',direction:'outbound',ai_provider:'sales_core',message_text:'Entendi, vamos cuidar dos dois.',raw_payload:{pending_requirement:'vehicle_description'}}],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.equal(r.sent[0],'Perfeito. E qual modelo de veículo você quer comprar?');
  assert.doesNotMatch(r.sent[0],/manuten|avaria|foto/i);
});

test('referral A/B: externalAdReply do webhook chega ao core e reconhece o veículo oficial', async () => {
  const queued=await enqueueCore({tenant_id:'tenant-sales',remoteJid:'5511999999999@s.whatsapp.net',instance:'sales-instance',messageId:'m0',contactName:'Maria',messageText:'Olá! Posso ter mais informações sobre isso?',contentType:'text',core_sales:true,core_quiet_ms:8000,core_fragment_ms:12000,
    raw_payload:{data:{message:{extendedTextMessage:{text:'Olá! Posso ter mais informações sobre isso?',contextInfo:{externalAdReply:{title:'Renault Sandero GT Line 2016',body:'Confira as condições',sourceId:'ad-123',sourceUrl:'https://fb.me/ad-123',mediaType:'image',thumbnailUrl:'https://cdn.example.test/private.jpg'}}}}}}});
  assert.deepEqual(queued.p_message.raw.referral,sanderoReferral);
  assert.equal(queued.p_message.raw.thumbnailUrl,undefined);
  const r=await run({texts:['Olá! Posso ter mais informações sobre isso?'],history:[{id:'e0',direction:'inbound',message_text:'Olá! Posso ter mais informações sobre isso?',raw_payload:{referral:sanderoReferral}}],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  const modelCall=r.calls.find(call=>call.url.includes('generativelanguage.googleapis.com')&&!call.body.contents[0].parts[0].inlineData);
  const modelInput=JSON.parse(modelCall.body.contents[0].parts[0].text);
  assert.equal(modelInput.official_facts.referral.inventory_match.status,'unique');
  assert.equal(modelInput.official_facts.referral.inventory_match.vehicle.name,'RENAULT SANDERO GT LINE');
  assert.match(r.sent[0],/Renault Sandero GT Line 2016/);assert.doesNotMatch(r.sent[0],/comprar ou vender/i);
});

test('referral C: pergunta contextual sem referral não inventa veículo', async () => {
  const r=await run({texts:['Olá! Posso ter mais informações sobre isso?'],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.equal(r.sent[0],'Claro! Sobre qual veículo você gostaria de saber mais?');
  assert.doesNotMatch(r.sent[0],/Sandero|Siena|comprar ou vender/i);
});

test('referral D: anúncio sem produto oficial não inventa disponibilidade', async () => {
  const r=await run({texts:['Tenho interesse'],history:[{id:'e0',direction:'inbound',message_text:'Tenho interesse',raw_payload:{referral:{...sanderoReferral,title:'Renault Sandero GT Line 2015'}}}],response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(r.sent[0],/Não encontrei esse veículo no estoque atual/);assert.doesNotMatch(r.sent[0],/está disponível/i);
});

test('referral E/F: preço e disponibilidade usam o produto anunciado e fatos oficiais', async () => {
  const historyFor=text=>[{id:'e0',direction:'inbound',message_text:text,raw_payload:{referral:sanderoReferral}}];
  const price=await run({texts:['Quanto está?'],history:historyFor('Quanto está?'),response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(price.sent[0],/Renault Sandero GT Line 2016/);assert.match(price.sent[0],/R\$ 42\.980,00/);
  const availability=await run({texts:['Esse ainda está disponível?'],history:historyFor('Esse ainda está disponível?'),response:{action:'reply',reason:'none',reply:'Certo',state:blank}});
  assert.match(availability.sent[0],/Renault Sandero GT Line 2016/);assert.match(availability.sent[0],/disponível no estoque/i);
});

test('referral G/H: enqueue preserva referral sem contaminar mídia, áudio ou outro evento', async () => {
  const image=await enqueueCore({tenant_id:'tenant-sales',remoteJid:'chat',instance:'sales-instance',messageId:'image-1',contactName:'Maria',messageText:'Tenho interesse',contentType:'image',core_sales:true,core_quiet_ms:8000,core_fragment_ms:12000,
    raw_payload:{data:{message:{imageMessage:{caption:'Tenho interesse',contextInfo:{externalAdReply:{title:'Renault Sandero GT Line 2016',body:'Confira as condições',sourceId:'ad-123',sourceUrl:'https://fb.me/ad-123',mediaType:'image'}}}}}}});
  assert.equal(image.p_message.raw.content_type,'image');assert.equal(image.p_message.raw.sales_media_type,'image');assert.equal(image.p_message.raw.core_revision,'conversation_core_v1');
  assert.deepEqual(image.p_message.raw.referral,sanderoReferral);
  const audio=await enqueueCore({tenant_id:'tenant-sales',remoteJid:'chat',instance:'sales-instance',messageId:'audio-2',contactName:'Maria',messageText:'[audio]',contentType:'audio',core_sales:true,core_quiet_ms:8000,core_fragment_ms:12000,
    raw_payload:{data:{message:{audioMessage:{seconds:17,fileLength:3210}}}}});
  assert.deepEqual(audio.p_message.raw.audio_metadata,{seconds:17,bytes:3210});assert.equal(audio.p_message.raw.sales_media_type,undefined);assert.equal(audio.p_message.raw.referral,undefined);
  const plain=await enqueueCore({tenant_id:'tenant-sales',remoteJid:'chat',instance:'sales-instance',messageId:'text-3',contactName:'Maria',messageText:'Olá',contentType:'text',core_sales:true,core_quiet_ms:8000,core_fragment_ms:12000,raw_payload:{data:{message:{conversation:'Olá'}}}});
  assert.equal(plain.p_message.raw.referral,undefined);assert.equal(plain.p_message.raw.audio_metadata,undefined);assert.equal(plain.p_message.raw.sales_media_type,undefined);
});

// =========================================================================
// ANTI-LOOP & HUMAN HANDOFF SUITE (Tests A through J)
// =========================================================================

test('anti-loop A: sell_model faltando, primeira tentativa -> pergunta modelo normalmente', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model: '', sell_vehicle: { ...blank.sell_vehicle, model: '' }
  };
  const r = await run({
    texts: ['Quanto vcs paga em um veiculo'],
    history: [],
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?', state }
  });
  assert.equal(r.sent[0], 'Qual é o modelo do veículo que você quer vender?');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.pending_requirement, 'sell_model');
  assert.equal(outbound.body.stage, 'IA - Qualificacao automotiva');
  assert.equal(outbound.body.handoff, false);
});

test('anti-loop B: cliente envia fotos + ano, mas sem modelo -> preserva fatos e mantém somente a pergunta de modelo', async () => {
  const stateWithYear = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_year: 2006, sell_year_evidence: 'e2',
    sell_model: '',
    sell_vehicle: { ...blank.sell_vehicle, year: 2006, model: '', evidence_ids: ['e2'] }
  };
  const r = await run({
    texts: ['[image]', '[image]', '2006'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quanto vcs paga em um veiculo', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: { pending_requirement: 'sell_model' } }
    ],
    imageClassification: 'vehicle_photo',
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?', state: stateWithYear }
  });
  // pending_requirement=sell_model must not ask for photos or appraisal data.
  assert.equal(r.sent[0], 'Se quiser continuar a avaliação, me diga o modelo do veículo. Se precisar de outra coisa, pode me falar.');
  assert.doesNotMatch(r.sent[0], /foto|manuten|avaria/i);
  // Verify state saved to Supabase
  const savedState = r.saved[0].p_state;
  assert.equal(savedState.sell_year, 2006);
  assert.equal(savedState.sell_model, '');
});

test('anti-loop C: cliente responde outra mensagem sem modelo -> NÃO pede modelo pela terceira vez; handoff sales_human', async () => {
  const stateWithYear = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_year: 2006, sell_year_evidence: 'e2',
    sell_model: '',
    sell_vehicle: { ...blank.sell_vehicle, year: 2006, model: '', evidence_ids: ['e2'] }
  };
  const r = await run({
    texts: ['Aí'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quanto vcs paga em um veiculo', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: { pending_requirement: 'sell_model' } },
      { id: 'e1', direction: 'inbound', message_text: '[image]\n2006', raw_payload: {} },
      { id: 'a1', direction: 'outbound', message_text: 'Recebi as fotos e já anotei que é 2006. Só faltou me dizer o modelo do carro para eu continuar a avaliação.', ai_provider: 'sales_core', created_at: '2026-10-03T10:02:00Z', raw_payload: { pending_requirement: 'sell_model' } }
    ],
    lead: { id: 'lead-1', revision: 2, stage_key: 'sales_qualifying', ai_locked: false, state: stateWithYear },
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?', state: stateWithYear }
  });
  // Must NOT ask for model a 3rd time! Must execute handoff to Wesley
  assert.match(r.sent[0], /Sem problema, vou passar seu atendimento para o Wesley continuar por aqui/i);
  assert.doesNotMatch(r.sent[0], /modelo do veículo/i);
  assert.equal(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.equal(outbound.body.handoff, true);
  assert.equal(outbound.body.stage, 'Atendimento humano');
  assert.equal(outbound.body.sender_type, 'assistant');
  assert.equal(outbound.body.sent_by_user, undefined);
  assert.equal(outbound.body.raw_payload.assignee, undefined);

  // Canonical assignment event
  const assignEvent = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.service === 'conversation_assigned');
  assert.ok(assignEvent, 'deve existir evento canônico de assign_conversation');
  assert.equal(assignEvent.body.sender_type, 'system');
  assert.equal(assignEvent.body.service, 'conversation_assigned');
  assert.equal(assignEvent.body.message_text, 'Conversa atribuida a Wesley');
  assert.equal(assignEvent.body.raw_payload.command, 'assign_conversation');
  assert.equal(assignEvent.body.raw_payload.assignee.name, 'Wesley');
  assert.equal(assignEvent.body.raw_payload.assignee.id, '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf');
});

test('anti-loop D: cliente demonstra irritação clara após requisito pendente -> handoff imediato', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model: '', sell_vehicle: { ...blank.sell_vehicle, model: '' }
  };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quanto vcs paga em um veiculo', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: { pending_requirement: 'sell_model' } }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?', state }
  });
  // Must hand off immediately with polite acknowledgment
  assert.match(r.sent[0], /Entendi\. Vou passar seu atendimento para o Wesley continuar por aqui\./i);
  assert.equal(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.handoff, true);
  assert.equal(outbound.body.raw_payload.handoff_reason, 'frustration');
});

test('anti-loop E: após sales_human -> IA não responde', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell' };
  const r = await run({
    texts: ['Tem alguém aí?'],
    lead: { id: 'lead-1', revision: 3, stage_key: 'sales_human', ai_locked: true, state },
    response: { action: 'reply', reason: 'none', reply: 'Não deveria responder', state }
  });
  assert.equal(r.result.skipped, true);
  assert.equal(r.result.human_lock, true);
  assert.equal(r.sent.length, 0);
  assert.equal(r.generated, 0);
});

test('anti-loop F: contact_name = "Raphael do Civic" -> NÃO preencher sell_model="Civic" automaticamente', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell' };
  const r = await run({
    texts: ['Quanto vcs paga em um veiculo'],
    contactName: 'Raphael do Civic',
    response: {
      action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?',
      state: { ...state, sell_model: 'Civic', sell_model_evidence: 'e0' }
    }
  });
  // Since 'Civic' is only in contactName and NOT in the customer message text 'Quanto vcs paga em um veiculo',
  // salesSanitizeSemanticState MUST clear sell_model!
  const savedState = r.saved[0].p_state;
  assert.equal(savedState.sell_model, '');
  assert.equal(savedState.sell_vehicle.model, '');
});

test('anti-loop G: duas fotos + "2006" -> sell_year permanece 2006; fotos continuam evidência; sell_model permanece vazio', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_year: 2006, sell_year_evidence: 'e2',
    sell_model: '', sell_vehicle: { ...blank.sell_vehicle, year: 2006, model: '', evidence_ids: ['e2'] }
  };
  const inboundPayloads = { e0: {}, e1: {} };
  const r = await run({
    texts: ['[image]', '[image]', '2006'],
    history: [{id:'intent-0',direction:'inbound',message_text:'Quero vender meu carro',raw_payload:{}}],
    lead: {id:'lead-1',revision:1,stage_key:'sales_qualifying',state,ai_locked:false},
    imageClassification: 'vehicle_photo',
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Certo', state }
  });
  const savedState = r.saved[0].p_state;
  assert.equal(savedState.sell_year, 2006);
  assert.equal(savedState.sell_model, '');
  assert.equal(inboundPayloads.e0.sales_media[0].kind, 'vehicle_photo');
  assert.equal(inboundPayloads.e1.sales_media[0].kind, 'vehicle_photo');
});

test('anti-loop H: anti-loop também funciona para outro pending_requirement, não apenas sell_model', async () => {
  const state = {
    ...blank, intent: 'buy', transaction_mode: 'buy',
    customer_name: '', product_id: 'renault|sandero gt line|2016|branco'
  };
  const r = await run({
    texts: ['sim'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quero o Sandero', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Qual é o seu nome, por favor?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: { pending_requirement: 'customer_name' } },
      { id: 'e1', direction: 'inbound', message_text: 'pode ser', raw_payload: {} },
      { id: 'a1', direction: 'outbound', message_text: 'Pode me informar seu nome, por favor?', ai_provider: 'sales_core', created_at: '2026-10-03T10:02:00Z', raw_payload: { pending_requirement: 'customer_name' } }
    ],
    lead: { id: 'lead-1', revision: 2, stage_key: 'sales_qualifying', ai_locked: false, state },
    response: { action: 'register_interest', reason: 'none', reply: '', state }
  });
  // Customer failed customer_name twice -> 3rd time must escalate to human handoff!
  assert.match(r.sent[0], /Sem problema, vou passar seu atendimento para o Wesley continuar por aqui/i);
  assert.equal(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.handoff, true);
});

test('anti-loop I: não contam como múltiplas tentativas eventos internos/reprocessamento técnico', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model: '', sell_vehicle: { ...blank.sell_vehicle, model: '' }
  };
  // History has 1 outbound asking sell_model, 2 buffer events, and an error event
  const r = await run({
    texts: ['quero vender logo'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: 'Quanto vcs paga?', raw_payload: {} },
      { id: 'a0', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', ai_provider: 'sales_core', created_at: '2026-10-03T10:01:00Z', raw_payload: { pending_requirement: 'sell_model' } },
      { id: 'e1', direction: 'inbound', message_text: 'buffer 1', ai_provider: 'buffer', raw_payload: {} },
      { id: 'e2', direction: 'inbound', message_text: 'buffer 2', ai_provider: 'buffer', raw_payload: {} }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que deseja vender?', state }
  });
  // Attempts is 1 (the single real outbound). It must reorient, not hand off.
  assert.equal(r.saved[0].p_stage, 'sales_qualifying');
  assert.equal(r.sent[0], 'Se quiser continuar a avaliação, me diga o modelo do veículo. Se precisar de outra coisa, pode me falar.');
});

test('anti-loop J: atribuição humana: usa mecanismo existente; Wesley no tenant Gênesis se configurado/resolvido; fallback para equipe se operador específico não puder ser resolvido', async () => {
  const state = {
    ...blank, intent: 'sell', transaction_mode: 'sell',
    sell_model: '', sell_vehicle: { ...blank.sell_vehicle, model: '' }
  };
  // Case 1: team_agents resolves Wesley
  const withWesley = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  assert.match(withWesley.sent[0], /o Wesley continuar por aqui/i);
  const out1 = withWesley.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.equal(out1.body.sent_by_user, undefined);
  const assign1 = withWesley.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.service === 'conversation_assigned');
  assert.ok(assign1);
  assert.equal(assign1.body.sender_type, 'system');
  assert.equal(assign1.body.raw_payload.assignee.name, 'Wesley');

  // Case 2: team_agents returns empty -> fallback to generic equipe
  const withEquipe = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  assert.match(withEquipe.sent[0], /a equipe continuar por aqui/i);
  const out2 = withEquipe.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.equal(out2.body.sent_by_user, undefined);
  const assign2 = withEquipe.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.service === 'conversation_assigned');
  assert.equal(assign2, undefined, 'sem operador disponível não cria assign_conversation falso');
});

// =========================================================================
// SECTION 7: CANONICAL ASSIGNMENT & AUTHORSHIP SEPARATION (Tests A through G)
// =========================================================================

test('canonical assign A: mensagem de despedida/handoff tem sender_type = assistant e NÃO sent_by_user = Wesley', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  const assistantOutbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.ok(assistantOutbound);
  assert.equal(assistantOutbound.body.sender_type, 'assistant');
  assert.notEqual(assistantOutbound.body.sent_by_user, 'Wesley');
  assert.equal(assistantOutbound.body.sent_by_user, undefined);
});

test('canonical assign B: depois da mensagem da IA, existe assignment canônico separado para Wesley', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  const postEvents = r.calls.filter(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(postEvents.length, 2);
  const [firstOutbound, secondOutbound] = postEvents;
  assert.equal(firstOutbound.body.sender_type, 'assistant');
  assert.equal(secondOutbound.body.sender_type, 'system');
  assert.equal(secondOutbound.body.service, 'conversation_assigned');
});

test('canonical assign C: assignment contém command = assign_conversation, assignee.id e assignee.name corretos', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  const assignEvent = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.service === 'conversation_assigned');
  assert.ok(assignEvent);
  assert.equal(assignEvent.body.raw_payload.command, 'assign_conversation');
  assert.equal(assignEvent.body.raw_payload.assignee.id, '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf');
  assert.equal(assignEvent.body.raw_payload.assignee.name, 'Wesley');
  assert.equal(assignEvent.body.stage, 'Atendimento humano');
  assert.equal(assignEvent.body.handoff, true);
});

test('canonical assign D: Frontend consegue resolver Wesley como assignee usando exatamente o mesmo mecanismo da atribuição manual', async () => {
  const { eventsToConversations } = await import('../app/src/dataService.js');
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  const postEvents = r.calls.filter(c => c.method === 'POST' && c.url.includes('/channel_events')).map((c, i) => ({
    id: 'out-' + i,
    created_at: new Date(Date.now() + i * 1000).toISOString(),
    ...c.body
  }));
  const convs = eventsToConversations(postEvents);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].owner, 'Wesley');
  assert.equal(convs[0].ownerId, '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf');
});

test('canonical assign E: Auditoria não informa que Wesley escreveu a mensagem da IA', async () => {
  const { eventsToConversations } = await import('../app/src/dataService.js');
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [{ id: '2b927dd1-8f69-4b33-9bdf-6abc2968c1cf', name: 'Wesley', role: 'Atendente' }],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  const postEvents = r.calls.filter(c => c.method === 'POST' && c.url.includes('/channel_events')).map((c, i) => ({
    id: 'out-' + i,
    created_at: new Date(Date.now() + i * 1000).toISOString(),
    ...c.body
  }));
  const convs = eventsToConversations(postEvents);
  const aiMessage = convs[0].messages.find(m => m.from === 'ai');
  assert.ok(aiMessage);
  assert.notEqual(aiMessage.sent_by, 'Wesley');
  assert.equal(aiMessage.sent_by, null);
  const assistantOutbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.equal(assistantOutbound.body.sent_by_user, undefined);
});

test('canonical assign F: Sem operador disponível: sales_human + ai_locked acontecem normalmente e não é criado assignee falso', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Vah pra casa do chapeu'],
    history: [{ id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }],
    teamAgents: [],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo?', state }
  });
  assert.equal(r.saved[0].p_stage, 'sales_human');
  const assignEvent = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.service === 'conversation_assigned');
  assert.equal(assignEvent, undefined);
  const assistantOutbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events') && c.body.sender_type === 'assistant');
  assert.equal(assistantOutbound.body.handoff, true);
  assert.equal(assistantOutbound.body.raw_payload.assignee, undefined);
  assert.match(r.sent[0], /a equipe continuar por aqui/i);
});

test('canonical assign G: Depois do handoff: nova mensagem do cliente não recebe resposta automática', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['Olá, tem alguém aí?'],
    lead: { id: 'lead-1', revision: 2, stage_key: 'sales_human', ai_locked: true, state },
    response: { action: 'reply', reason: 'none', reply: 'Não deveria responder', state }
  });
  assert.equal(r.result.skipped, true);
  assert.equal(r.result.human_lock, true);
  assert.equal(r.sent.length, 0);
  assert.equal(r.generated, 0);
});

// =========================================================================
// SECTION 8: SALES MEDIA SEQUENTIAL PRESERVATION, LIMITS & MULTI-MODAL ISOLATION
// =========================================================================

test('sales media preservation 1: media persistido na entrada -> sales_media adicionado pelo core de vendas -> media continua presente no raw_payload', async () => {
  const initialMedia = {
    status: 'stored', kind: 'image', bucket: 'channel-media',
    storagePath: 'sales/whatsapp/chat/m0.jpg', mimeType: 'image/jpeg', size: 1024
  };
  const inboundPayloads = {
    e0: {
      channel_type: 'whatsapp',
      content_type: 'image',
      media: initialMedia
    }
  };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: 'Siena' };
  const r = await run({
    texts: ['[image]'],
    imageClassification: 'vehicle_photo',
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Qual o ano?', state }
  });
  // Verify sales_media was added and media was preserved
  assert.ok(inboundPayloads.e0.sales_media);
  assert.equal(inboundPayloads.e0.sales_media[0].kind, 'vehicle_photo');
  assert.deepEqual(inboundPayloads.e0.media, initialMedia, 'media block must remain intact');
});

test('sales media preservation 2: media + audio_processing persistidos -> sales_media adicionado -> nenhum bloco é perdido', async () => {
  const initialMedia = {
    status: 'stored', kind: 'audio', bucket: 'channel-media',
    storagePath: 'sales/whatsapp/chat/m0.ogg', mimeType: 'audio/ogg', size: 2048
  };
  const initialAudio = {
    version: 'whatsapp_audio_v1', status: 'transcribed', text: 'Tenho um Palio 2010', model: 'gemini-1.5-flash'
  };
  const inboundPayloads = {
    e0: {
      channel_type: 'whatsapp',
      content_type: 'audio',
      media: initialMedia,
      audio_processing: initialAudio
    }
  };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_brand: 'Fiat', sell_model: 'Palio', sell_year: 2010 };
  const r = await run({
    texts: ['Tenho um Palio 2010'],
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Perfeito, quer trocar ou vender?', state }
  });
  assert.deepEqual(inboundPayloads.e0.media, initialMedia, 'media must be preserved');
  assert.deepEqual(inboundPayloads.e0.audio_processing, initialAudio, 'audio_processing must be preserved');
});

test('sales media preservation 3: sales_media + outro patch de metadados -> nenhum bloco é perdido', async () => {
  const initialMedia = {
    status: 'stored', kind: 'image', category: 'image',
    bucket: 'channel-media', storagePath: 'sales/whatsapp/chat/m0.jpg',
    mimeType: 'image/jpeg', size: 2048
  };
  const inboundPayloads = {
    e0: {
      channel_type: 'whatsapp',
      content_type: 'image',
      media: initialMedia,
      custom_flag: 'preserved_tag'
    }
  };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell' };
  const r = await run({
    texts: ['[image]'],
    imageClassification: 'vehicle_photo',
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Recebi a foto', state }
  });
  assert.equal(inboundPayloads.e0.custom_flag, 'preserved_tag');
  assert.ok(inboundPayloads.e0.sales_media);
  assert.equal(inboundPayloads.e0.media.status, 'stored');
});

test('sales media limit A: imagem <= 10 MiB em fluxo de avaliação de vendas é processada e classificada normalmente', async () => {
  const inboundPayloads = {
    e0: {
      channel_type: 'whatsapp', content_type: 'image',
      source_media: { kind: 'image', file_length: 8 * 1024 * 1024, mime_type: 'image/jpeg' },
      media: { status: 'stored', kind: 'image', category: 'image', size: 8 * 1024 * 1024, bucket: 'channel-media', storagePath: 'sales/whatsapp/chat/m0.jpg' }
    }
  };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: 'Corsa' };
  const r = await run({
    texts: ['[image]'],
    imageClassification: 'vehicle_photo',
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Qual o ano do Corsa?', state }
  });
  assert.equal(r.result.handoff, false);
  assert.equal(inboundPayloads.e0.sales_media[0].kind, 'vehicle_photo');
});

test('sales media limit B: imagem com storage_error ou oversized não inventa venda em sessão nova', async () => {
  const inboundPayloads = {
    e0: {
      channel_type: 'whatsapp', content_type: 'image',
      media: { status: 'skipped_too_large', kind: 'image', category: 'image', error: 'media_too_large' }
    }
  };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell' };
  const r = await run({
    texts: ['[image]'],
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que você quer vender?', state }
  });
  // Turn continues smoothly without inferring a commercial purpose from media.
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0], 'Recebi a foto. Como posso ajudar você?');
  assert.equal(r.saved[0].p_state.transaction_mode, 'unknown');
});

test('sales anti-loop K: cliente envia texto após foto sem modelo -> mantém qualificação sem loop', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['quero vender'],
    history: [
      { id: 'e0', direction: 'inbound', message_text: '[image]', raw_payload: { sales_media: [{ kind: 'vehicle_photo' }] } },
      { id: 'a0', direction: 'outbound', message_text: 'Qual o modelo?', ai_provider: 'sales_core', raw_payload: { pending_requirement: 'sell_model' } }
    ],
    response: { action: 'reply', reason: 'none', reply: 'Qual o modelo do seu carro?', state }
  });
  assert.equal(r.saved[0].p_stage, 'sales_qualifying');
});

test('sales anti-loop L: cliente envia documento CNH + foto de veículo em mensagens separadas -> classifica cada um individualmente sem contaminação', async () => {
  const inboundPayloads = { e0: {}, e1: {} };
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', customer_name: 'Maria' };
  const r = await run({
    texts: ['[document]', '[image]'],
    imageClassification: ['vehicle_photo'],
    ocr: { kind: 'document', name: 'Maria', cpf: '', cnh: '12345678901', birth_date: '' },
    inboundPayloads,
    response: { action: 'reply', reason: 'none', reply: 'Documento e foto recebidos', state }
  });
  assert.equal(r.saved[0].p_documents.length, 1);
  assert.equal(r.saved[0].p_documents[0].extracted.cnh, '12345678901');
  assert.equal(inboundPayloads.e1.sales_media[0].kind, 'vehicle_photo');
});

// =========================================================================
// SECTION 9: GENESIS COMMERCIAL FOLLOW-UP TESTS (H to N)
// =========================================================================

test('follow-up H: sales + follow_up_enabled=false schedules 0 jobs', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['quero vender meu carro'],
    followUpEnabled: false,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que você quer vender?', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up I: sales + sales_follow_up.enabled=false schedules 0 jobs', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['quero vender meu carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: false },
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do seu carro?', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up J: sales + service != sales_qualification schedules 0 jobs', async () => {
  // When an interest is registered, service is sales_interest, not sales_qualification
  const r = await run({
    texts: ['Quero Sandero GT Line', 'Maria Souza', 'Entrada de R$ 12.894,00'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'register_interest', reason: 'none', reply: 'Interesse registrado!', state: selected }
  });
  assert.equal(r.result.ok, true);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up K: sales + interest_registered=true schedules 0 jobs', async () => {
  // Default run() args trigger interest registration (p_register = true)
  const r = await run({
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
  });
  assert.equal(r.saved[0].p_register, true);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up L: sales_qualification valid + follow_up_enabled=true + sales_follow_up.enabled=true calls magia_schedule_followups', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['quero vender meu carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true, revision: 'genesis-follow-up-v1-2026-10-05' },
    followUpJobsScheduled: 3,
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo que você quer vender?', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.sent, true);
  assert.equal(r.result.follow_ups_scheduled, 3);
  const call = r.calls.find(c => c.url.includes('magia_schedule_followups'));
  assert.ok(call, 'Must call magia_schedule_followups RPC');
  assert.equal(call.body.p_tenant, 'tenant-sales');
  assert.equal(call.body.p_channel, 'whatsapp');
  assert.equal(call.body.p_chat, '5511999999999@s.whatsapp.net');
  assert.equal(call.body.p_anchor, 'event');
});

test('follow-up M: handoff=true schedules 0 jobs even in sales', async () => {
  const r = await run({
    texts: ['Atendente humano por favor'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'handoff', reason: 'human_request', reply: 'Vou transferir para o Wesley.', state: blank }
  });
  assert.equal(r.result.handoff, true);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up N: failure scheduling follow-up after response was sent does not resend primary reply', async () => {
  const state = { ...blank, intent: 'sell', transaction_mode: 'sell', sell_model: '' };
  const r = await run({
    texts: ['quero vender meu carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpFailure: true,
    response: { action: 'reply', reason: 'none', reply: 'Qual é o modelo do veículo?', state }
  });
  // Exactly 1 message sent to customer
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.sent, true);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.match(r.result.follow_up_error, /FOLLOWUP_RPC_FAILED/);
  assert.equal(r.result.ok, true);
});

// Semantic intent/session regressions for the Genesis Sales Core.
test('semantic guard A: new session vehicle photo remains neutral even when classified as vehicle_photo', async () => {
  const inferred = {...blank,intent:'sell',transaction_mode:'sell',sell_model:'Uno',sell_model_evidence:'e0',
    sell_vehicle:{...blank.sell_vehicle,model:'Uno',evidence_ids:['e0']}};
  const r = await run({texts:['[image]'],imageClassification:'vehicle_photo',response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state:inferred}});
  const outbound=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(r.saved[0].p_state.intent,'unknown');
  assert.equal(r.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(r.saved[0].p_state.sell_model,'');
  assert.equal(outbound.body.raw_payload.pending_requirement,undefined);
  assert.equal(r.sent[0],'Recebi a foto. Como posso ajudar você?');
});

test('semantic guard B: image with greeting starts neutrally and never opens a sale', async () => {
  const r=await run({texts:['[image]\nOi'],response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state:{...blank,intent:'sell',transaction_mode:'sell'}}});
  assert.equal(r.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(r.result.handoff,false);
  assert.equal(r.sent[0],'Olá! Recebi a foto. Como posso ajudar você?');
});

test('semantic guard C: transcribed audio "teste" is a neutral message, never a handoff', async () => {
  const inboundPayloads={e0:{content_type:'audio',audio_metadata:{seconds:1,bytes:18}}};
  const r=await run({texts:['[audio]'],audioEnabled:true,audioTranscript:'teste',inboundPayloads,
    response:{action:'reply',reason:'none',reply:'Certo',state:{...blank,intent:'sell',transaction_mode:'sell'}}});
  assert.equal(r.result.handoff,false);
  assert.equal(r.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(r.sent[0],'Recebi seu áudio. Como posso ajudar?');
  assert.equal(inboundPayloads.e0.audio_processing.status,'transcribed');
  assert.equal(inboundPayloads.e0.audio_processing.text,'teste');
});

test('semantic guard D: live sequence image then audio "teste" remains neutral in both turns', async () => {
  const first=await run({texts:['[image]'],response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state:{...blank,intent:'sell',transaction_mode:'sell'}}});
  assert.equal(first.sent[0],'Recebi a foto. Como posso ajudar você?');
  const audioPayload={e0:{content_type:'audio',audio_metadata:{seconds:1,bytes:18}}};
  const second=await run({texts:['[audio]'],audioEnabled:true,audioTranscript:'teste',inboundPayloads:audioPayload,
    history:[
      {id:'old-image',direction:'inbound',message_text:'[image]',raw_payload:{}},
      {id:'old-neutral-reply',direction:'outbound',ai_provider:'sales_core',message_text:first.sent[0],raw_payload:{}}
    ],response:{action:'reply',reason:'none',reply:'Certo',state:{...blank,intent:'sell',transaction_mode:'sell'}}});
  assert.equal(second.result.handoff,false);
  assert.equal(second.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(second.sent[0],'Recebi seu áudio. Como posso ajudar?');
});

test('semantic guard E: pending attempts before conversation_closed never cross into the new session', async () => {
  const beforeClose='2026-10-05T18:51:39.000Z';
  const state={...blank,intent:'sell',transaction_mode:'sell'};
  const r=await run({texts:['teste'],boundary:{id:'close-1',created_at:beforeClose,service:'conversation_closed'},boundaryId:'close-1',
    history:[
      {id:'old-0',direction:'outbound',ai_provider:'sales_core',created_at:'2026-10-05T18:50:00.000Z',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}},
      {id:'old-1',direction:'outbound',ai_provider:'sales_core',created_at:'2026-10-05T18:50:20.000Z',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}},
      {id:'old-2',direction:'outbound',ai_provider:'sales_core',created_at:'2026-10-05T18:50:40.000Z',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}}
    ],response:{action:'reply',reason:'none',reply:'Certo',state}});
  assert.equal(r.result.handoff,false);
  assert.equal(r.saved[0].p_state.transaction_mode,'unknown');
  assert.equal(r.sent[0],'Certo');
});

test('semantic guard F: first irrelevant reply to a valid pending sell model reorients without handoff', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell'};
  const r=await run({texts:['teste'],lead:{id:'lead-1',revision:1,stage_key:'sales_qualifying',state,ai_locked:false},history:[
    {id:'intent-0',direction:'inbound',message_text:'Quero vender meu carro',raw_payload:{}},
    {id:'ask-0',direction:'outbound',ai_provider:'sales_core',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}}
  ],response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state}});
  assert.equal(r.result.handoff,false);
  assert.equal(r.saved[0].p_stage,'sales_qualifying');
  assert.equal(r.sent[0],'Se quiser continuar a avaliação, me diga o modelo do veículo. Se precisar de outra coisa, pode me falar.');
});

test('semantic guard G: repeated pending requirement in the current session hands off only after the real limit', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell'};
  const r=await run({texts:['teste de novo'],lead:{id:'lead-1',revision:2,stage_key:'sales_qualifying',state,ai_locked:false},history:[
    {id:'intent-0',direction:'inbound',message_text:'Quero vender meu carro',raw_payload:{}},
    {id:'ask-0',direction:'outbound',ai_provider:'sales_core',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}},
    {id:'other-0',direction:'inbound',message_text:'teste',raw_payload:{}},
    {id:'ask-1',direction:'outbound',ai_provider:'sales_core',message_text:'Qual é o modelo?',raw_payload:{pending_requirement:'sell_model'}}
  ],response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state}});
  assert.equal(r.saved[0].p_stage,'sales_human');
  assert.equal(r.result.handoff,true);
  assert.match(r.sent[0],/Wesley continuar por aqui/i);
});

test('semantic guard H: explicit request to speak with Wesley still hands off immediately', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell'};
  const r=await run({texts:['quero falar com Wesley'],lead:{id:'lead-1',revision:1,stage_key:'sales_qualifying',state,ai_locked:false},
    response:{action:'reply',reason:'none',reply:'Qual é o modelo?',state}});
  assert.equal(r.saved[0].p_stage,'sales_human');
  assert.equal(r.result.handoff,true);
  assert.match(r.sent[0],/Wesley continuar por aqui/i);
});

test('semantic guard I: sell intent may use a vehicle photo only when the same turn has textual commercial evidence', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell'};
  const r=await run({texts:['[image]','Quanto vocês pagam nesse carro?'],imageClassification:'vehicle_photo',
    response:{action:'reply',reason:'none',reply:'Certo',state}});
  const outbound=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(r.saved[0].p_state.transaction_mode,'sell');
  assert.equal(r.saved[0].p_state.intent_evidence_id,'e1');
  assert.equal(outbound.body.raw_payload.pending_requirement,'sell_model');
  assert.match(r.sent[0],/modelo/i);
});

test('semantic guard J: photo after pending vehicle_photo satisfies that requirement for an established sale', async () => {
  const state={...blank,intent:'sell',transaction_mode:'sell',intent_evidence_id:'intent-0',sell_model:'Uno',sell_model_evidence:'intent-0',
    sell_vehicle:{...blank.sell_vehicle,model:'Uno',evidence_ids:['intent-0'],maintenance_reported:true,maintenance_evidence_ids:['description-0'],condition_reported:true,condition_evidence_ids:['description-0']}};
  const r=await run({texts:['[image]'],lead:{id:'lead-1',revision:2,stage_key:'sales_qualifying',state,ai_locked:false},history:[
    {id:'intent-0',direction:'inbound',message_text:'Quero vender meu Uno',raw_payload:{}},
    {id:'description-0',direction:'inbound',message_text:'Manutenção em dia e sem avarias',raw_payload:{}},
    {id:'ask-photo',direction:'outbound',ai_provider:'sales_core',message_text:'Pode enviar uma foto?',raw_payload:{pending_requirement:'vehicle_photo'}}
  ],imageClassification:'vehicle_photo',response:{action:'reply',reason:'none',reply:'Certo',state}});
  const outbound=r.calls.find(call=>call.method==='POST'&&call.url.includes('/channel_events'));
  assert.equal(r.saved[0].p_stage,'sales_appraisal');
  assert.equal(outbound.body.raw_payload.pending_requirement,undefined);
  assert.equal(r.saved[0].p_state.transaction_mode,'sell');
});


// =========================================================================
// SECTION 10: FOLLOW-UP ELIGIBILITY & CANCELLATION (A to G)
// =========================================================================

test('follow-up A: IA pergunta "Qual modelo você procura?" e cliente some -> follow_up elegivel', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy', buy_interest: { ...blank.buy_interest, model: '' } };
  const r = await run({
    texts: ['quero comprar um carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: { action: 'reply', reason: 'none', reply: 'Qual modelo você procura?', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
  assert.ok(r.calls.some(c => c.url.includes('magia_schedule_followups')));
});

test('follow-up B: cliente "valeu obrigado" -> resposta cordial e 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['valeu obrigado'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Por nada! Se precisar de mais alguma informação ou quiser conferir nossos veículos disponíveis, estou à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'closed_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
  const patchCall = r.calls.find(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH');
  assert.equal(patchCall.body.status, 'cancelled');
  assert.ok(patchCall.body.updated_at);
  assert.ok(patchCall.body.error);
  assert.equal(patchCall.body.canceled_at, undefined);
  assert.equal(patchCall.body.cancel_reason, undefined);
});

test('follow-up C: cliente "não tenho interesse" -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['não tenho interesse'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Tudo bem! Se precisar de algo no futuro, estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'declined');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up D: cliente "qualquer coisa eu chamo" -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['qualquer coisa eu chamo'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Combinado! Qualquer dúvida estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'deferred_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up E: cliente "vou pensar" -> 0 follow-ups automáticos', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['vou pensar'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Combinado! Qualquer dúvida estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'deferred_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up F: cliente responde novamente antes das 3h -> jobs anteriores cancelados', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy', buy_interest: { ...blank.buy_interest, model: '' } };
  const r1 = await run({
    texts: ['quero comprar um carro'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: { action: 'reply', reason: 'none', reply: 'Qual modelo você procura?', state }
  });
  assert.equal(r1.result.follow_ups_scheduled, 3);

  const r2 = await run({
    texts: ['valeu obrigado'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Por nada! Estamos à disposição.', state }
  });
  assert.equal(r2.result.follow_ups_scheduled, 0);
  assert.ok(r2.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
  const patchCall = r2.calls.find(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH');
  assert.equal(patchCall.body.status, 'cancelled');
  assert.ok(patchCall.body.updated_at);
  assert.ok(patchCall.body.error);
  assert.equal(patchCall.body.canceled_at, undefined);
  assert.equal(patchCall.body.cancel_reason, undefined);
});

test('follow-up G: mensagem sem pending / sem pergunta real -> não agenda', async () => {
  const r = await run({
    texts: ['qual o endereço?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    businessFacts: { locations: [{ verified: true, address: 'Av. Itapemirim, 747' }] }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'not_applicable');
});

// =========================================================================
// SECTION 11: LOCATION, REFERENCE POINT & DIRECTIONS (H to M)
// =========================================================================

test('location H: "qual o endereço?" -> endereço oficial', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['qual o endereço?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0], address);
  assert.equal(r.result.handoff, false);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.optional_human_offer, undefined);
});

test('location I: "tem ponto de referência?" sem reference_point cadastrado -> oferece atendente opcional e handoff=false', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['tem ponto de referência?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.doesNotMatch(r.sent[0], new RegExp(address));
  assert.match(r.sent[0], /Não tenho um ponto de referência confirmado aqui/i);
  assert.match(r.sent[0], /atendente pode te orientar melhor/i);
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.deepEqual(outbound.body.raw_payload.optional_human_offer, { reason: 'location_details' });
});

test('location J: "fica na rua alta ou baixa?" -> não repete endereço nem inventa e handoff=false', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const r = await run({
    texts: ['fica na rua alta ou baixa?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.doesNotMatch(r.sent[0], new RegExp(address));
  assert.match(r.sent[0], /não tenho essa referência de rua alta\/baixa confirmada/i);
  assert.match(r.sent[0], /atendente pode te passar esse detalhe/i);
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.deepEqual(outbound.body.raw_payload.optional_human_offer, { reason: 'location_details' });
});

test('location K: depois da oferta: "sim, pode chamar" -> handoff=true', async () => {
  const history = [
    { id: 'e0', direction: 'inbound', message_text: 'tem ponto de referência?' },
    { id: 'a0', direction: 'outbound', ai_provider: 'sales_core', message_text: 'Não tenho um ponto de referência confirmado aqui. Se quiser, um atendente pode te orientar melhor sobre como chegar.',
      raw_payload: { optional_human_offer: { reason: 'location_details' } } }
  ];
  const r = await run({
    texts: ['sim, pode chamar'],
    history,
    lead: { id: 'lead-1', revision: 1, stage_key: 'sales_qualifying', state: { ...blank, optional_human_offer: { reason: 'location_details' } }, ai_locked: false }
  });
  assert.equal(r.result.handoff, true);
  assert.equal(r.saved[0].p_stage, 'sales_human');
  assert.match(r.sent[0], /Wesley continuar por aqui|equipe continuar por aqui/i);
});

test('location L: "sim" sem oferta humana anterior -> não handoff automaticamente', async () => {
  const r = await run({
    texts: ['sim'],
    history: [],
    response: { action: 'reply', reason: 'none', reply: 'Como posso ajudar você?', state: blank }
  });
  assert.equal(r.result.handoff, false);
  assert.notEqual(r.saved[0].p_stage, 'sales_human');
});

test('location M: business_facts futuramente contém reference_point verificado -> IA responde diretamente sem humano', async () => {
  const address = 'Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil';
  const refPoint = 'Em frente ao posto BR da entrada do bairro';
  const r = await run({
    texts: ['tem ponto de referência?'],
    businessFacts: { locations: [{ id: 'loja', name: 'Genesis Automóveis', address, reference_point: refPoint, verified: true }] }
  });
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0], new RegExp(refPoint));
  assert.doesNotMatch(r.sent[0], /atendente pode te orientar/i);
  assert.equal(r.result.handoff, false);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.optional_human_offer, undefined);
});

// =========================================================================
// SECTION 12: REALISTIC SCHEMA CONTRACT TESTS (FOLLOW_UP_JOBS)
// =========================================================================

test('follow-up schema contract A: rejeita status inválido "canceled" (exige "cancelled" canônico)', () => {
  assert.throws(
    () => validateFollowUpJobsTableOperation('PATCH', new URL('https://db.test/rest/v1/follow_up_jobs'), { status: 'canceled' }),
    /violates check constraint "follow_up_jobs_status_check"/
  );
});

test('follow-up schema contract B: rejeita colunas inexistentes canceled_at e cancel_reason', () => {
  assert.throws(
    () => validateFollowUpJobsTableOperation('PATCH', new URL('https://db.test/rest/v1/follow_up_jobs'), { canceled_at: new Date().toISOString() }),
    /column "canceled_at" of relation "follow_up_jobs" does not exist/
  );
  assert.throws(
    () => validateFollowUpJobsTableOperation('PATCH', new URL('https://db.test/rest/v1/follow_up_jobs'), { cancel_reason: 'disposition_closed' }),
    /column "cancel_reason" of relation "follow_up_jobs" does not exist/
  );
});

test('follow-up schema contract C: cancelPendingFollowUps do core cumpre estritamente o schema (status: cancelled, updated_at, error)', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['valeu obrigado'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Por nada!', state }
  });
  const patchCalls = r.calls.filter(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH');
  assert.ok(patchCalls.length >= 1);
  for (const patch of patchCalls) {
    assert.equal(patch.body.status, 'cancelled');
    assert.ok(typeof patch.body.updated_at === 'string');
    assert.ok(typeof patch.body.error === 'string');
    assert.equal(patch.body.canceled_at, undefined);
    assert.equal(patch.body.cancel_reason, undefined);
    const u = new URL(patch.url);
    assert.equal(u.searchParams.get('channel_type'), 'eq.whatsapp');
    assert.equal(u.searchParams.get('status'), 'eq.pending');
    assert.ok(u.searchParams.get('tenant_id')?.startsWith('eq.'));
    assert.ok(u.searchParams.get('external_conversation_id')?.startsWith('eq.'));
  }
});

// =========================================================================
// SECTION 13: CONTEXTUAL FOLLOW-UP TESTS (A to E)
// =========================================================================

test('follow-up contextual A: cliente pede horário fora do expediente, IA oferece outro horário com pergunta -> awaiting_customer -> follow-up permitido', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['vou chegar aí umas 18:30, segura o carro pra mim?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: {
      action: 'reply',
      reason: 'none',
      reply: 'Como nosso horário vai até as 18:00, você pode agendar para outro momento dentro do expediente. Gostaria de agendar?',
      state
    }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  assert.ok(r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
});

test('follow-up contextual B: cliente "nesse horário não consigo, então deixa" -> declined/closed -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['nesse horário não consigo, então deixa'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Tudo bem! Se precisar, estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'declined');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up contextual C: cliente "outro dia eu vejo" -> deferred_by_customer -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['outro dia eu vejo'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Combinado! Qualquer dúvida estamos à disposição.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'deferred_by_customer');
  assert.ok(r.calls.some(c => c.url.includes('follow_up_jobs') && c.method === 'PATCH'));
});

test('follow-up contextual D: IA somente informa horário/endereço sem perguntar nada -> not_applicable -> 0 follow-ups', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['qual o horário de funcionamento de vocês?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    response: { action: 'reply', reason: 'none', reply: 'Nosso horário de funcionamento é de segunda a sexta das 08:00 às 18:00.', state }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 0);
  assert.ok(!r.calls.some(c => c.url.includes('magia_schedule_followups')));
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'not_applicable');
});

test('follow-up contextual E: IA informa restrição + oferece alternativa com pergunta -> awaiting_customer', async () => {
  const state = { ...blank, intent: 'buy', transaction_mode: 'buy' };
  const r = await run({
    texts: ['consigo passar aí no domingo?'],
    followUpEnabled: true,
    salesFollowUp: { enabled: true },
    followUpJobsScheduled: 3,
    response: {
      action: 'reply',
      reason: 'none',
      reply: 'Não abrimos aos domingos, mas atendemos aos sábados até as 13h. Gostaria de agendar para sábado?',
      state
    }
  });
  assert.equal(r.sent.length, 1);
  assert.equal(r.result.follow_ups_scheduled, 3);
  const outbound = r.calls.find(c => c.method === 'POST' && c.url.includes('/channel_events'));
  assert.equal(outbound.body.raw_payload.follow_up_disposition, 'awaiting_customer');
});
