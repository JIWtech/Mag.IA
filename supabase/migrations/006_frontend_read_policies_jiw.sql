-- Policies de leitura do piloto JIW para a interface Mag.IA.
-- Use anon key no frontend. Nunca use service_role no navegador.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'channel_events'
      and policyname = 'jiw_channel_events_read'
  ) then
    create policy "jiw_channel_events_read"
    on channel_events
    for select
    to anon, authenticated
    using (tenant_slug = 'jiw');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenant_service_catalog'
      and policyname = 'jiw_tenant_service_catalog_read'
  ) then
    create policy "jiw_tenant_service_catalog_read"
    on tenant_service_catalog
    for select
    to anon, authenticated
    using (
      tenant_id in (
        select id
        from tenants
        where slug = 'jiw'
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tenants'
      and policyname = 'jiw_tenants_read'
  ) then
    create policy "jiw_tenants_read"
    on tenants
    for select
    to anon, authenticated
    using (slug = 'jiw');
  end if;
end $$;

notify pgrst, 'reload schema';
