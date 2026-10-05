// Local UI smoke test with synthetic data and intercepted Supabase HTTP requests.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const os=require('node:os');
const {chromium}=require(path.join(os.tmpdir(),'magia-diag-tools/node_modules/playwright'));
const {spawn}=require('node:child_process');
const sales=require('../clients/wesley_automoveis/sales.json');
const ref='sales-preview';
const user={id:'8fb2bc06-94d5-4abe-83b2-1aed41a346ae',email:'synthetic@example.invalid',role:'authenticated'};
const tenant={id:'74b57037-9349-4a9e-889c-b65fb63c983a',slug:'wesley_automoveis',name:'Wesley Automoveis',status:'active'};
const jwtPart=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const token=jwtPart({alg:'HS256',typ:'JWT'})+'.'+jwtPart({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.synthetic';
let lead={id:'lead-synthetic',tenant_id:tenant.id,revision:1,stage_key:'sales_hot',ai_locked:true,
  chat_id:'5511000000000@s.whatsapp.net',state:{customer_name:'Cliente Sintetico'},product:{name:'Renault Sandero GT Line',year:2016,color:'Branco'},
  deposit_cents:1289400,updated_at:new Date().toISOString()};
(async()=>{
  const server=spawn(process.execPath,[path.join(__dirname,'../app/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5175','--strictPort'],{
    cwd:path.join(__dirname,'../app'),windowsHide:true,stdio:'ignore',
    env:{...process.env,VITE_SUPABASE_URL:'https://sales-preview.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic-anon',VITE_REQUIRE_AUTH:'true'}});
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:'msedge'});
    for(let i=0;i<40;i++) {
      if(await fetch('http://127.0.0.1:5175').then(r=>r.ok).catch(()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const context=await browser.newContext();
    await context.routeWebSocket('wss://**',socket=>socket.close());
    await context.addInitScript(({key,token,user})=>{
      localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
      localStorage.setItem('magia:selected-tenant-slug','wesley_automoveis');
      localStorage.setItem('magia:active-page','kanban');
      sessionStorage.setItem('noria:session-bootstrapped','1');
    },{key:'sb-'+ref+'-auth-token',token,user});
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='127.0.0.1'||u.hostname==='localhost')return route.continue();
      if(!u.hostname.endsWith('.supabase.co'))return route.abort();
      let data=[];const table=u.pathname.split('/').at(-1);
      if(u.pathname==='/auth/v1/user')data=user;
      else if(table==='tenant_members')data=[{user_id:user.id,role:'owner',status:'active',tenants:tenant}];
      else if(table==='tenants')data=[tenant];
      else if(table==='tenant_settings')data=[{settings:{enabled_channels:['whatsapp'],conversation_capability:'sales_v1',sales}}];
      else if(table==='kanban_boards')data=[{id:'board',tenant_id:tenant.id,is_default:true,settings:{capability:'sales_v1',stages:sales.stages}}];
      else if(table==='kanban_columns')data=Object.entries(sales.stages).map(([key,v],i)=>({id:key,board_id:'board',automation_key:key,name:v.name,position:i}));
      else if(table==='sales_leads')data=[lead];
      else if(table==='sales_documents')data=[{lead_id:lead.id,verification_status:'needs_human_review',extracted:{name:'Cliente Sintetico',cpf:'DADO SINTETICO',cnh:'DADO SINTETICO',birth_date:'DADO SINTETICO'}}];
      else if(table==='magia_sales_move'){
        const p=route.request().postDataJSON();assert.equal(p.p_lead,lead.id);assert.equal(p.p_revision,lead.revision);
        lead={...lead,stage_key:p.p_stage,revision:lead.revision+1};data=lead;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
      await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:5175');
      await page.getByText('Cliente Sintetico',{exact:true}).first().waitFor({timeout:20000});
      await page.getByText('Documentos para conferir',{exact:true}).click();
      await page.getByText('Conferencia humana pendente',{exact:true}).waitFor();
      const bad=await page.locator('.sales-document-details').evaluate(el=>el.scrollWidth>el.clientWidth+1);
      assert.equal(bad,false);
      const output=path.join(os.tmpdir(),'wesley-sales-'+name+'.png');await page.screenshot({path:output,fullPage:true});
      console.log(name+': rendered card/documents; screenshot '+output);
    }
    await page.getByRole('button',{name:'Finalizar',exact:true}).click();
    await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Finalizar'));
    assert.equal(lead.stage_key,'sales_closed');
    console.log('Finish action uses commercial RPC and closed-stage metadata.');
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
