-- Auth e RLS multi-tenant para a Mag.IA.
-- Execute apos 007_realtime_manual_replies.sql.

create table if not exists tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null default 'agent'
    check (role in ('owner', 'admin', 'manager', 'agent', 'viewer')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, user_id)
);

alter table tenant_members
  add column if not exists email text;

create index if not exists tenant_members_user_status_idx
  on tenant_members (user_id, status);

create index if not exists tenant_members_tenant_status_idx
  on tenant_members (tenant_id, status);

alter table tenant_members enable row level security;

drop policy if exists "tenant_members_select_own" on tenant_members;
create policy "tenant_members_select_own"
on tenant_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "tenants_select_member" on tenants;
create policy "tenants_select_member"
on tenants
for select
to authenticated
using (
  exists (
    select 1
    from tenant_members tm
    where tm.tenant_id = tenants.id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "channel_events_select_member" on channel_events;
create policy "channel_events_select_member"
on channel_events
for select
to authenticated
using (
  exists (
    select 1
    from tenants t
    join tenant_members tm on tm.tenant_id = t.id
    where t.slug = channel_events.tenant_slug
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "tenant_service_catalog_select_member" on tenant_service_catalog;
create policy "tenant_service_catalog_select_member"
on tenant_service_catalog
for select
to authenticated
using (
  exists (
    select 1
    from tenant_members tm
    where tm.tenant_id = tenant_service_catalog.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "kanban_boards_select_member" on kanban_boards;
create policy "kanban_boards_select_member"
on kanban_boards
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = kanban_boards.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "kanban_columns_select_member" on kanban_columns;
create policy "kanban_columns_select_member"
on kanban_columns
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = kanban_columns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "funnels_select_member" on funnels;
create policy "funnels_select_member"
on funnels
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = funnels.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "funnel_stages_select_member" on funnel_stages;
create policy "funnel_stages_select_member"
on funnel_stages
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = funnel_stages.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "ai_agents_select_member" on ai_agents;
create policy "ai_agents_select_member"
on ai_agents
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = ai_agents.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "ai_prompt_versions_select_member" on ai_prompt_versions;
create policy "ai_prompt_versions_select_member"
on ai_prompt_versions
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = ai_prompt_versions.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

notify pgrst, 'reload schema';
