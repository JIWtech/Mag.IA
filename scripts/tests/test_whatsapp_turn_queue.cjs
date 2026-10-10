const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'), '@electric-sql/pglite'));

test('durable queue: grouping, deduplication, fencing, isolation and uncertain delivery', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
      create table channels(tenant_id uuid,type text,status text,external_id text,config jsonb);
      create table tenant_settings(tenant_id uuid,settings jsonb);
      create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text,
        channel_type text,external_conversation_id text,external_message_id text,direction text,sender_type text,
        contact_name text,message_text text,service text,stage text,handoff boolean,ai_provider text,raw_payload jsonb,
        created_at timestamptz default clock_timestamp(),unique(tenant_slug,channel_type,external_message_id));
      create table sales_leads(id uuid primary key default gen_random_uuid(),tenant_id uuid,channel_type text default 'whatsapp',
        chat_id text,session_id text,stage_key text,ai_locked boolean default false,state jsonb,product jsonb,deposit_cents bigint,
        hot boolean default false,interest_registered boolean default false,last_request text,revision integer default 0,
        created_at timestamptz default now(),updated_at timestamptz default now(),unique(tenant_id,channel_type,chat_id,session_id));
      create table sales_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,lead_id uuid,event_id uuid,
        extracted jsonb,unique(tenant_id,event_id));
      insert into tenants values ('11111111-1111-1111-1111-111111111111','clinic','active',null);
      insert into channels values ('11111111-1111-1111-1111-111111111111','whatsapp','active','clinic','{}');
      insert into tenant_settings values ('11111111-1111-1111-1111-111111111111',
        '{"sales":{"stage_keys":{"qualifying":"sales_qualifying"},"stages":{"sales_qualifying":{"allow_ai":true}}}}');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/017_whatsapp_turn_queue.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/026_sales_financing_and_delivery_recovery.sql'),'utf8'));
    const tid='11111111-1111-1111-1111-111111111111';
    const rpc=async(name,args)=> {
      const functionName = name === 'begin_delivery' ? 'magia_begin_turn_delivery' : `magia_${name}_turn`;
      return (await db.query(`select ${functionName}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).rows[0].r;
    };
    const enqueue=(id,text)=>rpc('enqueue',[tid,'chat','clinic',JSON.stringify({id,text,name:'Cliente'}),3000]);
    const quiet=()=>db.exec("update conversation_turn_queue set quiet_until=now()-interval '1 second'");
    for(const [i,text] of ['Oi','Quero agendar','amanha','as 10h'].entries()) await enqueue(String(i),text);
    assert.equal((await enqueue('0','duplicate')).duplicate,true);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'quiet_window');
    await quiet();
    const a=await rpc('claim',[tid,'chat']);
    assert.equal(a.messages.length,4);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'busy');
    await enqueue('4','Sou Maria');
    assert.equal((await rpc('commit',[tid,'chat',a.token])).reason,'new_messages');
    await rpc('finish',[tid,'chat',a.token,'retry']); await quiet();
    const b=await rpc('claim',[tid,'chat']);
    assert.equal(b.messages.length,5);
    assert.equal((await rpc('commit',[tid,'chat',a.token])).reason,'lost_lease');
    assert.equal((await rpc('commit',[tid,'chat',b.token])).committed,true);
    await rpc('finish',[tid,'chat',b.token,'done']);
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n,5);
    await assert.rejects(rpc('enqueue',[tid,'chat','wrong-instance',JSON.stringify({id:'wrong'}),3000]),/Instance/);
    await enqueue('5','nova mensagem'); await quiet(); const c=await rpc('claim',[tid,'chat']);
    await db.exec(`insert into channel_events(tenant_slug,channel_type,external_conversation_id,service)
      values('clinic','whatsapp','chat','conversation_closed')`);
    assert.equal((await rpc('commit',[tid,'chat',c.token])).reason,'conversation_control_changed');
    await rpc('finish',[tid,'chat',c.token,'cancelled']);
    await enqueue('6','depois de encerrar'); await quiet(); const d=await rpc('claim',[tid,'chat']);
    assert.equal((await rpc('commit',[tid,'chat',d.token])).committed,true);
    await rpc('finish',[tid,'chat',d.token,'uncertain']);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'delivery_uncertain');
    await enqueue('7','mensagem nova apos envio incerto'); await quiet();
    const afterUncertain=await rpc('claim',[tid,'chat']);
    assert.equal(afterUncertain.claimed,true);
    assert.deepEqual(afterUncertain.messages.map(message=>message.id),['7']);
    await rpc('finish',[tid,'chat',afterUncertain.token,'done']);

    await enqueue('8','turno confirmado por evento'); await quiet();
    const confirmedTurn=await rpc('claim',[tid,'chat']);
    assert.equal((await rpc('commit',[tid,'chat',confirmedTurn.token])).committed,true);
    const attempt=await rpc('begin_delivery',[tid,'chat',confirmedTurn.token]);
    await db.query(`insert into channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,
      external_message_id,direction,sender_type,raw_payload) values($1,'clinic','whatsapp','chat','provider-8','outbound','assistant',$2)`,
      [tid,JSON.stringify({delivery_attempt_id:attempt.id})]);
    await rpc('finish',[tid,'chat',confirmedTurn.token,'uncertain']);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'quiet_window');
    const delivery=(await db.query('select status,outbound_event_id from conversation_turn_delivery_attempts where id=$1',[attempt.id])).rows[0];
    assert.equal(delivery.status,'confirmed');assert.ok(delivery.outbound_event_id);

    await enqueue('9','corrigindo: quero comprar'); await quiet();
    const correctionTurn=await rpc('claim',[tid,'chat']);
    await db.query(`insert into sales_leads(tenant_id,chat_id,session_id,stage_key,ai_locked,state,revision)
      values($1,'chat',$2,'sales_human',true,$3,0)`,[tid,correctionTurn.boundary_id,JSON.stringify({intent:'sell',transaction_mode:'sell',
        sell_brand:'Peugeot',sell_model:'207',sell_year:2010,sell_vehicle:{brand:'Peugeot',model:'207',year:2010,eligibility:'rejected'}})]);
    const reopened=(await db.query('select magia_sales_reopen_correction($1,$2,$3,$4,$5,$6,$7) lead',
      [tid,'chat',correctionTurn.boundary_id,correctionTurn.token,0,'9','buy'])).rows[0].lead;
    assert.equal(reopened.ai_locked,false);assert.equal(reopened.stage_key,'sales_qualifying');
    assert.equal(reopened.state.intent,'buy');assert.equal(reopened.state.sell_vehicle.eligibility,'unknown');
    await rpc('finish',[tid,'chat',correctionTurn.token,'done']);
    await db.exec('set role authenticated');
    await assert.rejects(rpc('claim',[tid,'chat']),/permission denied/);
  } finally { await db.close(); }
});
