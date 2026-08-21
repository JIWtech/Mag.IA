-- Mag.IA production hardening.
-- Fecha policies antigas do piloto, alinha channel_events ao modelo multi-tenant
-- e protege team_agents por tenant_members.

begin;

alter table public.channel_events
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists request_id text,
  add column if not exists error_code text;

update public.channel_events ce
set tenant_id = t.id
from public.tenants t
where ce.tenant_id is null
  and ce.tenant_slug = t.slug;

create index if not exists channel_events_tenant_id_created_idx
  on public.channel_events (tenant_id, created_at desc);

create index if not exists channel_events_tenant_channel_conversation_idx
  on public.channel_events (tenant_id, channel_type, external_conversation_id, created_at desc);

with ranked_settings as (
  select
    ctid,
    row_number() over (
      partition by tenant_id
      order by updated_at desc nulls last, created_at desc nulls last
    ) as rn
  from public.tenant_settings
)
delete from public.tenant_settings ts
using ranked_settings rs
where ts.ctid = rs.ctid
  and rs.rn > 1;

create unique index if not exists tenant_settings_tenant_unique_idx
  on public.tenant_settings (tenant_id);

drop policy if exists "jiw_channel_events_read" on public.channel_events;
drop policy if exists "jiw_tenant_service_catalog_read" on public.tenant_service_catalog;
drop policy if exists "jiw_tenants_read" on public.tenants;

drop policy if exists "channel_events_select_member" on public.channel_events;
create policy "channel_events_select_member"
on public.channel_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and (
        channel_events.tenant_id = t.id
        or channel_events.tenant_slug = t.slug
      )
  )
);

alter table public.team_agents
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists updated_at timestamptz not null default now();

update public.team_agents ta
set tenant_id = t.id
from public.tenants t
where ta.tenant_id is null
  and ta.tenant_slug = t.slug;

create index if not exists idx_team_agents_tenant_id
  on public.team_agents (tenant_id);

create or replace function public.team_agents_sync_tenant_id()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null and new.tenant_slug is not null then
    select t.id into new.tenant_id
    from public.tenants t
    where t.slug = new.tenant_slug
    limit 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists team_agents_sync_tenant_id_trigger on public.team_agents;
create trigger team_agents_sync_tenant_id_trigger
before insert or update on public.team_agents
for each row
execute function public.team_agents_sync_tenant_id();

alter table public.team_agents enable row level security;

drop policy if exists "team_agents_select_policy" on public.team_agents;
drop policy if exists "team_agents_insert_policy" on public.team_agents;
drop policy if exists "team_agents_update_policy" on public.team_agents;
drop policy if exists "team_agents_delete_policy" on public.team_agents;
drop policy if exists "team_agents_select_member" on public.team_agents;
drop policy if exists "team_agents_insert_member" on public.team_agents;
drop policy if exists "team_agents_update_member" on public.team_agents;
drop policy if exists "team_agents_delete_member" on public.team_agents;

create policy "team_agents_select_member"
on public.team_agents
for select
to authenticated
using (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and (
        team_agents.tenant_id = t.id
        or team_agents.tenant_slug = t.slug
      )
  )
);

create policy "team_agents_insert_member"
on public.team_agents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager')
      and (
        team_agents.tenant_id = t.id
        or team_agents.tenant_slug = t.slug
      )
  )
);

create policy "team_agents_update_member"
on public.team_agents
for update
to authenticated
using (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager')
      and (
        team_agents.tenant_id = t.id
        or team_agents.tenant_slug = t.slug
      )
  )
)
with check (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager')
      and (
        team_agents.tenant_id = t.id
        or team_agents.tenant_slug = t.slug
      )
  )
);

create policy "team_agents_delete_member"
on public.team_agents
for delete
to authenticated
using (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager')
      and (
        team_agents.tenant_id = t.id
        or team_agents.tenant_slug = t.slug
      )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_agents'
  ) then
    alter publication supabase_realtime add table public.team_agents;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
