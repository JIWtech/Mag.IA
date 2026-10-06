-- Pausa somente as retomadas da Genesis. Mantem a exclusao de contatos e IA de entrada.
begin;
do $$
declare tid uuid;
begin
  select id into strict tid from public.tenants where slug='wesley_automoveis' and deleted_at is null;
  update public.tenant_settings set settings=settings||jsonb_build_object('follow_up_enabled',false,
    'sales_follow_up',coalesce(settings->'sales_follow_up','{}'::jsonb)||'{"enabled":false}'::jsonb),updated_at=now()
    where tenant_id=tid;
  update public.follow_up_policies set enabled=false,updated_at=now() where tenant_id=tid and channel_type='whatsapp';
  update public.follow_up_jobs set status='cancelled',error='sales_follow_up_paused',updated_at=now()
    where tenant_id=tid and channel_type='whatsapp' and status='pending';
end $$;
commit;
