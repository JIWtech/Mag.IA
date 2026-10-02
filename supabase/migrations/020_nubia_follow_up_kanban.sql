-- Coluna operacional de follow-ups exclusiva do painel da Clinica da Nubia oficial.
-- Execute somente depois da migration 019_follow_up_jobs.sql.
begin;

do $$
declare
  nubia_tenant_id uuid;
  nubia_board_id uuid;
  next_position integer;
begin
  select id into nubia_tenant_id
  from public.tenants
  where slug = 'clinica_nubia_oficial' and deleted_at is null
  limit 1;

  if nubia_tenant_id is null then
    raise exception 'Tenant clinica_nubia_oficial nao encontrado';
  end if;

  select id into nubia_board_id
  from public.kanban_boards
  where tenant_id = nubia_tenant_id and is_default = true
  order by created_at, id
  limit 1;

  if nubia_board_id is null then
    raise exception 'Board padrao da Clinica da Nubia nao encontrado';
  end if;

  select coalesce(max(position), 0) + 1 into next_position
  from public.kanban_columns
  where tenant_id = nubia_tenant_id and board_id = nubia_board_id;

  insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
  values (nubia_tenant_id, nubia_board_id, 'Follow Ups', next_position, 'follow_ups')
  on conflict (tenant_id, board_id, name)
  do update set automation_key = excluded.automation_key;
end $$;

-- O painel recebe somente os jobs ativos do tenant oficial. Escrita continua exclusiva ao service_role/n8n.
revoke select on public.follow_up_jobs from anon;
grant select on public.follow_up_jobs to authenticated;
drop policy if exists follow_up_jobs_select_nubia_dashboard on public.follow_up_jobs;
create policy follow_up_jobs_select_nubia_dashboard
on public.follow_up_jobs
for select
to authenticated
using (
  tenant_id = (
    select id from public.tenants
    where slug = 'clinica_nubia_oficial' and status = 'active' and deleted_at is null
  )
  and (
    auth.uid() is not null
    and exists (
      select 1 from public.tenant_members member
      where member.tenant_id = follow_up_jobs.tenant_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  )
);

notify pgrst, 'reload schema';
commit;
