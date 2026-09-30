-- Publicar primeiro o Core e o no Registrar Mensagem na Fila atualizados.
-- Ativacao exclusiva da clinica oficial. Nao altera prompt/modelo/limite diario.
begin;
do $$
declare affected integer;
begin
  update public.tenant_settings s set settings=s.settings || '{"whatsapp_audio_enabled":true}'::jsonb,updated_at=now()
  from public.tenants t where t.id=s.tenant_id and t.slug='clinica_nubia_oficial' and t.status='active'
    and t.deleted_at is null and s.settings->>'grounding_mode'='canonical_v2'
    and s.settings->>'whatsapp_processing_mode'='conversation_core_v1';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Core canonico oficial nao encontrado'; end if;
end $$;
commit;
