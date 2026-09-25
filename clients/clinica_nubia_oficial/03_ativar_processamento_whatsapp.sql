-- Reproducao da ativacao JA aplicada em 2026-09-25.
-- Pre-requisitos: migration 017 e ambos workflows atualizados/publicados.
begin;
do $$
begin
  if not exists (select 1 from public.channels c join public.tenants t on t.id=c.tenant_id
    where t.slug='clinica_nubia_oficial' and t.status='active'
      and c.type='whatsapp' and c.status='active' and c.external_id='clinica_nubia') then
    raise exception 'Canal oficial ativo nao encontrado';
  end if;
  update public.tenant_settings s
    set settings=jsonb_set(coalesce(s.settings,'{}'::jsonb),'{whatsapp_processing_mode}',
      '"conversation_core_v1"'::jsonb), updated_at=now()
    from public.tenants t where t.id=s.tenant_id and t.slug='clinica_nubia_oficial';
  if not found then raise exception 'Settings oficiais nao encontradas'; end if;
end $$;
commit;
