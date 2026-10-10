// Opt-in provider check. Public inventory and synthetic messages only; no database/WhatsApp writes.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
if (!process.argv.includes('--live')) throw Error('Use --live explicitly; Gemini calls consume quota.');
if (!process.env.GEMINI_API_KEY) throw Error('GEMINI_API_KEY required');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const settings=JSON.parse(read('clients/wesley_automoveis/04_ativar_sales.sql').split('$config$')[1]);
settings.business_facts=JSON.parse(read('clients/wesley_automoveis/03_dados_confirmados.sql').split('$facts$')[1]);
let messages=[];
const ctx=vm.createContext({
  normalizeText:v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(),
  settingsFor:()=>settings,markUsage:()=>{},env:k=>process.env[k],
  groundingHistory:()=>messages,turn:{messages:[]},
  buildDateContext:()=>({today:new Date().toISOString().slice(0,10),timeZone:'America/Sao_Paulo'}),
  helpers:{httpRequest:async({url})=>{
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('INVENTORY_HTTP_'+r.status);return r.text();
  }},
  httpJson:async(method,url,headers,payload)=>{
    const r=await fetch(url,{method,headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
    const body=await r.json();if(!r.ok)throw Error('MODEL_HTTP_'+r.status+'_'+(body.error?.status||''));return body;
  },
});
vm.runInContext(read('n8n/code/whatsapp_sales.js'),ctx);
(async()=>{
  const inventory=await ctx.salesInventory({});
  console.log('Public inventory parsed: '+inventory.length+' vehicles.');
  const cases=[
    {name:'model shorthand',texts:['Quero comprar um Sandero'],check:r=>assert.equal(r.product?.model.toLowerCase(),'sandero gt line')},
    {name:'split name and entry',texts:['Quero comprar um Sandero','Meu nome e Cliente Teste','Tenho 15 mil de entrada'],
      check:r=>{assert.equal(r.state.deposit_cents,1500000);assert.equal(r.state.customer_name,'Cliente Teste');}},
    {name:'interest after documents',texts:['Quero comprar um Sandero','Meu nome e Cliente Teste','Tenho 15 mil de entrada','Enviei os documentos, pode seguir'],
      docs:true,check:r=>assert.equal(r.action,'register_interest')},
    {name:'split PCX variant',texts:['Quero comprar PCX','A de 2018'],check:r=>assert.equal(r.product?.year,2018)},
    {name:'after-sales',texts:['O carro que comprei com voces quebrou'],check:r=>assert.equal(r.reason,'after_sales')},
  ];
  for(const item of cases) {
    messages=item.texts.map((text,i)=>({id:'synthetic-'+i,text,received_at:new Date().toISOString()}));
    ctx.turn.messages=messages.map(m=>({event_id:m.id}));
    const result=await ctx.salesGenerate({},[],inventory,[],{cpf_received:!!item.docs,cnh_received:!!item.docs});
    item.check(result);
    console.log(item.name+': '+result.action+'; tokens='+Number(result.usage.totalTokenCount||0));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
