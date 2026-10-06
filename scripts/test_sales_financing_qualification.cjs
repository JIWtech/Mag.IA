const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.join(process.env.MAGIA_TEST_MODULES||path.join(require('node:os').tmpdir(),'magia-diag-tools/node_modules'),'@electric-sql/pglite'));
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const tid='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',token='33333333-3333-3333-3333-333333333333';
const docs={cpf:'52998224725',cnh:'12345678901',birth_date:'1990-01-02'};

test('financing classification is an AND rule, exact at 30%, scoped and fenced',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table tenant_members(tenant_id uuid,user_id uuid,role text,status text);
      create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz);
      create table kanban_boards(id uuid primary key,tenant_id uuid);
      create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text,channel_type text,
        external_conversation_id text,external_message_id text,direction text,sender_type text,message_text text,service text,stage text,
        handoff boolean,ai_provider text,raw_payload jsonb,created_at timestamptz default clock_timestamp());
      create table conversation_turn_queue(tenant_id uuid,channel_type text,chat_id text,token uuid,phase text,boundary_id text);
      insert into tenants values('${tid}','wesley_automoveis','active',null),('${other}','other','active',null);`);
    await db.exec(read('supabase/migrations/025_sales_capability.sql'));
    const settings={system_prompt:'CUSTOM PROMPT',ai_enabled:true,conversation_capability:'sales_v1',whatsapp_processing_mode:'conversation_core_v1',
      contact_exclusion_enabled:true,follow_up_enabled:true,sales:JSON.parse(read('clients/wesley_automoveis/sales.json'))};
    for (const tenant of [tid,other]) await db.query('insert into tenant_settings values($1,$2,now())',[tenant,settings]);
    await db.exec(read('supabase/migrations/028_sales_financing_qualification.sql'));
    await db.exec(read('supabase/migrations/028_sales_financing_qualification.sql'));
    await db.exec(read('clients/wesley_automoveis/17_qualificacao_financiamento.sql'));
    const activated=(await db.query('select settings from tenant_settings where tenant_id=$1',[tid])).rows[0].settings;
    await db.exec(read('clients/wesley_automoveis/17_qualificacao_financiamento.sql'));
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1',[tid])).rows[0].settings,activated);
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1',[other])).rows[0].settings,settings);
    assert.equal(activated.contact_exclusion_enabled,true);assert.equal(activated.follow_up_enabled,true);
    assert.ok(activated.system_prompt.startsWith('CUSTOM PROMPT'));

    let serial=0;
    async function save({chat='case-'+(++serial),tenant=tid,deposit=1289400,price=4298000,documents=[],revision=0,stage='sales_qualifying',register=false,intent='buy'}={}) {
      if (!revision) await db.query(`insert into conversation_turn_queue values($1,'whatsapp',$2,$3,'sending','initial')`,[tenant,chat,token]);
      const incoming=[];
      for (const extracted of documents) {
        const event=(await db.query(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction) values($1,'whatsapp',$2,'inbound') returning id`,[tenant,chat])).rows[0];
        incoming.push({event_id:event.id,extracted});
      }
      return (await db.query('select magia_sales_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) lead',
        [tenant,chat,'initial',token,revision,'request',{intent,transaction_mode:intent,customer_name:'Test',deposit_cents:deposit},
          price==null?null:{id:'vehicle',price_cents:price},stage,register,incoming])).rows[0].lead;
    }
    for (const [deposit,documents,status] of [
      [1289400,[],'documents_pending'],[null,[docs],'deposit_unknown'],[0,[docs],'deposit_insufficient'],
      [1289399,[docs],'deposit_insufficient'],[1289400,[{...docs,birth_date:''}],'documents_pending'],
      [1289400,[{...docs,cnh:''}],'documents_pending'],[1289400,[{...docs,cpf:''}],'documents_pending'],
      [1289400,[{...docs,birth_date:'2020-02-31'}],'documents_pending'],
    ]) {
      const lead=await save({deposit,documents,stage:'sales_hot'});
      assert.equal(lead.hot,false);assert.equal(lead.stage_key,'sales_qualifying');
      assert.equal(lead.deposit_cents,deposit);assert.equal(lead.state.financing_qualification.status,status);
    }
    let hot=await save({documents:[docs]});
    assert.equal(hot.stage_key,'sales_hot');assert.equal(hot.hot,true);assert.equal(hot.ai_locked,true);
    assert.equal(hot.interest_registered,false,'classification does not invent an interest registration');
    assert.equal(JSON.stringify(hot.state).includes(docs.cpf),false);
    const expensive=await save({documents:[docs],price:10000000});assert.equal(expensive.hot,false);
    const rounded=await save({documents:[docs],price:10001,deposit:3000});assert.equal(rounded.hot,false);
    assert.equal(rounded.state.financing_qualification.minimum_deposit_cents,3001);
    assert.equal((await save({documents:[docs],price:10001,deposit:3001})).hot,true);
    assert.equal((await save({documents:[docs],price:null})).hot,false);
    assert.equal((await save({documents:[docs],intent:'sell',stage:'sales_appraisal'})).stage_key,'sales_appraisal');
    const after=await save({documents:[docs],intent:'after_sales',stage:'sales_after_sales'});assert.equal(after.hot,false);

    let split=await save({chat:'split',deposit:0,documents:[{cpf:docs.cpf}]});
    split=await save({chat:'split',revision:split.revision,documents:[{cnh:docs.cnh,birth_date:docs.birth_date}]});
    assert.equal(split.hot,true);assert.equal(split.stage_key,'sales_hot');
    await assert.rejects(save({chat:'split',revision:split.revision}),/SALES_CONTROL_CHANGED/);
    let entryLast=await save({chat:'entry-last',deposit:null,documents:[docs]});
    entryLast=await save({chat:'entry-last',revision:entryLast.revision});assert.equal(entryLast.hot,true);
    let stale=await save({chat:'stale',documents:[]});
    await assert.rejects(save({chat:'stale',revision:stale.revision+1,documents:[docs]}),/SALES_CONTROL_CHANGED/);
    await db.exec(`update conversation_turn_queue set phase='generating' where chat_id='stale'`);
    await assert.rejects(save({chat:'stale',revision:stale.revision,documents:[docs]}),/STALE_SALES_TURN/);
    const legacy=await save({tenant:other,register:true});assert.equal(legacy.hot,true);assert.equal(legacy.stage_key,'sales_hot');
    assert.equal(legacy.state.financing_qualification,undefined);
    const noDocs=await save({register:true});assert.equal(noDocs.interest_registered,false);assert.equal(noDocs.hot,false);
    const lowRegister=await save({register:true,deposit:0,documents:[docs]});
    assert.equal(lowRegister.interest_registered,false);assert.equal(lowRegister.stage_key,'sales_qualifying');
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select magia_sales_financing_qualification('{}','{}','[]')`),/permission denied/);
  } finally {await db.close();}
});
