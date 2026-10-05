-- Required before handing an authenticated account to a new customer.
-- No data is deleted. n8n's service_role access is unchanged.
begin;

alter table public.channel_events enable row level security;

-- Permissive policies are OR-ed; adding another one cannot close an old leak.
-- This restrictive gate applies even if a legacy read policy remains installed.
drop policy if exists channel_events_read_isolation on public.channel_events;
create policy channel_events_read_isolation
on public.channel_events as restrictive for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = (select auth.uid())
      and tm.status = 'active'
      and t.status = 'active'
      and t.deleted_at is null
      and t.slug = channel_events.tenant_slug
      and (channel_events.tenant_id is null or channel_events.tenant_id = t.id)
  )
);

-- Also keep one explicit permissive policy for legitimate members.
drop policy if exists channel_events_select_member on public.channel_events;
create policy channel_events_select_member
on public.channel_events for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
    where tm.user_id = (select auth.uid())
      and tm.status = 'active'
      and t.status = 'active'
      and t.deleted_at is null
      and t.slug = channel_events.tenant_slug
      and (channel_events.tenant_id is null or channel_events.tenant_id = t.id)
  )
);

drop policy if exists channel_events_no_anonymous_read on public.channel_events;
create policy channel_events_no_anonymous_read
on public.channel_events as restrictive for select to anon using (false);

notify pgrst, 'reload schema';
commit;
