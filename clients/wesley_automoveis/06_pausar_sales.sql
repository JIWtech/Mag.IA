-- Pausa exclusiva da IA Wesley. Preserva canal, dados e atendimento manual.
begin;
do $$
declare affected integer;
begin
  update public.tenant_settings s set settings=s.settings || '{"ai_enabled":false}'::jsonb,updated_at=now()
  from public.tenants t where t.id=s.tenant_id and t.slug='wesley_automoveis'
    and s.settings->>'conversation_capability'='sales_v1';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Tenant comercial Wesley nao encontrado'; end if;
end $$;
commit;
