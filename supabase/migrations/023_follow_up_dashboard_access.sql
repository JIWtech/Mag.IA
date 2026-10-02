-- Repair existing installations of 020 without changing any tenant business configuration.
begin;
revoke select on public.follow_up_jobs from anon;
grant select on public.follow_up_jobs to authenticated;
drop policy if exists follow_up_jobs_select_nubia_dashboard on public.follow_up_jobs;
create policy follow_up_jobs_select_nubia_dashboard on public.follow_up_jobs
for select to authenticated using (
  auth.uid() is not null
  and tenant_id in (select id from public.tenants
    where slug='clinica_nubia_oficial' and status='active' and deleted_at is null)
  and exists (select 1 from public.tenant_members m
    where m.tenant_id=follow_up_jobs.tenant_id and m.user_id=auth.uid() and m.status='active')
);
notify pgrst,'reload schema';
commit;
