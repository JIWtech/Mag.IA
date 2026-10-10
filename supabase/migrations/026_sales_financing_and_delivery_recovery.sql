-- Additive reconciliation for sales financing, correction reopen and idempotent queue recovery.
-- Prepared locally only. This migration is not applied automatically.
begin;

create table if not exists public.conversation_turn_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel_type text not null default 'whatsapp' check(channel_type='whatsapp'),
  chat_id text not null,
  session_id text not null,
  turn_token uuid not null unique,
  status text not null check(status in ('attempting','confirmed','uncertain','superseded_uncertain')),
  claimed_event_ids jsonb not null default '[]'::jsonb,
  provider_message_id text,
  outbound_event_id uuid references public.channel_events(id),
  attempted_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  resolved_at timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists conversation_turn_delivery_scope_idx
  on public.conversation_turn_delivery_attempts(tenant_id,channel_type,chat_id,created_at desc);
alter table public.conversation_turn_delivery_attempts enable row level security;
revoke all on public.conversation_turn_delivery_attempts from anon,authenticated;
grant all on public.conversation_turn_delivery_attempts to service_role;

alter table public.conversation_turn_queue
  add column if not exists current_delivery_id uuid references public.conversation_turn_delivery_attempts(id);

create or replace function public.magia_begin_turn_delivery(p_tenant uuid,p_chat text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; attempt public.conversation_turn_delivery_attempts%rowtype;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending'
    then raise exception 'STALE_DELIVERY_ATTEMPT'; end if;
  insert into public.conversation_turn_delivery_attempts(tenant_id,chat_id,session_id,turn_token,status,claimed_event_ids)
  values(p_tenant,p_chat,q.boundary_id,p_token,'attempting',coalesce((
    select jsonb_agg(value->>'event_id') from jsonb_array_elements(q.claimed)
  ),'[]'::jsonb))
  on conflict(turn_token) do update set updated_at=clock_timestamp()
  returning * into attempt;
  update public.conversation_turn_queue set current_delivery_id=attempt.id,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('id',attempt.id,'status',attempt.status);
end $$;

create or replace function public.magia_confirm_turn_delivery(
  p_tenant uuid,p_chat text,p_token uuid,p_attempt uuid,p_provider_message text,p_outbound_event uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; affected integer;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.current_delivery_id is distinct from p_attempt
    then return jsonb_build_object('confirmed',false,'reason','stale_delivery'); end if;
  update public.conversation_turn_delivery_attempts set status='confirmed',provider_message_id=p_provider_message,
    outbound_event_id=p_outbound_event,confirmed_at=clock_timestamp(),resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_attempt and tenant_id=p_tenant and turn_token=p_token;
  get diagnostics affected=row_count;
  return jsonb_build_object('confirmed',affected=1);
end $$;

create or replace function public.magia_claim_turn(p_tenant uuid, p_chat text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; b text; k uuid; s text; delivered uuid;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found then return jsonb_build_object('claimed',false,'reason','empty'); end if;
  if q.phase='uncertain' then
    select e.id into delivered from public.channel_events e
      where e.tenant_id=p_tenant and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
        and e.direction='outbound' and e.raw_payload->>'delivery_attempt_id'=q.current_delivery_id::text
      order by e.created_at desc limit 1;
    if delivered is not null then
      update public.conversation_turn_delivery_attempts set status='confirmed',outbound_event_id=delivered,
        confirmed_at=coalesce(confirmed_at,clock_timestamp()),resolved_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=q.current_delivery_id;
      update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',
        current_delivery_id=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
      select * into q from public.conversation_turn_queue where tenant_id=p_tenant
        and channel_type='whatsapp' and chat_id=p_chat;
    elsif jsonb_array_length(q.pending)=0 or q.quiet_until>clock_timestamp() then
      return jsonb_build_object('claimed',false,'reason','delivery_uncertain');
    else
      update public.conversation_turn_delivery_attempts set status='superseded_uncertain',resolved_at=clock_timestamp(),
        updated_at=clock_timestamp(),error_code='newer_inbound_without_delivery_proof'
        where id=q.current_delivery_id and status<>'confirmed';
      update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',
        current_delivery_id=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
      select * into q from public.conversation_turn_queue where tenant_id=p_tenant
        and channel_type='whatsapp' and chat_id=p_chat;
    end if;
  end if;
  if q.token is not null and q.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','busy'); end if;
  if q.phase='sending' then
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    update public.conversation_turn_delivery_attempts set status='uncertain',updated_at=clock_timestamp(),
      error_code=coalesce(error_code,'sending_lease_expired') where id=q.current_delivery_id and status<>'confirmed';
    return jsonb_build_object('claimed',false,'reason','delivery_uncertain');
  end if;
  if q.token is not null then q.pending:=q.claimed||q.pending; end if;
  if jsonb_array_length(q.pending)=0 or q.quiet_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','quiet_window'); end if;
  select slug into s from public.tenants where id=p_tenant;
  select id::text into b from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  k:=gen_random_uuid();
  update public.conversation_turn_queue set token=k,phase='processing',claimed=q.pending,pending='[]',
    lease_until=clock_timestamp()+interval '180 seconds',claimed_at=clock_timestamp(),current_delivery_id=null,
    boundary_id=coalesce(b,'initial'),updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('claimed',true,'token',k,'messages',q.pending,
    'boundary_id',coalesce(b,'initial'),'instance',q.instance_name,'tenant_slug',s);
end $$;

create or replace function public.magia_finish_turn(p_tenant uuid,p_chat text,p_token uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype;
begin
  if p_outcome not in ('done','retry','cancelled','failed','uncertain') then raise exception 'Invalid outcome'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token then return jsonb_build_object('finished',false); end if;
  if p_outcome='retry' and q.phase<>'processing' then raise exception 'Cannot retry committed turn'; end if;
  if p_outcome='uncertain' then
    update public.conversation_turn_delivery_attempts set status='uncertain',updated_at=clock_timestamp(),
      error_code=coalesce(error_code,'provider_confirmation_missing') where id=q.current_delivery_id and status<>'confirmed';
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  else
    update public.conversation_turn_queue set pending=case when p_outcome='retry' then claimed||pending else pending end,
      claimed='[]',token=null,lease_until=null,phase='ready',current_delivery_id=null,updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  end if;
  return jsonb_build_object('finished',true,'outcome',p_outcome);
end $$;

create or replace function public.magia_sales_reopen_correction(
  p_tenant uuid,p_chat text,p_session text,p_token uuid,p_revision integer,p_request text,p_new_intent text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; lead public.sales_leads%rowtype; cfg jsonb; next_state jsonb; target text;
begin
  if p_new_intent not in ('buy','sell') then raise exception 'INVALID_SALES_INTENT'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'processing' or q.boundary_id<>p_session
    then raise exception 'STALE_SALES_TURN'; end if;
  select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=p_session for update;
  if not found or lead.revision<>p_revision or not lead.ai_locked then raise exception 'SALES_CONTROL_CHANGED'; end if;
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant;
  target:=cfg->'sales'->'stage_keys'->>'qualifying';
  if target is null or not (cfg->'sales'->'stages' ? target) then raise exception 'INVALID_SALES_STAGE'; end if;
  next_state:=lead.state||jsonb_build_object('intent',p_new_intent,'transaction_mode',p_new_intent,'intent_evidence_id',p_request);
  if p_new_intent='buy' then
    next_state:=(next_state-'sell_brand'-'sell_model'-'sell_year'-'sell_brand_evidence'-'sell_model_evidence'-'sell_year_evidence')
      ||jsonb_build_object('sell_vehicle',jsonb_build_object('brand','','model','','year',null,'raw_mention','','description_summary','',
        'reported_facts','[]'::jsonb,'concerns','[]'::jsonb,'maintenance_history','[]'::jsonb,'evidence_ids','[]'::jsonb,
        'maintenance_reported',false,'maintenance_evidence_ids','[]'::jsonb,'condition_reported',false,
        'condition_evidence_ids','[]'::jsonb,'eligibility','unknown','rejection_reason','','rejection_evidence_ids','[]'::jsonb,'rejected_at',''));
  else
    next_state:=(next_state-'product_id'-'product_evidence'-'product_variant_evidence'-'deposit_cents'-'deposit_evidence')
      ||jsonb_build_object('buy_interest',jsonb_build_object('brand','','model','','year',null,'raw_mention','','product_id','','evidence_ids','[]'::jsonb));
  end if;
  update public.sales_leads set state=next_state,product=case when p_new_intent='buy' then product else null end,
    deposit_cents=case when p_new_intent='buy' then deposit_cents else null end,hot=false,interest_registered=false,
    stage_key=target,ai_locked=false,last_request=p_request,revision=revision+1,updated_at=clock_timestamp()
    where id=lead.id returning * into lead;
  return to_jsonb(lead);
end $$;

-- Replace the save RPC for databases where migration 025 was already applied.
create or replace function public.magia_sales_save(
  p_tenant uuid,p_chat text,p_session text,p_token uuid,p_revision integer,p_request text,
  p_state jsonb,p_product jsonb,p_stage text,p_register boolean default false,p_documents jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; lead public.sales_leads%rowtype; q public.conversation_turn_queue%rowtype;
  stage text; deposit bigint; price bigint; threshold numeric; hot boolean := false; doc jsonb;
  hot_rule text; required_docs jsonb; docs_complete boolean := false;
  have_cpf boolean := false; have_cnh boolean := false; have_birth_date boolean := false;
begin
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' or cfg->>'ai_enabled' is distinct from 'true'
    then raise exception 'SALES_DISABLED'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending' or q.boundary_id<>p_session
    then raise exception 'STALE_SALES_TURN'; end if;
  if coalesce((select id::text from public.channel_events where tenant_id=p_tenant and channel_type='whatsapp'
    and external_conversation_id=p_chat and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial')<>p_session then raise exception 'STALE_SALES_SESSION'; end if;
  select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=p_session for update;
  if found and (lead.revision<>p_revision or lead.ai_locked) then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if lead.id is null and p_revision<>0 then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if jsonb_typeof(p_state)<>'object' or length(p_state::text)>12000 then raise exception 'INVALID_SALES_STATE'; end if;
  deposit:=nullif(p_state->>'deposit_cents','')::bigint;
  price:=nullif(p_product->>'price_cents','')::bigint;
  if deposit<0 or (price is not null and deposit>price) then raise exception 'INVALID_DEPOSIT'; end if;
  hot_rule:=cfg->'sales'->>'hot_lead_rule';
  threshold:=nullif(cfg->'sdr_rules'->>'hot_lead_percent','')::numeric;
  required_docs:=coalesce(cfg->'sales'->'required_financing_documents','[]'::jsonb);
  if hot_rule='deposit_and_financing_documents_v2' then
    if threshold is null or threshold<=0 or threshold>100 then raise exception 'INVALID_HOT_LEAD_THRESHOLD'; end if;
    if cfg->'sales'->>'collect_documents' is distinct from 'true'
      or jsonb_typeof(required_docs)<>'array' or jsonb_array_length(required_docs)=0
      or exists(select 1 from jsonb_array_elements_text(required_docs) as required(value)
        where required.value not in ('cpf','cnh','birth_date'))
      then raise exception 'INVALID_FINANCING_DOCUMENT_POLICY'; end if;
    select coalesce(bool_or(length(regexp_replace(coalesce(x->>'cpf',''),'\D','','g'))=11),false),
      coalesce(bool_or(length(regexp_replace(coalesce(x->>'cnh',''),'\D','','g'))=11),false),
      coalesce(bool_or(coalesce(x->>'birth_date','')~'^\d{4}-\d{2}-\d{2}$'),false)
      into have_cpf,have_cnh,have_birth_date
    from (select extracted x from public.sales_documents where lead_id=lead.id
      union all select value->'extracted' from jsonb_array_elements(p_documents)) docs;
    docs_complete:=(not (required_docs ? 'cpf') or have_cpf) and (not (required_docs ? 'cnh') or have_cnh)
      and (not (required_docs ? 'birth_date') or have_birth_date);
    hot:=coalesce(price>0 and deposit is not null and deposit::numeric*100>=price::numeric*threshold and docs_complete,false);
  end if;
  stage:=p_stage;
  if p_register then
    if nullif(p_state->>'customer_name','') is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
    if p_state->>'intent'='buy' then
      if nullif(p_product->>'id','') is null or price is null then raise exception 'PRODUCT_REQUIRED'; end if;
      stage:=cfg->'sales'->'stage_keys'->>(case when hot then 'hot' else 'qualifying' end);
    elsif p_state->>'intent'='sell' then stage:=cfg->'sales'->'stage_keys'->>'appraisal';
    else raise exception 'INVALID_INTEREST'; end if;
  end if;
  if not (cfg->'sales'->'stages' ? stage) then raise exception 'INVALID_SALES_STAGE'; end if;
  insert into public.sales_leads(tenant_id,chat_id,session_id,stage_key,ai_locked,state,product,deposit_cents,hot,interest_registered,last_request)
  values(p_tenant,p_chat,p_session,stage,not coalesce((cfg->'sales'->'stages'->stage->>'allow_ai')::boolean,false),
    p_state,p_product,deposit,hot,p_register,p_request)
  on conflict(tenant_id,channel_type,chat_id,session_id) do update set stage_key=excluded.stage_key,ai_locked=excluded.ai_locked,
    state=excluded.state,product=excluded.product,deposit_cents=excluded.deposit_cents,hot=excluded.hot,
    interest_registered=sales_leads.interest_registered or excluded.interest_registered,last_request=excluded.last_request,
    revision=sales_leads.revision+1,updated_at=now() returning * into lead;
  for doc in select value from jsonb_array_elements(p_documents) loop
    if not exists(select 1 from public.channel_events e where e.id=(doc->>'event_id')::uuid and e.tenant_id=p_tenant
      and e.external_conversation_id=p_chat and e.channel_type='whatsapp' and e.direction='inbound')
      then raise exception 'DOCUMENT_SCOPE_MISMATCH'; end if;
    if length((doc->'extracted')::text)>5000 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
    insert into public.sales_documents(tenant_id,lead_id,event_id,extracted)
      values(p_tenant,lead.id,(doc->>'event_id')::uuid,doc->'extracted') on conflict do nothing;
  end loop;
  return to_jsonb(lead);
end $$;

revoke all on function public.magia_begin_turn_delivery(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_sales_reopen_correction(uuid,text,text,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.magia_begin_turn_delivery(uuid,text,uuid) to service_role;
grant execute on function public.magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid) to service_role;
grant execute on function public.magia_sales_reopen_correction(uuid,text,text,uuid,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
