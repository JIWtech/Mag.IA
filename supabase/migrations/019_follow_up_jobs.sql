-- Follow-ups duraveis por tenant. Nenhuma politica e ativada automaticamente.
begin;

create table if not exists public.follow_up_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_type text not null default 'whatsapp',
  name text not null default 'Sequencia padrao',
  enabled boolean not null default false,
  steps jsonb not null default '[
    {"key":"3h","delay_minutes":180,"objective":"Retomar a conversa recente de forma leve."},
    {"key":"24h","delay_minutes":1440,"objective":"Retomar o interesse sem repetir a mensagem anterior."},
    {"key":"15d","delay_minutes":21600,"objective":"Fazer uma ultima reativacao contextual e sem pressao."}
  ]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel_type, name)
);

create table if not exists public.follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.follow_up_policies(id) on delete cascade,
  channel_type text not null,
  external_conversation_id text not null,
  contact_name text,
  anchor_event_id uuid not null references public.channel_events(id) on delete cascade,
  step_key text not null,
  objective text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','cancelled','failed','uncertain')),
  lease_token uuid,
  locked_until timestamptz,
  attempt_count integer not null default 0,
  sent_event_id uuid references public.channel_events(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, anchor_event_id, step_key)
);
insert into public.follow_up_policies(tenant_id, channel_type, name, enabled)
select id, 'whatsapp', 'Sequencia padrao', false
from public.tenants
where status in ('active','trial','pilot','Piloto')
on conflict (tenant_id, channel_type, name) do nothing;
create index if not exists follow_up_jobs_due_idx on public.follow_up_jobs(status, due_at) where status = 'pending';
create index if not exists follow_up_jobs_conversation_idx on public.follow_up_jobs(tenant_id, channel_type, external_conversation_id);
alter table public.follow_up_policies enable row level security;
alter table public.follow_up_jobs enable row level security;
revoke all on public.follow_up_policies, public.follow_up_jobs from anon, authenticated;
grant all on public.follow_up_policies, public.follow_up_jobs to service_role;

create or replace function public.magia_schedule_followups(p_tenant uuid, p_channel text, p_chat text, p_anchor uuid, p_contact text default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare policy public.follow_up_policies%rowtype; step jsonb; inserted integer:=0;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Follow-up scheduling denied'; end if;
  select * into policy from public.follow_up_policies where tenant_id=p_tenant and channel_type=p_channel and enabled order by created_at limit 1;
  if not found then return 0; end if;
  update public.follow_up_jobs set status='cancelled',updated_at=now(),error='newer_outbound_reply'
    where tenant_id=p_tenant and channel_type=p_channel and external_conversation_id=p_chat and status='pending';
  for step in select value from jsonb_array_elements(policy.steps) loop
    if coalesce((step->>'delay_minutes')::integer,0) < 1 or nullif(step->>'key','') is null then continue; end if;
    insert into public.follow_up_jobs(tenant_id,policy_id,channel_type,external_conversation_id,contact_name,anchor_event_id,step_key,objective,due_at)
    values(p_tenant,policy.id,p_channel,p_chat,p_contact,p_anchor,step->>'key',coalesce(step->>'objective','Retomar conversa'),
      now()+make_interval(mins=>(step->>'delay_minutes')::integer)) on conflict do nothing;
    inserted:=inserted+1;
  end loop;
  return inserted;
end $$;

create or replace function public.magia_claim_followup_jobs(p_limit integer default 20)
returns table(id uuid, tenant_id uuid, tenant_slug text, channel_type text, external_conversation_id text, contact_name text,
  anchor_event_id uuid, anchor_created_at timestamptz, step_key text, objective text, lease_token uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Follow-up claim denied'; end if;
  return query with candidates as (
    select j.id from public.follow_up_jobs j where j.status='pending' and j.due_at<=now()
      and (j.locked_until is null or j.locked_until<=now()) order by j.due_at for update skip locked limit greatest(1,least(p_limit,50))
  ), claimed as (
    update public.follow_up_jobs j set status='processing',lease_token=gen_random_uuid(),locked_until=now()+interval '5 minutes',attempt_count=j.attempt_count+1,updated_at=now()
    from candidates c where j.id=c.id returning j.*
  ) select c.id,c.tenant_id,t.slug,c.channel_type,c.external_conversation_id,c.contact_name,c.anchor_event_id,e.created_at,c.step_key,c.objective,c.lease_token
    from claimed c join public.tenants t on t.id=c.tenant_id join public.channel_events e on e.id=c.anchor_event_id;
end $$;

create or replace function public.magia_finish_followup_job(p_job uuid,p_lease uuid,p_status text,p_event uuid default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' or p_status not in ('sent','cancelled','failed','uncertain') then raise exception 'Follow-up finish denied'; end if;
  update public.follow_up_jobs set status=p_status,sent_event_id=p_event,error=left(coalesce(p_error,''),500),locked_until=null,updated_at=now()
    where id=p_job and status='processing' and lease_token=p_lease;
  return found;
end $$;

create or replace function public.magia_cancel_followups_from_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (new.direction='inbound' and new.sender_type='contact') or new.handoff or new.service='conversation_closed' then
    update public.follow_up_jobs set status='cancelled',updated_at=now(),error='conversation_control_changed'
      where tenant_id=new.tenant_id and channel_type=new.channel_type and external_conversation_id=new.external_conversation_id and status='pending';
  end if;
  return new;
end $$;
drop trigger if exists magia_cancel_followups_from_event on public.channel_events;
create trigger magia_cancel_followups_from_event after insert on public.channel_events for each row execute function public.magia_cancel_followups_from_event();
revoke all on function public.magia_schedule_followups(uuid,text,text,uuid,text), public.magia_claim_followup_jobs(integer), public.magia_finish_followup_job(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.magia_schedule_followups(uuid,text,text,uuid,text), public.magia_claim_followup_jobs(integer), public.magia_finish_followup_job(uuid,uuid,text,uuid,text) to service_role;
commit;
