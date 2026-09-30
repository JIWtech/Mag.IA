-- Additive, opt-in commercial capability. No existing tenant configuration changes.
begin;
alter table public.kanban_boards add column if not exists settings jsonb;
create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel_type text not null default 'whatsapp' check(channel_type='whatsapp'),
  chat_id text not null,
  session_id text not null,
  stage_key text not null,
  ai_locked boolean not null default false,
  revision integer not null default 1,
  state jsonb not null default '{}',
  product jsonb,
  deposit_cents bigint,
  hot boolean not null default false,
  interest_registered boolean not null default false,
  last_request text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,channel_type,chat_id,session_id)
);
create table if not exists public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lead_id uuid not null references public.sales_leads(id),
  event_id uuid not null references public.channel_events(id),
  extracted jsonb not null,
  verification_status text not null default 'needs_human_review',
  created_at timestamptz not null default now(),
  unique(tenant_id,event_id)
);
alter table public.sales_leads enable row level security;
alter table public.sales_documents enable row level security;
revoke all on public.sales_leads,public.sales_documents from anon,authenticated;
grant all on public.sales_leads,public.sales_documents to service_role;
grant select on public.sales_leads,public.sales_documents to authenticated;
drop policy if exists sales_leads_member_read on public.sales_leads;
create policy sales_leads_member_read on public.sales_leads for select to authenticated using
  (exists(select 1 from public.tenant_members m where m.tenant_id=sales_leads.tenant_id
    and m.user_id=auth.uid() and m.status='active'));
drop policy if exists sales_documents_operator_read on public.sales_documents;
create policy sales_documents_operator_read on public.sales_documents for select to authenticated using
  (exists(select 1 from public.tenant_members m where m.tenant_id=sales_documents.tenant_id
    and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin','manager','operator','agent')));

create or replace function public.magia_sales_save(
  p_tenant uuid,p_chat text,p_session text,p_token uuid,p_revision integer,p_request text,
  p_state jsonb,p_product jsonb,p_stage text,p_register boolean default false,p_documents jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; lead public.sales_leads%rowtype; q public.conversation_turn_queue%rowtype;
  stage text; deposit bigint; price bigint; threshold numeric; hot boolean := false; doc jsonb;
begin
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' or cfg->>'ai_enabled' is distinct from 'true'
    then raise exception 'SALES_DISABLED'; end if;
  select * into q from public.conversation_turn_queue
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending'
    or q.boundary_id<>p_session then raise exception 'STALE_SALES_TURN'; end if;
  if coalesce((select id::text from public.channel_events where tenant_id=p_tenant
    and channel_type='whatsapp' and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial')<>p_session then raise exception 'STALE_SALES_SESSION'; end if;
  -- Same queue lock is used by manual transitions; stale generation cannot overwrite them.
  select * into lead from public.sales_leads where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat and session_id=p_session for update;
  if found and (lead.revision<>p_revision or lead.ai_locked) then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if lead.id is null and p_revision<>0 then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if jsonb_typeof(p_state)<>'object' or length(p_state::text)>12000 then raise exception 'INVALID_SALES_STATE'; end if;
  deposit := nullif(p_state->>'deposit_cents','')::bigint;
  price := nullif(p_product->>'price_cents','')::bigint;
  if deposit<0 or (price is not null and deposit>price) then raise exception 'INVALID_DEPOSIT'; end if;
  threshold := coalesce((cfg->'sdr_rules'->>'hot_lead_percent')::numeric,30);
  if threshold<0 or threshold>100 then raise exception 'INVALID_HOT_LEAD_THRESHOLD'; end if;
  hot := coalesce(price>0 and deposit::numeric*100>=price::numeric*threshold,false);
  stage := p_stage;
  if p_register then
    if nullif(p_state->>'customer_name','') is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
    if p_state->>'intent'='buy' then
      if nullif(p_product->>'id','') is null or price is null then raise exception 'PRODUCT_REQUIRED'; end if;
      stage := cfg->'sales'->'stage_keys'->>(case when hot then 'hot' else 'human' end);
    elsif p_state->>'intent'='sell' then
      stage := cfg->'sales'->'stage_keys'->>'appraisal';
    else raise exception 'INVALID_INTEREST'; end if;
  end if;
  if not (cfg->'sales'->'stages' ? stage) then raise exception 'INVALID_SALES_STAGE'; end if;
  insert into public.sales_leads(tenant_id,chat_id,session_id,stage_key,ai_locked,state,product,
    deposit_cents,hot,interest_registered,last_request)
  values(p_tenant,p_chat,p_session,stage,
    not coalesce((cfg->'sales'->'stages'->stage->>'allow_ai')::boolean,false),
    p_state,p_product,deposit,hot,p_register,p_request)
  on conflict(tenant_id,channel_type,chat_id,session_id) do update set
    stage_key=excluded.stage_key,ai_locked=excluded.ai_locked,state=excluded.state,
    product=excluded.product,deposit_cents=excluded.deposit_cents,hot=excluded.hot,
    interest_registered=sales_leads.interest_registered or excluded.interest_registered,
    last_request=excluded.last_request,revision=sales_leads.revision+1,updated_at=now()
  returning * into lead;
  for doc in select value from jsonb_array_elements(p_documents) loop
    if not exists(select 1 from public.channel_events e where e.id=(doc->>'event_id')::uuid
      and e.tenant_id=p_tenant and e.external_conversation_id=p_chat and e.channel_type='whatsapp'
      and e.direction='inbound') then raise exception 'DOCUMENT_SCOPE_MISMATCH'; end if;
    if length((doc->'extracted')::text)>5000 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
    insert into public.sales_documents(tenant_id,lead_id,event_id,extracted)
    values(p_tenant,lead.id,(doc->>'event_id')::uuid,doc->'extracted') on conflict do nothing;
  end loop;
  return to_jsonb(lead);
end $$;
revoke all on function public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb) to service_role;

create or replace function public.magia_sales_move(p_lead uuid,p_stage text,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare lead public.sales_leads%rowtype; cfg jsonb; slug text; allowed boolean; closed boolean;
begin
  select * into lead from public.sales_leads where id=p_lead;
  if not found or not exists(select 1 from public.tenant_members m where m.tenant_id=lead.tenant_id
    and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin','manager','agent','operator'))
    then raise exception 'SALES_ACCESS_DENIED'; end if;
  perform 1 from public.conversation_turn_queue where tenant_id=lead.tenant_id
    and channel_type=lead.channel_type and chat_id=lead.chat_id for update;
  select * into lead from public.sales_leads where id=p_lead for update;
  if lead.revision<>p_revision then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if coalesce((select id::text from public.channel_events where tenant_id=lead.tenant_id
    and channel_type=lead.channel_type and external_conversation_id=lead.chat_id
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial')<>lead.session_id then raise exception 'SALES_SESSION_CLOSED'; end if;
  select s.settings,t.slug into cfg,slug from public.tenant_settings s join public.tenants t on t.id=s.tenant_id
    where s.tenant_id=lead.tenant_id and t.status='active';
  if cfg->>'conversation_capability' is distinct from 'sales_v1'
    or not (cfg->'sales'->'stages' ? p_stage) then raise exception 'INVALID_SALES_STAGE'; end if;
  allowed := coalesce((cfg->'sales'->'stages'->p_stage->>'allow_ai')::boolean,false);
  closed := coalesce((cfg->'sales'->'stages'->p_stage->>'closed')::boolean,false);
  update public.sales_leads set stage_key=p_stage,ai_locked=not allowed,
    revision=revision+1,updated_at=now() where id=p_lead returning * into lead;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,
    external_message_id,direction,sender_type,message_text,service,stage,handoff,ai_provider,raw_payload)
  values(lead.tenant_id,slug,lead.channel_type,lead.chat_id,'sales_move_'||gen_random_uuid(),
    'outbound','system','Etapa comercial alterada pelo operador.',
    case when closed then 'conversation_closed' when allowed then 'resume_ai' else 'conversation_assigned' end,
    case when closed then 'Finalizado' else cfg->'sales'->'stages'->p_stage->>'name' end,
    not allowed,'sales_operator',jsonb_build_object('sales_lead_id',lead.id,'sales_stage',p_stage,'operator_id',auth.uid()));
  return to_jsonb(lead);
end $$;
revoke all on function public.magia_sales_move(uuid,text,integer) from public,anon;
grant execute on function public.magia_sales_move(uuid,text,integer) to authenticated;

-- Existing human actions also lock the commercial record, without changing legacy tenants.
create or replace function public.magia_sales_human_control()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; target text; session text;
begin
  if coalesce(new.ai_provider,'')='sales_operator' or new.direction is distinct from 'outbound'
    or coalesce(new.service,'') not in ('conversation_closed','conversation_assigned','manual_reply','handoff_requested','resume_ai')
    then return new; end if;
  select settings into cfg from public.tenant_settings where tenant_id=new.tenant_id;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' then return new; end if;
  target := cfg->'sales'->'stage_keys'->>(case when new.service='conversation_closed' then 'closed'
    when new.service='resume_ai' then 'qualifying' else 'human' end);
  perform 1 from public.conversation_turn_queue where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id for update;
  select coalesce((select id::text from public.channel_events where tenant_id=new.tenant_id
    and channel_type=new.channel_type and external_conversation_id=new.external_conversation_id
    and id<>new.id and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial') into session;
  update public.sales_leads set ai_locked=new.service<>'resume_ai',stage_key=target,
    revision=revision+1,updated_at=now()
  where id=(select id from public.sales_leads where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id and session_id=session
    order by created_at desc limit 1);
  return new;
end $$;
drop trigger if exists sales_human_control on public.channel_events;
create trigger sales_human_control after insert on public.channel_events
  for each row execute function public.magia_sales_human_control();
revoke all on function public.magia_sales_human_control() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
