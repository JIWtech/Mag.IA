-- Executar depois da migration 026 e da publicacao do workflow protegido.
-- Nao importa/apaga contatos e nao altera prompt, modelo, cota ou outros tenants.
begin;
do $$
declare tid uuid; total integer;
begin
  if to_regprocedure('public.magia_contact_exclusion_status(uuid,text)') is null then
    raise exception 'Aplicar primeiro 026_tenant_ai_contact_exclusions.sql'; end if;
  select t.id into strict tid from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
    where t.slug='wesley_automoveis' and t.status='active' and t.deleted_at is null
      and s.settings->>'conversation_capability'='sales_v1'
      and s.settings->>'whatsapp_processing_mode'='conversation_core_v1';
  select count(*) into total from public.tenant_ai_excluded_contacts where tenant_id=tid;
  if total<3260 then raise exception 'Lista incompleta: % contatos. Conferir/importar o SQL privado do VCF antes de ativar',total; end if;
  update public.tenant_settings set settings=settings||'{"contact_exclusion_enabled":true}'::jsonb,
    updated_at=now() where tenant_id=tid;
end $$;
commit;
select t.slug,count(e.phone) as excluded_numbers,s.settings->>'contact_exclusion_enabled' as enabled
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
left join public.tenant_ai_excluded_contacts e on e.tenant_id=t.id
where t.slug='wesley_automoveis' group by t.slug,s.settings;
