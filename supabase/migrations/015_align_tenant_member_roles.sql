-- Alinha roles do tenant_members entre schema atual, docs antigas e n8n.
-- Mantem compatibilidade com:
-- owner, admin, manager, agent, operator, viewer.

begin;

alter table public.tenant_members
  drop constraint if exists tenant_members_role_check;

alter table public.tenant_members
  add constraint tenant_members_role_check
  check (role in ('owner', 'admin', 'manager', 'agent', 'operator', 'viewer'));

alter table public.tenant_members
  drop constraint if exists tenant_members_status_check;

alter table public.tenant_members
  add constraint tenant_members_status_check
  check (status in ('invited', 'active', 'suspended', 'removed'));

-- Usuarios operacionais tambem podem criar/editar agenda e disparos.
-- Viewer continua somente leitura.

drop policy if exists "broadcast_contacts_member_insert" on public.broadcast_contacts;
create policy "broadcast_contacts_member_insert"
on public.broadcast_contacts
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "broadcast_contacts_member_update" on public.broadcast_contacts;
create policy "broadcast_contacts_member_update"
on public.broadcast_contacts
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "broadcast_campaigns_member_insert" on public.broadcast_campaigns;
create policy "broadcast_campaigns_member_insert"
on public.broadcast_campaigns
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "broadcast_campaigns_member_update" on public.broadcast_campaigns;
create policy "broadcast_campaigns_member_update"
on public.broadcast_campaigns
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "broadcast_recipients_member_insert" on public.broadcast_campaign_recipients;
create policy "broadcast_recipients_member_insert"
on public.broadcast_campaign_recipients
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "broadcast_recipients_member_update" on public.broadcast_campaign_recipients;
create policy "broadcast_recipients_member_update"
on public.broadcast_campaign_recipients
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "appointments_member_insert" on public.appointments;
create policy "appointments_member_insert"
on public.appointments
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "appointments_member_update" on public.appointments;
create policy "appointments_member_update"
on public.appointments
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  )
);

drop policy if exists "team_agents_insert_member" on public.team_agents;
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
      and tm.role in ('owner', 'admin', 'manager', 'operator')
      and (team_agents.tenant_id = t.id or team_agents.tenant_slug = t.slug)
  )
);

drop policy if exists "team_agents_update_member" on public.team_agents;
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
      and tm.role in ('owner', 'admin', 'manager', 'operator')
      and (team_agents.tenant_id = t.id or team_agents.tenant_slug = t.slug)
  )
)
with check (
  exists (
    select 1
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'operator')
      and (team_agents.tenant_id = t.id or team_agents.tenant_slug = t.slug)
  )
);

drop policy if exists "team_agents_delete_member" on public.team_agents;
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
      and tm.role in ('owner', 'admin', 'manager', 'operator')
      and (team_agents.tenant_id = t.id or team_agents.tenant_slug = t.slug)
  )
);

notify pgrst, 'reload schema';

commit;
