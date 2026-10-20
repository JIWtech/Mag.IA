-- DRAFT FOR REVIEW ONLY. Do not deploy separately from the corresponding CORE.
-- Closure/REVIEW integration below is a LOCAL amendment, not yet deployed.
-- Source baseline: reference/turn_queue_production_20261018.md (read-only export).
-- No message recovery, policy seeding, queue draining or provider sends here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Restore the missing local delivery schema; production already has this table.
create table if not exists public.conversation_turn_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel_type text not null default 'whatsapp' check (channel_type='whatsapp'),
  chat_id text not null, session_id text not null, turn_token uuid not null unique,
  status text not null check (status in ('attempting','confirmed','uncertain','superseded_uncertain')),
  claimed_event_ids jsonb not null default '[]', provider_message_id text,
  outbound_event_id uuid references public.channel_events(id),
  attempted_at timestamptz not null default clock_timestamp(), confirmed_at timestamptz,
  resolved_at timestamptz, error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.conversation_turn_delivery_attempts enable row level security;
revoke all on public.conversation_turn_delivery_attempts from public,anon,authenticated;
grant all on public.conversation_turn_delivery_attempts to service_role;

-- No arbitrary retry limit is installed. Missing tenant policy allows an initial
-- execution, then holds failures for review; automated retries require approval
-- of explicit persistent policy values. Snapshot policy for each active batch.
create table if not exists public.conversation_turn_retry_policy (
  tenant_id uuid primary key references public.tenants(id),
  max_attempts integer not null check (max_attempts between 1 and 100),
  base_backoff_seconds integer not null check (base_backoff_seconds between 1 and 86400),
  max_backoff_seconds integer not null check (max_backoff_seconds between base_backoff_seconds and 604800)
);
alter table public.conversation_turn_retry_policy enable row level security;
revoke all on public.conversation_turn_retry_policy from public,anon,authenticated;
grant all on public.conversation_turn_retry_policy to service_role;

alter table public.conversation_turn_queue
  add column if not exists current_delivery_id uuid references public.conversation_turn_delivery_attempts(id),
  add column if not exists retry_batch_id uuid,
  add column if not exists attempt_count integer not null default 0 check (attempt_count>=0),
  add column if not exists retry_max_attempts integer,
  add column if not exists retry_base_seconds integer,
  add column if not exists retry_cap_seconds integer,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists review_required_at timestamptz;
alter table public.conversation_turn_queue drop constraint if exists conversation_turn_queue_phase_check;
alter table public.conversation_turn_queue add constraint conversation_turn_queue_phase_check
  check (phase in ('ready','processing','sending','uncertain','review'));

-- Terminal receipts preserve the consumed batch and the server-validated proof.
-- Runtime cannot manufacture receipts by inserting directly into this table.
create table if not exists public.conversation_turn_terminal_receipts (
  turn_token uuid primary key, tenant_id uuid not null references public.tenants(id),
  chat_id text not null, outcome text not null check (outcome in ('done','cancelled')),
  claimed jsonb not null, evidence jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.conversation_turn_terminal_receipts enable row level security;
revoke all on public.conversation_turn_terminal_receipts from public,anon,authenticated,service_role;
grant select on public.conversation_turn_terminal_receipts to service_role;

-- Provenance is issued outside the CORE, with a separate authenticated identity.
-- No sources/credentials/authorizations are seeded by this draft.
create table if not exists public.conversation_turn_ingress_sources (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
  instance_name text not null,principal_id uuid not null unique references auth.users(id),
  enabled boolean not null default false
);
create table if not exists public.conversation_turn_ingress_facts (
  source_id uuid not null references public.conversation_turn_ingress_sources(id),
  tenant_id uuid not null,chat_id text not null,instance_name text not null,external_message_id text not null,
  body_sha256 text not null,from_me boolean not null,owner_saved boolean,business_account boolean,phone_jid text,
  received_at timestamptz not null default clock_timestamp(),primary key(source_id,external_message_id)
);
create table if not exists public.conversation_turn_suppression_authorizations (
  tenant_id uuid not null references public.tenants(id),chat_id text not null,turn_token uuid not null,
  kind text not null check(kind in ('commercial_contact','owner_saved_contact','non_customer','silent_ack')),
  actor_id uuid not null references auth.users(id),claimed jsonb not null,note text not null,
  created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,chat_id,turn_token,kind)
);
alter table public.conversation_turn_ingress_sources enable row level security;
alter table public.conversation_turn_ingress_facts enable row level security;
alter table public.conversation_turn_suppression_authorizations enable row level security;
revoke all on public.conversation_turn_ingress_sources,public.conversation_turn_ingress_facts,
  public.conversation_turn_suppression_authorizations from public,anon,authenticated,service_role;
grant select on public.conversation_turn_ingress_sources,public.conversation_turn_ingress_facts,
  public.conversation_turn_suppression_authorizations to service_role;

create or replace function public.magia_attest_turn_ingress(p_source uuid,p_envelope jsonb,p_digest text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare src public.conversation_turn_ingress_sources%rowtype; d jsonb; k jsonb; os boolean; ba boolean; phone text;
  prior public.conversation_turn_ingress_facts%rowtype;
begin
  select * into src from public.conversation_turn_ingress_sources where id=p_source and enabled
    and principal_id=auth.uid() for share;
  if not found then raise exception 'INGRESS_SOURCE_FORBIDDEN'; end if;
  d:=p_envelope->'data'; k:=coalesce(d->'key',d#>'{message,key}');
  if p_digest is null or p_digest!~'^[a-f0-9]{64}$' or p_envelope->>'instance' is distinct from src.instance_name
    or nullif(k->>'id','') is null or nullif(k->>'remoteJid','') is null or k->'fromMe' is null
    or k->'fromMe' not in ('true'::jsonb,'false'::jsonb)
    or not exists(select 1 from public.channels where tenant_id=src.tenant_id and type='whatsapp' and status='active'
      and (external_id=src.instance_name or config->>'instance_name'=src.instance_name)) then raise exception 'INGRESS_SCOPE_MISMATCH'; end if;
  -- Strict provider booleans only. No contact_category/CORE flags/phone heuristics.
  os:=case when d->'isMyContact' in ('true'::jsonb,'false'::jsonb) then (d->>'isMyContact')::boolean
    when d#>'{contact,isMyContact}' in ('true'::jsonb,'false'::jsonb) then (d#>>'{contact,isMyContact}')::boolean else null end;
  ba:=case when d->'isBusiness' in ('true'::jsonb,'false'::jsonb) then (d->>'isBusiness')::boolean
    when d->'isEnterprise' in ('true'::jsonb,'false'::jsonb) then (d->>'isEnterprise')::boolean else null end;
  phone:=case when k->>'remoteJid' ~ '^[1-9][0-9]{9,14}@s[.]whatsapp[.]net$' then k->>'remoteJid'
    when k->>'remoteJidAlt' ~ '^[1-9][0-9]{9,14}@s[.]whatsapp[.]net$' then k->>'remoteJidAlt' else null end;
  insert into public.conversation_turn_ingress_facts(source_id,tenant_id,chat_id,instance_name,external_message_id,
    body_sha256,from_me,owner_saved,business_account,phone_jid)
    values(src.id,src.tenant_id,k->>'remoteJid',src.instance_name,k->>'id',p_digest,(k->>'fromMe')::boolean,os,ba,phone) on conflict do nothing;
  select * into prior from public.conversation_turn_ingress_facts where source_id=src.id and external_message_id=k->>'id';
  if prior.body_sha256 is distinct from p_digest or prior.chat_id is distinct from k->>'remoteJid' then
    raise exception 'INGRESS_REPLAY_MISMATCH'; end if;
  return jsonb_build_object('attested',true,'tenant_id',src.tenant_id);
end $$;

-- Server-only evaluation of existing configuration/state and independent facts.
create or replace function public.magia_turn_suppression_status(p_tenant uuid,p_chat text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; cfg jsonb; l public.sales_leads%rowtype;
  f public.conversation_turn_ingress_facts%rowtype; a public.conversation_turn_suppression_authorizations%rowtype;
  facts jsonb:='{}'; candidates text[]; excluded text; control_proof jsonb;
  latest_control public.channel_events%rowtype;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then raise exception 'STALE_SUPPRESSION_TURN'; end if;
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant for share;
  if not found then raise exception 'TENANT_CONFIGURATION_MISSING'; end if;
  if cfg->>'ai_enabled'='false' then facts:=facts||jsonb_build_object('ai_disabled',jsonb_build_object('source','tenant_settings','enabled',false)); end if;
  select * into l from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=q.boundary_id for share;
  if found and l.ai_locked and cfg#>'{sales,stages}' ? l.stage_key
    and cfg#>>array['sales','stages',l.stage_key,'allow_ai'] is distinct from 'true' then
    facts:=facts||jsonb_build_object('lead_locked',jsonb_build_object('source','sales_leads+tenant_settings','lead_id',l.id,'revision',l.revision,'stage_key',l.stage_key));
  end if;
  select x.* into f from public.conversation_turn_ingress_facts x join public.conversation_turn_ingress_sources s on s.id=x.source_id
    where x.tenant_id=p_tenant and x.chat_id=p_chat and x.instance_name=q.instance_name and s.enabled and not x.from_me
      and s.tenant_id=x.tenant_id and s.instance_name=x.instance_name
      and exists(select 1 from jsonb_array_elements(q.claimed) m where m->>'id'=x.external_message_id)
    order by x.received_at desc,x.external_message_id desc limit 1 for share of x,s;
  if found then
    if f.owner_saved is true then facts:=facts||jsonb_build_object('owner_saved_contact',jsonb_build_object('source','authenticated_ingress','source_id',f.source_id,'message_id',f.external_message_id,'digest',f.body_sha256)); end if;
    if f.business_account is true then facts:=facts||jsonb_build_object('commercial_contact',jsonb_build_object('source','authenticated_ingress','source_id',f.source_id,'message_id',f.external_message_id,'digest',f.body_sha256)); end if;
  end if;
  if cfg->'contact_exclusion_enabled'='true'::jsonb or cfg->>'contact_exclusion_enabled'='true' then
    -- LID aliases only from authenticated ingress, never mutable raw_payload.
    candidates:=public.magia_exclusion_phone_candidates(case when p_chat like '%@lid' then f.phone_jid else p_chat end);
    select phone into excluded from public.tenant_ai_excluded_contacts where tenant_id=p_tenant and phone=any(candidates) order by phone limit 1 for share;
    if found then facts:=facts||jsonb_build_object('contact_excluded',jsonb_build_object('source','tenant_ai_excluded_contacts','phone',excluded)); end if;
  end if;
  for a in select * from public.conversation_turn_suppression_authorizations where tenant_id=p_tenant
    and chat_id=p_chat and turn_token=p_token and claimed=q.claimed for share loop
    facts:=facts||jsonb_build_object(a.kind,jsonb_build_object('source','authenticated_operator','actor_id',a.actor_id,'created_at',a.created_at));
  end loop;
  control_proof:=public.magia_turn_control_evidence(p_tenant,p_chat,p_token,'done');
  -- Legacy human ownership is a safety hold, never terminal evidence. Do not
  -- silently clear it merely because the new origin ledger starts empty.
  select c.* into latest_control from public.channel_events c
    where c.tenant_id=p_tenant and c.channel_type='whatsapp'
      and c.external_conversation_id=p_chat and c.direction='outbound'
      and (c.sender_type='human' or c.service in
        ('conversation_assigned','conversation_closed','resume_ai','appointment_payment_confirmed','handoff_requested','manual_reply','conversation_reset')
        or c.ai_provider='conversation_reset' or c.handoff is true)
    order by c.created_at desc,c.id desc limit 1 for share;
  if found and facts='{}'::jsonb
    and (latest_control.sender_type='human' or latest_control.service in
      ('conversation_assigned','handoff_requested','manual_reply') or latest_control.handoff is true)
    and not exists(select 1 from public.conversation_turn_control_origins o
      where o.event_id=latest_control.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(latest_control)))
    and not exists(select 1 from public.conversation_turn_delivery_attempts da
      where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
        and da.status='confirmed' and da.outbound_event_id=latest_control.id
        and da.provider_message_id=latest_control.external_message_id) then
    raise exception 'TURN_CONTROL_ORIGIN_REQUIRED';
  end if;
  if control_proof->>'kind' in ('human_control','persisted_handoff') then
    facts:=facts||jsonb_build_object('human_control',control_proof);
  elsif control_proof->>'kind'='conversation_closed' then
    facts:=facts||jsonb_build_object('conversation_closed',control_proof);
  end if;
  return jsonb_build_object('contract','noria_turn_lifecycle_v1','evidence',facts);
end $$;

-- Only source events count. A CORE label/handoff/ai_suppressed flag is not proof.
create table if not exists public.conversation_turn_control_origins (
  event_id uuid primary key references public.channel_events(id),tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null references auth.users(id),event_snapshot jsonb not null,
  source_kind text not null default 'authenticated_operator',
  attested_at timestamptz not null default clock_timestamp()
);
alter table public.conversation_turn_control_origins enable row level security;
revoke all on public.conversation_turn_control_origins from public,anon,authenticated,service_role;
grant select on public.conversation_turn_control_origins to service_role;
create or replace function public.magia_control_event_projection(p_event jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('tenant_id',p_event->'tenant_id','channel_type',p_event->'channel_type',
    'chat',p_event->'external_conversation_id','service',p_event->'service','sender_type',p_event->'sender_type',
    'direction',p_event->'direction','created_at',p_event->'created_at','external_message_id',p_event->'external_message_id',
    'command',p_event#>'{raw_payload,command}','operator_id',p_event#>'{raw_payload,operator_id}',
    'assigned_by',p_event#>'{raw_payload,assigned_by}','closed_by',p_event#>'{raw_payload,closed_by}',
    'confirmed_by',p_event#>'{raw_payload,confirmed_by}');
$$;
create or replace function public.magia_attest_turn_control_event(p_tenant uuid,p_event uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.channel_events%rowtype; saved jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=p_tenant
    and user_id=auth.uid() and status='active' and role in ('owner','admin','manager','operator','agent'))
    then raise exception 'CONTROL_ORIGIN_FORBIDDEN'; end if;
  select * into e from public.channel_events where id=p_event and tenant_id=p_tenant and channel_type='whatsapp'
    and direction='outbound' and (sender_type='human' or service in
      ('conversation_closed','conversation_assigned','resume_ai','appointment_payment_confirmed','manual_reply','handoff_requested')) for share;
  if not found then raise exception 'CONTROL_EVENT_SCOPE_MISMATCH'; end if;
  saved:=public.magia_control_event_projection(to_jsonb(e));
  insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot)
    values(e.id,p_tenant,auth.uid(),saved) on conflict do nothing;
  if not exists(select 1 from public.conversation_turn_control_origins where event_id=p_event and tenant_id=p_tenant
    and event_snapshot=saved) then raise exception 'CONTROL_ORIGIN_CHANGED'; end if;
  return jsonb_build_object('attested',true,'event_id',e.id);
end $$;
create or replace function public.magia_capture_authenticated_control()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare principal uuid;
begin
  if auth.uid() is not null and new.channel_type='whatsapp' and new.direction='outbound'
    and (new.sender_type='human' or new.service in ('conversation_closed','conversation_assigned','resume_ai','appointment_payment_confirmed','manual_reply','handoff_requested'))
    and exists(select 1 from public.tenant_members where tenant_id=new.tenant_id and user_id=auth.uid()
      and status='active' and role in ('owner','admin','manager','operator','agent')) then
    insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot)
      values(new.id,new.tenant_id,auth.uid(),public.magia_control_event_projection(to_jsonb(new))) on conflict do nothing;
  elsif new.channel_type='whatsapp' and new.direction='outbound' and new.sender_type='human'
    and not exists(select 1 from public.conversation_turn_delivery_attempts da where da.tenant_id=new.tenant_id and da.chat_id=new.external_conversation_id
      and (da.provider_message_id=new.external_message_id or da.status in ('attempting','uncertain')))
    and not exists(select 1 from public.channel_events ce where ce.tenant_id=new.tenant_id and ce.channel_type='whatsapp'
      and ce.external_message_id=new.external_message_id and ce.sender_type='assistant') then
    select s.principal_id into principal from public.conversation_turn_ingress_facts f
      join public.conversation_turn_ingress_sources s on s.id=f.source_id where f.tenant_id=new.tenant_id
        and f.chat_id=new.external_conversation_id and f.external_message_id=new.external_message_id and f.from_me
        and s.enabled and s.tenant_id=f.tenant_id and s.instance_name=f.instance_name limit 1;
    if found then
      insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot,source_kind)
        values(new.id,new.tenant_id,principal,public.magia_control_event_projection(to_jsonb(new)),'authenticated_provider_outbound') on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists noria_capture_authenticated_control on public.channel_events;
create trigger noria_capture_authenticated_control after insert on public.channel_events
  for each row execute function public.magia_capture_authenticated_control();

-- The command router forwards the human JWT here, instead of inserting with
-- service_role and self-asserting an actor. Event + origin commit atomically.
create or replace function public.magia_record_turn_control_event(p_event jsonb)
returns setof public.channel_events language plpgsql security definer set search_path=public,pg_temp as $$
declare tid uuid; slug text; e public.channel_events%rowtype;
begin
  tid:=(p_event->>'tenant_id')::uuid;
  if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=tid and user_id=auth.uid()
    and status='active' and role in ('owner','admin','manager','operator','agent')) then raise exception 'CONTROL_ORIGIN_FORBIDDEN'; end if;
  select t.slug into slug from public.tenants t where t.id=tid and t.status='active' and t.deleted_at is null;
  if slug is null or p_event->>'channel_type' is distinct from 'whatsapp' or p_event->>'direction' is distinct from 'outbound'
    or p_event->>'sender_type' is null or p_event->>'sender_type' not in ('human','system') or nullif(p_event->>'external_conversation_id','') is null
    or nullif(p_event->>'external_message_id','') is null then raise exception 'CONTROL_EVENT_SCOPE_MISMATCH'; end if;
  perform 1 from public.conversation_turn_queue where tenant_id=tid and channel_type='whatsapp'
    and chat_id=p_event->>'external_conversation_id' for update;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,
    sender_type,contact_name,message_text,service,stage,handoff,response_text,raw_payload,ai_provider,ai_model,ai_error,ai_usage,
    sent_by_user,delivery_status,command_id,created_at)
  values(tid,slug,'whatsapp',p_event->>'external_conversation_id',p_event->>'external_message_id','outbound',p_event->>'sender_type',
    p_event->>'contact_name',p_event->>'message_text',p_event->>'service',p_event->>'stage',coalesce((p_event->>'handoff')::boolean,false),
    p_event->>'response_text',coalesce(p_event->'raw_payload','{}'),p_event->>'ai_provider',p_event->>'ai_model',p_event->>'ai_error',
    coalesce(p_event->'ai_usage','{}'),p_event->>'sent_by_user',p_event->>'delivery_status',p_event->>'command_id',clock_timestamp())
    on conflict do nothing returning * into e;
  if e.id is null then
    select * into e from public.channel_events where tenant_id=tid and channel_type='whatsapp'
      and external_conversation_id=p_event->>'external_conversation_id' and external_message_id=p_event->>'external_message_id';
  end if;
  if e.id is null then raise exception 'CONTROL_EVENT_NOT_PERSISTED'; end if;
  perform public.magia_attest_turn_control_event(tid,e.id);
  -- Only this authenticated closure may finish its covered, unattempted REVIEW
  -- batch. Keep uncertain and every unresolved delivery under reconciliation.
  if e.service='conversation_closed' then
    perform public.magia_resolve_closed_turn_review(e.id);
  end if;
  return next e;
end $$;

create or replace function public.magia_turn_control_evidence(
  p_tenant uuid,p_chat text,p_token uuid,p_outcome text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; e public.channel_events%rowtype; ids jsonb; authority jsonb; kind text;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token
    or jsonb_array_length(q.claimed)=0 or p_outcome is null or p_outcome not in ('done','cancelled') then return null; end if;
  -- All claimed IDs must identify the original inbound in this exact tenant/chat.
  if exists(select 1 from jsonb_array_elements(q.claimed) m where not exists (
    select 1 from public.channel_events c where c.id::text=m->>'event_id'
      and c.tenant_id=p_tenant and c.channel_type='whatsapp' and c.external_conversation_id=p_chat
      and c.external_message_id=m->>'id' and c.direction='inbound'
  )) then return null; end if;
  perform c.id from public.channel_events c join jsonb_array_elements(q.claimed) m on c.id::text=m->>'event_id'
    order by c.id for share of c;
  select jsonb_agg(m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  select * into e from public.channel_events c where c.tenant_id=p_tenant and c.channel_type='whatsapp'
    and c.external_conversation_id=p_chat and c.direction='outbound' and c.sender_type='system'
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=c.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c)))
    and c.service='conversation_closed'
    and ((c.raw_payload->>'command'='close_conversation' and nullif(c.raw_payload->>'closed_by','') is not null)
      or (c.ai_provider='sales_operator' and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant
        and tm.user_id::text=c.raw_payload->>'operator_id' and tm.status='active'
        and tm.role in ('owner','admin','manager','operator','agent'))))
    and (c.created_at>=q.claimed_at or c.id::text=q.boundary_id)
    and not exists(select 1 from jsonb_array_elements(q.claimed) m join public.channel_events i on i.id::text=m->>'event_id'
      where i.created_at>c.created_at)
    order by c.created_at desc,c.id desc limit 1 for share;
  if found then return jsonb_build_object('kind','conversation_closed','event_id',e.id,'claimed_event_ids',ids); end if;
  -- Inspect the latest explicit control event; an old assignment cannot survive
  -- a later resume/reset/close. Ordinary CORE handoff flags do not qualify.
  select * into e from public.channel_events c where c.tenant_id=p_tenant and c.channel_type='whatsapp'
    and c.external_conversation_id=p_chat and c.direction='outbound'
    and (((c.sender_type='human' or c.service in ('conversation_assigned','conversation_closed','resume_ai','appointment_payment_confirmed','handoff_requested','manual_reply'))
      and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=c.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c))))
       or ((c.service='conversation_reset' or c.ai_provider='conversation_reset')
         and exists(select 1 from public.conversation_turn_delivery_attempts da where da.tenant_id=p_tenant
           and da.chat_id=p_chat and da.status='confirmed' and da.outbound_event_id=c.id
           and da.provider_message_id=c.external_message_id))
       or (c.handoff is true and exists(select 1 from public.conversation_turn_delivery_attempts da
         where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
           and da.status='confirmed' and da.outbound_event_id=c.id and da.provider_message_id=c.external_message_id)))
    order by c.created_at desc,c.id desc limit 1 for share;
  if found and (p_outcome='done' or e.created_at>=q.claimed_at)
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
    and (e.sender_type='human' or (e.sender_type='system' and e.service in ('conversation_assigned','handoff_requested')
      and ((e.raw_payload->>'command'='assign_conversation' and nullif(e.raw_payload->>'assigned_by','') is not null)
        or (e.ai_provider='sales_operator' and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant
          and tm.user_id::text=e.raw_payload->>'operator_id' and tm.status='active'
          and tm.role in ('owner','admin','manager','operator','agent')))))) then
    return jsonb_build_object('kind','human_control','event_id',e.id,'claimed_event_ids',ids);
  end if;
  if e.id is not null and p_outcome='cancelled' and e.created_at>=q.claimed_at and e.ai_provider='sales_operator'
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
    and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant and tm.status='active'
      and tm.user_id::text=e.raw_payload->>'operator_id' and tm.role in ('owner','admin','manager','operator','agent')) then
    return jsonb_build_object('kind','operator_control_changed','event_id',e.id,'claimed_event_ids',ids);
  end if;
  if e.id is not null and (p_outcome='done' or e.created_at>=q.claimed_at) and (
    (e.handoff is true and exists(select 1 from public.conversation_turn_delivery_attempts da
      where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
        and da.status='confirmed' and da.outbound_event_id=e.id and da.provider_message_id=e.external_message_id))
    or (e.service='appointment_payment_confirmed' and e.raw_payload->>'command'='confirm_payment_signal'
      and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
      and nullif(e.raw_payload->>'confirmed_by','') is not null and exists(select 1 from public.appointments ap
        where ap.id::text=e.raw_payload->>'appointment_id' and ap.tenant_id=p_tenant and ap.channel_type='whatsapp'
          and ap.external_conversation_id=p_chat and ap.status='confirmed'
          and ap.metadata->>'signal_confirmation_state'='sent' and ap.metadata->>'confirmation_message_id'=e.external_message_id))
  ) then return jsonb_build_object('kind','persisted_handoff','event_id',e.id,'claimed_event_ids',ids); end if;
  return jsonb_build_object('kind','unproven');
end $$;

create or replace function public.magia_turn_terminal_evidence(
  p_tenant uuid,p_chat text,p_token uuid,p_outcome text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; proof jsonb; authority jsonb; kind text; ids jsonb;
begin
  proof:=public.magia_turn_control_evidence(p_tenant,p_chat,p_token,p_outcome);
  if proof is null then return null; end if;
  if proof->>'kind'<>'unproven' then return proof; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  select jsonb_agg(m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  authority:=public.magia_turn_suppression_status(p_tenant,p_chat,p_token)->'evidence';
  foreach kind in array case when p_outcome='done' then
    array['ai_disabled','lead_locked','contact_excluded','owner_saved_contact','commercial_contact','non_customer','silent_ack']
    else array['lead_locked','ai_disabled'] end loop
    if authority ? kind then return jsonb_build_object('kind',kind,'authority',authority->kind,'claimed_event_ids',ids); end if;
  end loop;
  return null;
end $$;

-- Lock/fence and decide atomically. current_delivery_id=NULL is NOT proof by
-- itself: also check the attempt ledger and require a batch created by v1.
create or replace function public.magia_fail_turn(
  p_tenant uuid,p_chat text,p_token uuid,p_error text,p_retryable boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; has_attempt boolean; target text; reason text; delay_s numeric;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then
    return jsonb_build_object('finished',false,'reason','stale_token');
  end if;
  select exists(select 1 from public.conversation_turn_delivery_attempts a
    where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=p_chat
      and a.turn_token=p_token) into has_attempt;
  if q.phase in ('uncertain','review') then
    return jsonb_build_object('finished',true,'outcome',q.phase,'retry_queued',false,
      'contract','noria_turn_lifecycle_v1');
  end if;
  if q.phase not in ('processing','sending') then
    return jsonb_build_object('finished',false,'reason','invalid_phase');
  end if;
  if has_attempt or q.current_delivery_id is not null then
    target:='uncertain'; reason:='delivery_reconciliation_required';
  elsif q.retry_batch_id is null then
    target:='review'; reason:='legacy_untracked_batch';
  elsif p_retryable is not true then
    target:='review'; reason:='permanent_or_unclassified_failure';
  elsif q.retry_max_attempts is null then
    target:='review'; reason:='retry_policy_missing';
  elsif q.attempt_count>=q.retry_max_attempts then
    target:='review'; reason:='retry_budget_exhausted';
  else
    target:='ready'; reason:='retry_scheduled';
    delay_s:=least(q.retry_cap_seconds::numeric,
      q.retry_base_seconds::numeric * power(2::numeric,least(greatest(q.attempt_count-1,0),100)));
  end if;
  -- Keep claimed, pending, token, batch identity and delivery reference intact.
  -- Expire the lease to fence the old worker before retrying with a new token.
  update public.conversation_turn_queue set phase=target,lease_until=clock_timestamp(),
    next_attempt_at=case when target='ready' then clock_timestamp()+make_interval(secs=>delay_s::double precision) else null end,
    last_error_code=left(coalesce(p_error,reason),300),
    review_required_at=case when target in ('review','uncertain') then clock_timestamp() else null end,
    updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  update public.conversation_turn_delivery_attempts set status='uncertain',
    error_code=coalesce(error_code,left(p_error,300)),updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat
      and turn_token=p_token and status<>'confirmed';
  return jsonb_build_object('finished',true,'outcome',target,'reason',reason,
    'retry_queued',target='ready','attempt_count',q.attempt_count,
    'contract','noria_turn_lifecycle_v1');
end $$;

create or replace function public.magia_claim_turn(p_tenant uuid,p_chat text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; pol public.conversation_turn_retry_policy%rowtype;
  b text; k uuid; s text; r jsonb; batch jsonb;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found then return jsonb_build_object('claimed',false,'reason','empty'); end if;
  -- NEVER clear uncertain/review because a newer inbound arrived. Even a
  -- confirmed attempt is finalized explicitly, not opportunistically by claim.
  if q.phase in ('uncertain','review') then
    return jsonb_build_object('claimed',false,'reason',case when q.phase='review' then 'technical_review_required' else 'delivery_uncertain' end);
  end if;
  if q.token is not null and q.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','busy');
  end if;
  if q.phase in ('processing','sending') then
    r:=public.magia_fail_turn(p_tenant,p_chat,q.token,'lease_expired',true);
    return jsonb_build_object('claimed',false,'reason',r->>'reason');
  end if;
  if q.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','retry_backoff');
  end if;
  batch:=q.claimed||q.pending;
  if jsonb_array_length(batch)=0 or q.quiet_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','quiet_window');
  end if;
  if q.retry_batch_id is null and jsonb_array_length(q.claimed)>0 then
    update public.conversation_turn_queue set phase='review',last_error_code='legacy_untracked_batch',
      review_required_at=clock_timestamp(),updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('claimed',false,'reason','technical_review_required');
  end if;
  if q.retry_batch_id is not null and (q.retry_max_attempts is null or q.attempt_count>=q.retry_max_attempts) then
    update public.conversation_turn_queue set phase='review',review_required_at=clock_timestamp(),
      last_error_code=case when q.retry_max_attempts is null then 'retry_policy_missing' else 'retry_budget_exhausted' end,
      updated_at=clock_timestamp() where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('claimed',false,'reason','technical_review_required');
  end if;
  select slug into s from public.tenants where id=p_tenant and status='active' and deleted_at is null;
  if s is null then return jsonb_build_object('claimed',false,'reason','inactive_tenant'); end if;
  select id::text into b from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  if q.retry_batch_id is null then
    select * into pol from public.conversation_turn_retry_policy where tenant_id=p_tenant;
    q.retry_batch_id:=gen_random_uuid(); q.attempt_count:=0;
    q.retry_max_attempts:=pol.max_attempts; q.retry_base_seconds:=pol.base_backoff_seconds; q.retry_cap_seconds:=pol.max_backoff_seconds;
  end if;
  k:=gen_random_uuid();
  update public.conversation_turn_queue set token=k,phase='processing',claimed=batch,pending='[]',
    lease_until=clock_timestamp()+interval '180 seconds',claimed_at=clock_timestamp(),current_delivery_id=null,
    boundary_id=coalesce(b,'initial'),retry_batch_id=q.retry_batch_id,attempt_count=q.attempt_count+1,
    retry_max_attempts=q.retry_max_attempts,retry_base_seconds=q.retry_base_seconds,retry_cap_seconds=q.retry_cap_seconds,
    next_attempt_at=null,review_required_at=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('claimed',true,'token',k,'messages',batch,'boundary_id',coalesce(b,'initial'),
    'instance',q.instance_name,'tenant_slug',s,'retry_batch_id',q.retry_batch_id,
    'attempt_count',q.attempt_count+1,'contract','noria_turn_lifecycle_v1');
end $$;

-- Commit retains all existing boundary, human ownership and new-message gates.
create or replace function public.magia_commit_turn(p_tenant uuid,p_chat text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; b text; s text;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token or q.phase<>'processing'
    or q.lease_until is null or q.lease_until<=clock_timestamp() or q.retry_batch_id is null then
    return jsonb_build_object('committed',false,'reason','lost_lease');
  end if;
  select slug into s from public.tenants where id=p_tenant;
  select id::text into b from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  if coalesce(b,'initial')<>q.boundary_id or exists (
    select 1 from public.channel_events where tenant_slug=s and channel_type='whatsapp'
      and external_conversation_id=p_chat and created_at>q.claimed_at
      and (handoff=true or service='conversation_assigned') and ai_provider is distinct from 'buffer'
  ) then return jsonb_build_object('committed',false,'reason','conversation_control_changed'); end if;
  if jsonb_array_length(q.pending)>0 then
    return jsonb_build_object('committed',false,'reason','new_messages');
  end if;
  update public.conversation_turn_queue set phase='sending',lease_until=clock_timestamp()+interval '180 seconds',
    updated_at=clock_timestamp() where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('committed',true,'contract','noria_turn_lifecycle_v1');
end $$;

create or replace function public.magia_begin_turn_delivery(p_tenant uuid,p_chat text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; aid uuid;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token or q.phase<>'sending'
    or q.lease_until is null or q.lease_until<=clock_timestamp() or q.retry_batch_id is null then
    raise exception 'STALE_DELIVERY_ATTEMPT';
  end if;
  if q.current_delivery_id is not null or exists (
    select 1 from public.conversation_turn_delivery_attempts where turn_token=p_token
  ) then return jsonb_build_object('dispatch_allowed',false,'reason','delivery_already_started'); end if;
  insert into public.conversation_turn_delivery_attempts(tenant_id,chat_id,session_id,turn_token,status,claimed_event_ids)
  values(p_tenant,p_chat,q.boundary_id,p_token,'attempting',coalesce((
    select jsonb_agg(value->>'event_id') from jsonb_array_elements(q.claimed)
  ),'[]'::jsonb)) returning id into aid;
  update public.conversation_turn_queue set current_delivery_id=aid,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  -- One-shot permission. Repeating this RPC never grants a second HTTP send.
  return jsonb_build_object('id',aid,'status','attempting','dispatch_allowed',true,'contract','noria_turn_lifecycle_v1');
end $$;

create or replace function public.magia_confirm_turn_delivery(
  p_tenant uuid,p_chat text,p_token uuid,p_attempt uuid,p_provider_message text,p_outbound_event uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; affected integer;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or p_attempt is null or q.token is distinct from p_token
    or q.current_delivery_id is distinct from p_attempt or q.phase not in ('sending','uncertain','review') then
    return jsonb_build_object('confirmed',false,'reason','stale_delivery');
  end if;
  if nullif(p_provider_message,'') is null or not exists (
    select 1 from public.channel_events e where e.id=p_outbound_event and e.tenant_id=p_tenant
      and e.channel_type='whatsapp' and e.external_conversation_id=p_chat and e.direction='outbound'
      and e.sender_type='assistant' and e.external_message_id=p_provider_message
      and e.raw_payload->>'delivery_attempt_id'=p_attempt::text
  ) then return jsonb_build_object('confirmed',false,'reason','delivery_evidence_mismatch'); end if;
  update public.conversation_turn_delivery_attempts set status='confirmed',provider_message_id=p_provider_message,
    outbound_event_id=p_outbound_event,confirmed_at=coalesce(confirmed_at,clock_timestamp()),
    resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_attempt and tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat
      and turn_token=p_token and (provider_message_id is null or provider_message_id=p_provider_message)
      and (outbound_event_id is null or outbound_event_id=p_outbound_event);
  get diagnostics affected=row_count;
  return jsonb_build_object('confirmed',affected=1,'contract','noria_turn_lifecycle_v1');
end $$;

create or replace function public.magia_finish_turn(p_tenant uuid,p_chat text,p_token uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; has_attempt boolean; confirmed boolean; proof jsonb;
begin
  if p_outcome is null or p_outcome not in ('done','retry','cancelled','failed','uncertain','review') then raise exception 'Invalid outcome'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then return jsonb_build_object('finished',false); end if;
  if p_outcome='retry' and q.phase<>'processing' then raise exception 'Cannot retry committed turn'; end if;
  if p_outcome='retry' then return public.magia_fail_turn(p_tenant,p_chat,p_token,'new_messages_before_commit',true); end if;
  if p_outcome='failed' then return public.magia_fail_turn(p_tenant,p_chat,p_token,'legacy_failed_outcome',false); end if;
  if p_outcome in ('uncertain','review') then
    update public.conversation_turn_queue set phase=case when q.current_delivery_id is not null then 'uncertain' else p_outcome end,
      last_error_code=coalesce(last_error_code,'explicit_technical_hold'),review_required_at=clock_timestamp(),
      lease_until=clock_timestamp(),updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('finished',true,'outcome',case when q.current_delivery_id is not null then 'uncertain' else p_outcome end,
      'retry_queued',false,'contract','noria_turn_lifecycle_v1');
  end if;
  select exists(select 1 from public.conversation_turn_delivery_attempts where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat and turn_token=p_token) into has_attempt;
  perform a.id from public.conversation_turn_delivery_attempts a join public.channel_events e on e.id=a.outbound_event_id
    where a.id=q.current_delivery_id and a.tenant_id=p_tenant and a.turn_token=p_token for share of a,e;
  select exists(select 1 from public.conversation_turn_delivery_attempts a join public.channel_events e on e.id=a.outbound_event_id
    where a.id=q.current_delivery_id and a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=p_chat
      and a.turn_token=p_token and a.status='confirmed' and a.confirmed_at is not null
      and nullif(a.provider_message_id,'') is not null and e.tenant_id=p_tenant and e.channel_type='whatsapp'
      and e.external_conversation_id=p_chat and e.direction='outbound' and e.sender_type='assistant'
      and e.external_message_id=a.provider_message_id and e.raw_payload->>'delivery_attempt_id'=a.id::text) into confirmed;
  if has_attempt or q.current_delivery_id is not null then
    if p_outcome<>'done' or not confirmed then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
  elsif q.phase not in ('processing','sending') or q.retry_batch_id is null or q.lease_until is null
      or q.lease_until<=clock_timestamp() or (p_outcome='done' and q.phase<>'sending') then
    raise exception 'UNRESOLVED_TURN_REQUIRES_REVIEW';
  else
    proof:=public.magia_turn_terminal_evidence(p_tenant,p_chat,p_token,p_outcome);
    if proof is null then
      return public.magia_fail_turn(p_tenant,p_chat,p_token,'TERMINAL_EVIDENCE_MISSING:'||p_outcome,false);
    end if;
  end if;
  if confirmed then proof:=jsonb_build_object('kind','confirmed_delivery','delivery_attempt_id',q.current_delivery_id); end if;
  insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
    values(p_token,p_tenant,p_chat,p_outcome,q.claimed,proof);
  update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',current_delivery_id=null,
    retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
    next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('finished',true,'outcome',p_outcome,'retry_queued',false,'contract','noria_turn_lifecycle_v1');
end $$;

-- Durable tickets + transactional NOTIFY. NOTIFY is only a wake-up hint;
-- operations must poll notification_pending until an authorized acknowledgement.
create table if not exists public.conversation_turn_review_operators (
  tenant_id uuid not null references public.tenants(id), operator_id uuid not null references auth.users(id),
  primary key(tenant_id,operator_id)
);
create table if not exists public.conversation_turn_review_tickets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  channel_type text not null check(channel_type='whatsapp'), chat_id text not null,
  revision bigint not null default 1, created_snapshot jsonb not null, queue_snapshot jsonb not null,
  notification_pending boolean not null default true, acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz, resolved_by uuid references auth.users(id), resolved_at timestamptz,
  resolution text, resolution_note text, resolution_snapshot jsonb, resolution_evidence jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
alter table public.conversation_turn_review_tickets
  add column if not exists notified_revision bigint not null default 0,
  add column if not exists notification_lease_token uuid,
  add column if not exists notification_lease_revision bigint,
  add column if not exists notification_lease_until timestamptz;
create table if not exists public.conversation_turn_review_consumers (
  tenant_id uuid not null references public.tenants(id),principal_id uuid not null references auth.users(id),
  primary key(tenant_id,principal_id)
);
alter table public.conversation_turn_review_consumers enable row level security;
revoke all on public.conversation_turn_review_consumers from public,anon,authenticated,service_role;
grant select on public.conversation_turn_review_consumers to service_role;
create unique index if not exists conversation_turn_review_tickets_open
  on public.conversation_turn_review_tickets(tenant_id,channel_type,chat_id) where resolved_at is null;
alter table public.conversation_turn_review_operators enable row level security;
alter table public.conversation_turn_review_tickets enable row level security;
revoke all on public.conversation_turn_review_operators,public.conversation_turn_review_tickets from public,anon,authenticated,service_role;
grant select on public.conversation_turn_review_operators,public.conversation_turn_review_tickets to service_role;
-- Provisioning operators is an explicit administrator action, never seeded here.

create or replace function public.magia_track_turn_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare tid uuid; rev bigint;
begin
  if new.phase in ('review','uncertain') then
    insert into public.conversation_turn_review_tickets(tenant_id,channel_type,chat_id,created_snapshot,queue_snapshot)
      values(new.tenant_id,new.channel_type,new.chat_id,to_jsonb(new),to_jsonb(new))
      on conflict(tenant_id,channel_type,chat_id) where resolved_at is null do update
        set queue_snapshot=excluded.queue_snapshot,revision=conversation_turn_review_tickets.revision+1,
          notification_pending=true,notification_lease_token=null,notification_lease_revision=null,
          notification_lease_until=null,updated_at=clock_timestamp()
      returning id,revision into tid,rev;
    perform pg_notify('noria_turn_review',jsonb_build_object('ticket_id',tid,'tenant_id',new.tenant_id,'revision',rev)::text);
  elsif tg_op='UPDATE' and old.phase in ('review','uncertain') then
    update public.conversation_turn_review_tickets set resolved_at=clock_timestamp(),resolution='queue_finalized',
      resolution_snapshot=to_jsonb(old),notification_pending=false,revision=revision+1,updated_at=clock_timestamp()
      where tenant_id=new.tenant_id and channel_type=new.channel_type and chat_id=new.chat_id and resolved_at is null;
  end if;
  return new;
end $$;

create or replace function public.magia_authorize_turn_suppression(
  p_tenant uuid,p_chat text,p_token uuid,p_kind text,p_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=auth.uid()) then raise exception 'TURN_REVIEW_FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('commercial_contact','owner_saved_contact','non_customer','silent_ack')
    or nullif(btrim(p_note),'') is null then raise exception 'INVALID_SUPPRESSION_AUTHORIZATION'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token or q.phase not in ('processing','sending')
    or q.lease_until<=clock_timestamp() or q.lease_until is null or q.current_delivery_id is not null
    or exists(select 1 from public.conversation_turn_delivery_attempts where turn_token=p_token) then raise exception 'STALE_SUPPRESSION_TURN'; end if;
  insert into public.conversation_turn_suppression_authorizations(tenant_id,chat_id,turn_token,kind,actor_id,claimed,note)
    values(p_tenant,p_chat,p_token,p_kind,auth.uid(),q.claimed,p_note) on conflict do nothing;
  return jsonb_build_object('authorized',true,'turn_token',p_token);
end $$;

-- Alert consumers have their own tenant allowlist and NO resolution permission.
-- The checkpoint lives in PostgreSQL, so reconnect/restart replays unacked work.
create or replace function public.magia_claim_turn_alerts(p_tenant uuid,p_limit integer,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.conversation_turn_review_tickets%rowtype; lease uuid; items jsonb:='[]';
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_consumers
    where tenant_id=p_tenant and principal_id=auth.uid()) then raise exception 'TURN_ALERT_FORBIDDEN'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 10 and 300
    then raise exception 'INVALID_ALERT_CLAIM'; end if;
  for t in select * from public.conversation_turn_review_tickets where tenant_id=p_tenant and resolved_at is null
    and notification_pending and notified_revision<revision
    and (notification_lease_until is null or notification_lease_until<=clock_timestamp())
    order by created_at,id limit p_limit for update skip locked loop
    lease:=gen_random_uuid();
    update public.conversation_turn_review_tickets set notification_lease_token=lease,notification_lease_revision=t.revision,
      notification_lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds) where id=t.id;
    items:=items||jsonb_build_array(jsonb_build_object('ticket_id',t.id,'tenant_id',t.tenant_id,'revision',t.revision,
      'phase',t.queue_snapshot->>'phase','created_at',t.created_at,'lease_token',lease));
  end loop;
  return jsonb_build_object('contract','noria_turn_alert_v1','items',items);
end $$;

create or replace function public.magia_ack_turn_alert(p_tenant uuid,p_ticket uuid,p_revision bigint,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_consumers
    where tenant_id=p_tenant and principal_id=auth.uid()) then raise exception 'TURN_ALERT_FORBIDDEN'; end if;
  update public.conversation_turn_review_tickets set notified_revision=greatest(notified_revision,p_revision),
    notification_lease_token=null,notification_lease_revision=null,notification_lease_until=null
    where id=p_ticket and tenant_id=p_tenant and p_revision is not null and revision=p_revision
      and notification_lease_revision=p_revision and p_lease is not null and notification_lease_token=p_lease
      and notification_lease_until>clock_timestamp() and resolved_at is null;
  get diagnostics changed=row_count;
  return jsonb_build_object('acknowledged',changed=1,'contract','noria_turn_alert_v1');
end $$;
drop trigger if exists noria_track_turn_review on public.conversation_turn_queue;
create trigger noria_track_turn_review after insert or update on public.conversation_turn_queue
  for each row execute function public.magia_track_turn_review();

-- Ticket backfill only: do not touch any existing queue/message/token/delivery.
insert into public.conversation_turn_review_tickets(tenant_id,channel_type,chat_id,created_snapshot,queue_snapshot)
  select tenant_id,channel_type,chat_id,to_jsonb(q),to_jsonb(q) from public.conversation_turn_queue q
    where phase in ('review','uncertain')
  on conflict(tenant_id,channel_type,chat_id) where resolved_at is null do nothing;

create or replace function public.magia_list_turn_reviews(p_tenant uuid)
returns setof public.conversation_turn_review_tickets language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=auth.uid()) then raise exception 'TURN_REVIEW_FORBIDDEN'; end if;
  return query select * from public.conversation_turn_review_tickets where tenant_id=p_tenant and resolved_at is null
    order by created_at,id;
end $$;

create or replace function public.magia_resolve_turn_review(
  p_tenant uuid,p_ticket uuid,p_expected_revision bigint,p_action text,p_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.conversation_turn_review_tickets%rowtype; q public.conversation_turn_queue%rowtype;
  pol public.conversation_turn_retry_policy%rowtype; actor uuid; result jsonb; proof jsonb; reviewer boolean;
begin
  actor:=auth.uid();
  reviewer:=exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=actor);
  -- Closing one's own authenticated attendance is not general review authority.
  -- Recheck that exact closure below, under the queue/ticket locks.
  if actor is null or (not reviewer and (p_action is distinct from 'close_with_evidence'
    or not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=actor
      and status='active' and role in ('owner','admin','manager','operator','agent')))) then
    raise exception 'TURN_REVIEW_FORBIDDEN';
  end if;
  if p_action is null or p_action not in ('acknowledge','finalize_confirmed','close_with_evidence','resume_unattempted')
    or nullif(btrim(p_note),'') is null then raise exception 'INVALID_REVIEW_RESOLUTION'; end if;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant;
  if not found then raise exception 'TURN_REVIEW_NOT_FOUND'; end if;
  -- Same lock order as every queue RPC/trigger: queue first, then ticket.
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=t.chat_id for update;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant for update;
  if q.tenant_id is null or t.resolved_at is not null or p_expected_revision is null
    or t.revision<>p_expected_revision or q.phase not in ('review','uncertain')
    or to_jsonb(q) is distinct from t.queue_snapshot then raise exception 'STALE_TURN_REVIEW'; end if;
  if p_action='acknowledge' then
    update public.conversation_turn_review_tickets set acknowledged_by=actor,acknowledged_at=clock_timestamp(),
      notification_pending=false,revision=revision+1,updated_at=clock_timestamp() where id=t.id;
    return jsonb_build_object('resolved',false,'acknowledged',true,'revision',t.revision+1);
  elsif p_action='finalize_confirmed' then
    -- finish revalidates the ledger + outbound evidence; no HTTP send occurs.
    result:=public.magia_finish_turn(p_tenant,q.chat_id,q.token,'done');
    if result->>'outcome' is distinct from 'done' then raise exception 'CONFIRMED_DELIVERY_REQUIRED'; end if;
    select evidence into proof from public.conversation_turn_terminal_receipts where turn_token=q.token;
  else
    -- Check the entire claimed message set across tokens, not merely a NULL
    -- current_delivery_id. Missing legacy ledger entries are NOT no-send proof.
    if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
      where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=q.chat_id
        and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
          where a.claimed_event_ids ? (m->>'event_id')))) then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
    if p_action='close_with_evidence' then
      proof:=public.magia_turn_terminal_evidence(p_tenant,q.chat_id,q.token,'cancelled');
      if proof is null then raise exception 'TERMINAL_EVIDENCE_MISSING'; end if;
      if not reviewer and (q.phase<>'review' or proof->>'kind' is distinct from 'conversation_closed'
        or not exists(select 1 from public.conversation_turn_control_origins o
          where o.event_id::text=proof->>'event_id' and o.tenant_id=p_tenant
            and o.actor_id=actor and o.source_kind='authenticated_operator')) then
        raise exception 'TURN_REVIEW_FORBIDDEN';
      end if;
      insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
        values(q.token,p_tenant,q.chat_id,'cancelled',q.claimed,proof);
      update public.conversation_turn_queue set phase='ready',claimed='[]',token=null,lease_until=null,current_delivery_id=null,
        retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
        next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    else
      -- Only a v1 REVIEW batch with no delivery reservation may be resumed.
      -- UNCERTAIN and all legacy batches have no resend action in this RPC.
      if q.phase<>'review' or q.retry_batch_id is null or q.token is null then raise exception 'NO_SEND_PROOF_REQUIRED'; end if;
      select * into pol from public.conversation_turn_retry_policy where tenant_id=p_tenant;
      if not found then raise exception 'RETRY_POLICY_REQUIRED'; end if;
      proof:=jsonb_build_object('kind','v1_no_delivery_reservation','prior_batch_id',q.retry_batch_id);
      update public.conversation_turn_queue set phase='ready',token=gen_random_uuid(),lease_until=clock_timestamp(),
        retry_batch_id=gen_random_uuid(),attempt_count=0,retry_max_attempts=pol.max_attempts,
        retry_base_seconds=pol.base_backoff_seconds,retry_cap_seconds=pol.max_backoff_seconds,
        next_attempt_at=clock_timestamp()+make_interval(secs=>pol.base_backoff_seconds),last_error_code=null,
        review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    end if;
  end if;
  update public.conversation_turn_review_tickets set resolved_by=actor,resolved_at=clock_timestamp(),resolution=p_action,
    resolution_note=p_note,resolution_snapshot=to_jsonb(q),resolution_evidence=proof,notification_pending=false,
    updated_at=clock_timestamp() where id=t.id;
  return jsonb_build_object('resolved',true,'action',p_action,'ticket_id',t.id);
end $$;

-- Internal adapter: invoked only after the closure event and its origin have
-- persisted in the same transaction. No public RPC or CORE/service-role grant.
create or replace function public.magia_resolve_closed_turn_review(p_event uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.channel_events%rowtype; q public.conversation_turn_queue%rowtype;
  t public.conversation_turn_review_tickets%rowtype; proof jsonb;
begin
  select c.* into e from public.channel_events c
    join public.conversation_turn_control_origins o on o.event_id=c.id and o.tenant_id=c.tenant_id
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c))
    where c.id=p_event and c.channel_type='whatsapp' and c.direction='outbound'
      and c.sender_type='system' and c.service='conversation_closed'
      and c.raw_payload->>'command'='close_conversation'
      and o.actor_id=auth.uid() and o.source_kind='authenticated_operator';
  if not found then return jsonb_build_object('resolved',false,'reason','closure_not_proven'); end if;
  select * into q from public.conversation_turn_queue where tenant_id=e.tenant_id
    and channel_type='whatsapp' and chat_id=e.external_conversation_id for update;
  if not found or q.phase<>'review' or q.token is null or jsonb_array_length(q.claimed)=0 then
    return jsonb_build_object('resolved',false,'reason','no_covered_review');
  end if;
  if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
    where a.tenant_id=q.tenant_id and a.channel_type=q.channel_type and a.chat_id=q.chat_id
      and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
        where a.claimed_event_ids ? (m->>'event_id')))) then
    return jsonb_build_object('resolved',false,'reason','delivery_reconciliation_required');
  end if;
  proof:=public.magia_turn_terminal_evidence(q.tenant_id,q.chat_id,q.token,'cancelled');
  if proof->>'kind' is distinct from 'conversation_closed'
    or proof->>'event_id' is distinct from e.id::text then
    return jsonb_build_object('resolved',false,'reason','closure_does_not_cover_batch');
  end if;
  select * into t from public.conversation_turn_review_tickets where tenant_id=q.tenant_id
    and channel_type=q.channel_type and chat_id=q.chat_id and resolved_at is null for update;
  if not found then raise exception 'TURN_REVIEW_TICKET_MISSING'; end if;
  return public.magia_resolve_turn_review(q.tenant_id,t.id,t.revision,'close_with_evidence',
    'Authenticated attendance closure: '||e.id::text);
end $$;
revoke all on function public.magia_resolve_closed_turn_review(uuid) from public,anon,authenticated,service_role;

revoke all on function public.magia_fail_turn(uuid,text,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.magia_claim_turn(uuid,text) from public,anon,authenticated;
revoke all on function public.magia_commit_turn(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_begin_turn_delivery(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_finish_turn(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.magia_turn_terminal_evidence(uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.magia_turn_control_evidence(uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.magia_track_turn_review() from public,anon,authenticated,service_role;
revoke all on function public.magia_list_turn_reviews(uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_resolve_turn_review(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.magia_attest_turn_ingress(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.magia_turn_suppression_status(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_authorize_turn_suppression(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.magia_claim_turn_alerts(uuid,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.magia_ack_turn_alert(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_attest_turn_control_event(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_record_turn_control_event(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.magia_capture_authenticated_control() from public,anon,authenticated,service_role;
revoke all on function public.magia_control_event_projection(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.magia_attest_turn_control_event(uuid,uuid) to authenticated;
grant execute on function public.magia_record_turn_control_event(jsonb) to authenticated;
grant execute on function public.magia_attest_turn_ingress(uuid,jsonb,text) to authenticated;
grant execute on function public.magia_turn_suppression_status(uuid,text,uuid) to service_role;
grant execute on function public.magia_authorize_turn_suppression(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.magia_claim_turn_alerts(uuid,integer,integer) to authenticated;
grant execute on function public.magia_ack_turn_alert(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.magia_list_turn_reviews(uuid) to authenticated;
grant execute on function public.magia_resolve_turn_review(uuid,uuid,bigint,text,text) to authenticated;
grant execute on function public.magia_fail_turn(uuid,text,uuid,text,boolean) to service_role;
grant execute on function public.magia_claim_turn(uuid,text) to service_role;
grant execute on function public.magia_commit_turn(uuid,text,uuid) to service_role;
grant execute on function public.magia_begin_turn_delivery(uuid,text,uuid) to service_role;
grant execute on function public.magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid) to service_role;
grant execute on function public.magia_finish_turn(uuid,text,uuid,text) to service_role;
-- Operator inbox: reuse tickets, keep personal reading separate from operational
-- acknowledgement and the bridge's delivery checkpoints. No queue writes here.
alter table public.conversation_turn_review_tickets
  add column if not exists inbox_revision bigint not null default 1,
  add column if not exists inbox_updated_at timestamptz not null default clock_timestamp();
create index if not exists turn_review_inbox_order
  on public.conversation_turn_review_tickets(tenant_id,created_at desc,id desc);
create table if not exists public.conversation_turn_notification_reads (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id),
  ticket_id uuid not null references public.conversation_turn_review_tickets(id),
  read_revision bigint not null check(read_revision>0),
  read_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,user_id,ticket_id)
);
alter table public.conversation_turn_notification_reads enable row level security;
revoke all on public.conversation_turn_notification_reads from public,anon,authenticated,service_role;

create or replace function public.magia_version_turn_notification()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  -- Leases/checkpoints and another user's reading never re-open a notification.
  if (new.queue_snapshot,new.acknowledged_at,new.resolved_at,new.resolution)
    is distinct from (old.queue_snapshot,old.acknowledged_at,old.resolved_at,old.resolution) then
    new.inbox_revision:=old.inbox_revision+1;
    new.inbox_updated_at:=clock_timestamp();
  else
    new.inbox_revision:=old.inbox_revision;
    new.inbox_updated_at:=old.inbox_updated_at;
  end if;
  return new;
end $$;
drop trigger if exists noria_version_turn_notification on public.conversation_turn_review_tickets;
create trigger noria_version_turn_notification before update on public.conversation_turn_review_tickets
  for each row execute function public.magia_version_turn_notification();

create or replace function public.magia_list_turn_notifications(
  p_tenant uuid,p_limit integer default 30,p_before_created_at timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=auth.uid()) then raise exception 'TURN_REVIEW_FORBIDDEN'; end if;
  if p_limit is null or p_limit<1 or p_limit>100
    or (p_before_created_at is null)<>(p_before_id is null) then raise exception 'INVALID_INBOX_CURSOR'; end if;
  -- One statement snapshot for count and a bounded page. No global ID arrays, claimed bodies, tokens,
  -- evidence, internal leases or operator notes are exposed to the browser.
  with page as (
    select t.id,t.tenant_id,t.inbox_revision,t.revision,t.channel_type,t.chat_id,
      t.queue_snapshot->>'phase' as phase,t.queue_snapshot->>'last_error_code' as error_code,
      t.created_at,t.inbox_updated_at,t.acknowledged_at,t.resolved_at,t.resolution,
      coalesce(r.read_revision,0)<t.inbox_revision as unread
    from public.conversation_turn_review_tickets t
    left join public.conversation_turn_notification_reads r
      on r.tenant_id=t.tenant_id and r.ticket_id=t.id and r.user_id=auth.uid()
    where t.tenant_id=p_tenant and (p_before_id is null or (t.created_at,t.id)<(p_before_created_at,p_before_id))
    order by t.created_at desc,t.id desc limit p_limit+1
  ), visible as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('contract','noria_turn_inbox_v1','tenant_id',p_tenant,'as_of',statement_timestamp(),
    'unread_count',(select count(*) from public.conversation_turn_review_tickets t
      left join public.conversation_turn_notification_reads r
        on r.tenant_id=t.tenant_id and r.ticket_id=t.id and r.user_id=auth.uid()
      where t.tenant_id=p_tenant and coalesce(r.read_revision,0)<t.inbox_revision),
    'has_more',(select count(*)>p_limit from page),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'tenant_id',tenant_id,'revision',inbox_revision,'ticket_revision',revision,
      'channel_type',channel_type,'chat_id',chat_id,'phase',phase,
      'error_code',error_code,'created_at',created_at,'updated_at',inbox_updated_at,
      'acknowledged_at',acknowledged_at,'resolved_at',resolved_at,'resolution',resolution,'unread',unread
    ) order by created_at desc,id desc) from visible),'[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.magia_read_turn_notifications(
  p_tenant uuid,p_items jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t record; observed bigint; changed integer:=0; affected integer; unread bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=auth.uid()) then raise exception 'TURN_REVIEW_FORBIDDEN'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_INBOX_READ'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'INBOX_READ_PAGE_LIMIT'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x->>'id' is null
    or x->>'revision' is null or (x->>'revision')::bigint<1) then raise exception 'INVALID_INBOX_READ'; end if;
  -- Lock only tickets, in stable order. Never touch a queue or call resolution.
  -- A stale read records at most the revision the operator actually observed.
  for t in select ticket.id,ticket.inbox_revision,requested.read_revision
    from public.conversation_turn_review_tickets ticket
    join (select (x->>'id')::uuid as id,max((x->>'revision')::bigint) as read_revision
      from jsonb_array_elements(p_items) x group by (x->>'id')::uuid) requested on requested.id=ticket.id
    where ticket.tenant_id=p_tenant order by ticket.id for share of ticket loop
    observed:=t.read_revision;
    if observed>t.inbox_revision then raise exception 'INVALID_INBOX_REVISION'; end if;
    insert into public.conversation_turn_notification_reads(tenant_id,user_id,ticket_id,read_revision)
      values(p_tenant,auth.uid(),t.id,observed)
      on conflict(tenant_id,user_id,ticket_id) do update
        set read_revision=greatest(conversation_turn_notification_reads.read_revision,excluded.read_revision),
          read_at=clock_timestamp()
        where conversation_turn_notification_reads.read_revision<excluded.read_revision;
    get diagnostics affected=row_count;
    changed:=changed+affected;
  end loop;
  select count(*) into unread from public.conversation_turn_review_tickets ticket
    left join public.conversation_turn_notification_reads r
      on r.tenant_id=ticket.tenant_id and r.ticket_id=ticket.id and r.user_id=auth.uid()
    where ticket.tenant_id=p_tenant and coalesce(r.read_revision,0)<ticket.inbox_revision;
  return jsonb_build_object('contract','noria_turn_inbox_v1','tenant_id',p_tenant,
    'read',true,'count',changed,'unread_count',unread);
end $$;

create or replace function public.magia_read_all_turn_notifications(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); changed bigint; unread bigint;
begin
  if actor is null or not exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=actor) then raise exception 'TURN_REVIEW_FORBIDDEN'; end if;
  -- A single INSERT ... SELECT statement captures visible revisions under MVCC.
  -- No ticket locks/updates: a revision committed after this statement's snapshot
  -- is never substituted for the captured value, even while an upsert waits.
  with visible as materialized (
    select ticket.id,ticket.inbox_revision from public.conversation_turn_review_tickets ticket
    left join public.conversation_turn_notification_reads r
      on r.tenant_id=ticket.tenant_id and r.ticket_id=ticket.id and r.user_id=actor
    where ticket.tenant_id=p_tenant and coalesce(r.read_revision,0)<ticket.inbox_revision
  ), written as (
    insert into public.conversation_turn_notification_reads(tenant_id,user_id,ticket_id,read_revision)
      select p_tenant,actor,id,inbox_revision from visible order by id
      on conflict(tenant_id,user_id,ticket_id) do update
        set read_revision=greatest(conversation_turn_notification_reads.read_revision,excluded.read_revision),
          read_at=clock_timestamp()
        where conversation_turn_notification_reads.read_revision<excluded.read_revision
      returning 1
  ) select count(*) into changed from written;
  -- A fresh statement also counts revisions arriving during the write as unread.
  select count(*) into unread from public.conversation_turn_review_tickets ticket
    left join public.conversation_turn_notification_reads r
      on r.tenant_id=ticket.tenant_id and r.ticket_id=ticket.id and r.user_id=actor
    where ticket.tenant_id=p_tenant and coalesce(r.read_revision,0)<ticket.inbox_revision;
  return jsonb_build_object('contract','noria_turn_inbox_v1','tenant_id',p_tenant,
    'read',true,'count',changed,'unread_count',unread);
end $$;
revoke all on function public.magia_version_turn_notification() from public,anon,authenticated,service_role;
revoke all on function public.magia_list_turn_notifications(uuid,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_read_turn_notifications(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.magia_read_all_turn_notifications(uuid) from public,anon,authenticated,service_role;
grant execute on function public.magia_list_turn_notifications(uuid,integer,timestamptz,uuid) to authenticated;
grant execute on function public.magia_read_turn_notifications(uuid,jsonb) to authenticated;
grant execute on function public.magia_read_all_turn_notifications(uuid) to authenticated;
-- Read-only deployment handshake. Call BEFORE claim and before recovery reads
-- columns introduced here; a missing RPC must never acquire a legacy token.
-- This checks structural compatibility, not operational readiness or policy approval.
create or replace function public.magia_turn_lifecycle_status()
returns jsonb language sql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
  with expected(signature,versioned) as (values
    ('public.magia_claim_turn(uuid,text)',true),
    ('public.magia_commit_turn(uuid,text,uuid)',true),
    ('public.magia_begin_turn_delivery(uuid,text,uuid)',true),
    ('public.magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid)',true),
    ('public.magia_finish_turn(uuid,text,uuid,text)',true),
    ('public.magia_fail_turn(uuid,text,uuid,text,boolean)',true),
    ('public.magia_turn_suppression_status(uuid,text,uuid)',true),
    ('public.magia_record_turn_control_event(jsonb)',false)
  ), missing as (
    select 'rpc:'||e.signature as item from expected e
    left join pg_proc p on p.oid=to_regprocedure(e.signature)
    where p.oid is null or not has_function_privilege(
      case when e.versioned then current_user::text else 'authenticated' end,p.oid,'EXECUTE')
      or (e.versioned and position('noria_turn_lifecycle_v1' in p.prosrc)=0)
    union all
    select 'column:conversation_turn_queue.'||required.name from (values
      ('retry_batch_id'),('attempt_count'),('retry_max_attempts'),('retry_base_seconds'),
      ('retry_cap_seconds'),('next_attempt_at'),('last_error_code'),('review_required_at')
    ) required(name) where not exists (
      select 1 from pg_attribute where attrelid=to_regclass('public.conversation_turn_queue')
        and attname=required.name and attnum>0 and not attisdropped
    )
    union all
    select 'table:'||required.name from (values
      ('conversation_turn_terminal_receipts'),('conversation_turn_retry_policy'),
      ('conversation_turn_control_origins'),('conversation_turn_ingress_facts'),
      ('conversation_turn_suppression_authorizations'),('conversation_turn_review_tickets')
    ) required(name) where to_regclass('public.'||required.name) is null
  )
  select jsonb_build_object('contract','noria_turn_lifecycle_v1',
    'ready',not exists(select 1 from missing),
    'missing',coalesce((select jsonb_agg(item order by item) from missing),'[]'::jsonb));
$$;
revoke all on function public.magia_turn_lifecycle_status() from public,anon,authenticated;
grant execute on function public.magia_turn_lifecycle_status() to service_role;
notify pgrst,'reload schema';
commit;
