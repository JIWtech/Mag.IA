-- Somente leitura. Nao expoe a lista de telefones.
select t.slug,s.settings->>'contact_exclusion_enabled' as exclusion_enabled,
  s.settings->>'whatsapp_processing_mode' as processing_mode,
  s.settings->>'ai_enabled' as ai_enabled,s.settings->>'follow_up_enabled' as follow_up_enabled,
  s.settings->'sales_follow_up' as sales_follow_up,
  (select count(*) from public.tenant_ai_excluded_contacts e where e.tenant_id=t.id) as excluded_numbers
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id where t.slug='wesley_automoveis';

select to_regprocedure('public.magia_contact_exclusion_status(uuid,text)') as exclusion_rpc,
  to_regprocedure('public.magia_validate_sales_followup(uuid,uuid)') as follow_up_guard;

select e.created_at,e.ai_provider,e.service,e.handoff,e.ai_error,
  e.raw_payload->'contact_exclusion' as exclusion
from public.channel_events e join public.tenants t on t.id=e.tenant_id
where t.slug='wesley_automoveis' and e.ai_provider='contact_exclusion'
order by e.created_at desc limit 30;

select j.step_key,j.status,count(*) as jobs from public.follow_up_jobs j
join public.tenants t on t.id=j.tenant_id where t.slug='wesley_automoveis'
group by j.step_key,j.status order by j.step_key,j.status;
