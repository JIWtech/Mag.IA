-- PREPARACAO, NAO ATIVACAO. Somente para tenant isolado no projeto atual.
-- Executar no SQL Editor depois de aprovar essa arquitetura.
-- Nao cria canal, workflow, politicas RLS, reservas nem configuracao de outros tenants.
-- Reexecucao do mesmo pacote e no-op: nunca sobrescreve configuracao posterior.
begin;
do $$
declare
  owner_id constant uuid := '8fb2bc06-94d5-4abe-83b2-1aed41a346ae';
  target_slug constant text := 'wesley_automoveis';
  package_id constant text := 'wesley-onboarding-2026-09-29-v1';
  owner_email text;
  tid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('onboarding:' || target_slug));
  select email into strict owner_email from auth.users where id=owner_id;
  if owner_email is null then raise exception 'Usuario sem email; revisar Auth'; end if;

  select id into tid from public.tenants where slug=target_slug;
  if tid is not null then
    if not exists (select 1 from public.tenant_settings
        where tenant_id=tid and settings->>'onboarding_package'=package_id)
      or not exists (select 1 from public.tenant_members
        where tenant_id=tid and user_id=owner_id and role='owner' and status='active') then
      raise exception 'Slug existente sem identidade deste pacote; nao sobrescrever';
    end if;
    raise notice 'Cadastro ja aplicado; nenhuma alteracao realizada';
    return;
  end if;

  if exists (select 1 from public.tenant_members where user_id=owner_id and status='active') then
    raise exception 'Usuario ja tem acesso a outra empresa; revisar sem remover vinculos';
  end if;

  insert into public.tenants(slug,name,industry,plan,status)
    values(target_slug,'Wesley Automoveis','Comercio de veiculos','mvp','active') returning id into tid;
  insert into public.tenant_members(tenant_id,user_id,email,role,status)
    values(tid,owner_id,owner_email,'owner','active');
  insert into public.tenant_settings(tenant_id,timezone,business_hours,fallback_message,handoff_message,settings)
    values(tid,'America/Sao_Paulo','{}'::jsonb,
      'Vou pedir ao Wesley para conferir essa informacao e continuar com voce.',
      'So um momento, vou chamar o Wesley para continuar seu atendimento.',
      jsonb_build_object(
        'onboarding_package',package_id,
        'onboarding_status','awaiting_automotive_runtime',
        'enabled_channels',jsonb_build_array('whatsapp'),
        'ai_enabled',false,
        'media_ai_enabled',false,
        'whatsapp_audio_enabled',false,
        'follow_up_enabled',false,
        'payment_signal_enabled',false,
        'appointment_scheduling',jsonb_build_object('enabled',false),
        'vehicle_sheet_id','1VgUrslSLNWmouutDww7iws2kVJUiiSiV9iAgwfyFWhE',
        'sdr_rules',jsonb_build_object(
          'hot_lead_percent',30,
          'minimum_purchase_year',1995,
          'rejected_purchase_brands',jsonb_build_array('Peugeot','Citroen'),
          'preferred_purchase_models',jsonb_build_array('Uno','Palio','Gol','Corsa','Celta'),
          'document_processing','pending_policy',
          'warranty_response','human_review_required'
        )
      ));
end $$;
commit;
