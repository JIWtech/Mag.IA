-- Apos 01. Cadastra os dados confirmados e o canal PENDENTE.
-- Nao ativa webhook/IA, nao instala um novo workflow e nao altera outros tenants.
begin;
do $$
declare
  tid uuid;
  affected integer;
begin
  perform pg_advisory_xact_lock(hashtext('onboarding:wesley_automoveis'));
  select t.id into strict tid from public.tenants t
  join public.tenant_settings s on s.tenant_id=t.id
  where t.slug='wesley_automoveis' and t.status='active' and t.deleted_at is null
    and s.settings->>'onboarding_package'='wesley-onboarding-2026-09-29-v1';
  if not exists (select 1 from public.tenant_members where tenant_id=tid
      and user_id='8fb2bc06-94d5-4abe-83b2-1aed41a346ae' and role='owner' and status='active') then
    raise exception 'Owner Wesley nao encontrado';
  end if;
  if exists (select 1 from public.channels where type='whatsapp' and tenant_id<>tid
    and (external_id='wesley-carros' or config->>'instance_name'='wesley-carros'
      or config->>'instance'='wesley-carros' or config->>'evolution_instance'='wesley-carros'
      or config->>'phone'='5521992923139')) then
    raise exception 'Instancia ou telefone ja vinculado a outro tenant';
  end if;
  if exists (select 1 from public.channels where tenant_id=tid and type='whatsapp'
    and (external_id is distinct from 'wesley-carros' or status is distinct from 'pending'
      or config->>'phone' is distinct from '5521992923139'
      or config->>'instance_name' is distinct from 'wesley-carros')) then
    raise exception 'Canal existente fora da preparacao; revisar sem sobrescrever';
  end if;
  if exists (select 1 from public.tenant_settings where tenant_id=tid
    and settings->>'ai_enabled' is distinct from 'false') then
    raise exception 'IA fora do estado de preparacao; nao reconfigurar automaticamente';
  end if;

  update public.tenant_settings set
    timezone='America/Sao_Paulo',
    business_hours=jsonb_build_object('timezone','America/Sao_Paulo',
      'start','09:00','end','18:00','days',null,'days_confirmed',false),
    settings=settings || jsonb_build_object(
      'onboarding_status','awaiting_shared_sales_capability',
      'business_facts',coalesce(settings->'business_facts','{}'::jsonb) || $facts${
        "locations":[{"id":"loja","name":"Wesley Automoveis","address":"Av. Itapemirim, 747 - Boa Esperança, Nova Iguaçu - RJ, 26143-510, Brasil","verified":true,"verified_source":"Responsavel no chat"}],
        "vehicle_types":["carro","moto"],
        "opening_hours":{"start":"09:00","end":"18:00","weekdays":null,"note":"Dias de funcionamento ainda nao informados"}
      }$facts$::jsonb,
      'onboarding_confirmations',jsonb_build_object(
        'architecture','shared_tenant_and_workflow',
        'document_storage_requested',true,
        'document_pipeline_ready',false)
    ),updated_at=now()
  where tenant_id=tid;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Settings ausentes ou duplicados'; end if;

  insert into public.channels(tenant_id,type,name,external_id,status,credentials_ref,config)
  values(tid,'whatsapp','WhatsApp - Wesley Automoveis','wesley-carros','pending','evolution_api',
    '{"instance_name":"wesley-carros","phone":"5521992923139","onboarding_package":"wesley-onboarding-2026-09-29-v1"}'::jsonb)
  on conflict(tenant_id,type,external_id) do nothing;
end $$;
commit;

select t.slug,c.external_id,c.status,c.config->>'phone' as phone,
  s.settings->>'ai_enabled' as ai_enabled,s.settings->>'onboarding_status' as onboarding_status
from public.tenants t join public.channels c on c.tenant_id=t.id
join public.tenant_settings s on s.tenant_id=t.id where t.slug='wesley_automoveis';
