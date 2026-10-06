-- Somente visualizacao: nao altera IA, contatos excluidos, leads, jobs ou politicas de envio.
-- Aplicar junto ao frontend atualizado. Nao exige republicar workflow n8n.
begin;
do $$
declare tid uuid; bid uuid; next_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('genesis:follow-up-dashboard'));
  select t.id into strict tid from public.tenants t
    join public.tenant_settings s on s.tenant_id=t.id
    where t.slug='wesley_automoveis' and t.status='active' and t.deleted_at is null
      and s.settings->>'conversation_capability'='sales_v1';
  select id into strict bid from public.kanban_boards
    where tenant_id=tid and is_default=true and settings->>'capability'='sales_v1';

  if not exists(select 1 from public.kanban_columns
      where tenant_id=tid and board_id=bid and automation_key='follow_ups') then
    select coalesce(max(position),0)+1 into next_position from public.kanban_columns
      where tenant_id=tid and board_id=bid;
    insert into public.kanban_columns(tenant_id,board_id,name,position,automation_key)
      values(tid,bid,'Follow Ups',next_position,'follow_ups')
      on conflict(tenant_id,board_id,name) do update set automation_key=excluded.automation_key;
  end if;
end $$;

grant select on public.follow_up_jobs to authenticated;
drop policy if exists follow_up_jobs_select_genesis_dashboard on public.follow_up_jobs;
create policy follow_up_jobs_select_genesis_dashboard on public.follow_up_jobs
for select to authenticated using (
  auth.uid() is not null
  and tenant_id in (select id from public.tenants
    where slug='wesley_automoveis' and status='active' and deleted_at is null)
  and exists(select 1 from public.tenant_members m
    where m.tenant_id=follow_up_jobs.tenant_id and m.user_id=auth.uid() and m.status='active')
);
notify pgrst,'reload schema';
commit;

select t.slug,c.name,c.automation_key,c.position from public.kanban_columns c
join public.tenants t on t.id=c.tenant_id
where t.slug='wesley_automoveis' and c.automation_key='follow_ups';
