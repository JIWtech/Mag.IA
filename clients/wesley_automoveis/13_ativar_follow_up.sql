-- Publicar PRIMEIRO os workflows de conversa e follow-up atualizados; migrations 026 e 027.
-- Sequencia aprovada em 05/10/2026: 3h, 24h e 15d desde a ultima resposta elegivel.
-- Nao cria jobs retroativos. Nao altera a politica da NB Bronze.
begin;
do $$
declare tid uuid; cfg jsonb;
begin
  if to_regprocedure('public.magia_validate_sales_followup(uuid,uuid)') is null then
    raise exception 'Aplicar primeiro 027_sales_follow_up_guards.sql'; end if;
  select t.id,s.settings into strict tid,cfg from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
    where t.slug='wesley_automoveis' and t.status='active' and t.deleted_at is null
      and s.settings->>'conversation_capability'='sales_v1'
      and s.settings->>'whatsapp_processing_mode'='conversation_core_v1';
  if cfg->>'contact_exclusion_enabled' is distinct from 'true'
    or (select count(*) from public.tenant_ai_excluded_contacts where tenant_id=tid)<3260 then
    raise exception 'Restaurar e testar primeiro a exclusao de contatos'; end if;
  if not exists(select 1 from public.channels where tenant_id=tid and type='whatsapp'
    and external_id='wesley-carros' and status='active') then raise exception 'Canal Wesley ativo nao encontrado'; end if;
  -- Reexecution is intentionally idempotent, without cancelling a running campaign.
  if cfg#>>'{sales_follow_up,revision}'='genesis-follow-up-v1-2026-10-05'
    and cfg#>>'{sales_follow_up,enabled}'='true' then
    raise notice 'Pacote ja ativado; nenhuma alteracao'; return; end if;
  if exists(select 1 from public.follow_up_jobs where tenant_id=tid and status='processing') then
    raise exception 'Aguardar jobs em processamento antes de ativar'; end if;
  update public.follow_up_policies set enabled=false,updated_at=now()
    where tenant_id=tid and channel_type='whatsapp';
  update public.follow_up_jobs set status='cancelled',error='sales_follow_up_activation',updated_at=now()
    where tenant_id=tid and channel_type='whatsapp' and status='pending';
  insert into public.follow_up_policies(tenant_id,channel_type,name,enabled,steps)
  values(tid,'whatsapp','Genesis - Retomada comercial',true,'[
    {"key":"3h","delay_minutes":180,"objective":"Retomar interesse comercial"},
    {"key":"24h","delay_minutes":1440,"objective":"Oferecer continuidade"},
    {"key":"15d","delay_minutes":21600,"objective":"Ultima retomada"}]'::jsonb)
  on conflict(tenant_id,channel_type,name) do update set enabled=true,steps=excluded.steps,updated_at=now();
  update public.tenant_settings set settings=settings||jsonb_build_object(
    'follow_up_enabled',true,'sales_follow_up',jsonb_build_object(
      'enabled',true,'revision','genesis-follow-up-v1-2026-10-05','messages',jsonb_build_object(
        '3h',U&'Oi! Podemos continuar seu atendimento na Genesis Autom\00F3veis?',
        '24h',U&'Ol\00E1! Ainda tem interesse em continuar a conversa com a Genesis Autom\00F3veis?',
        '15d',U&'Ol\00E1! Gostaria de retomar seu atendimento na Genesis Autom\00F3veis? Se precisar, estamos por aqui.'))),
    updated_at=now() where tenant_id=tid;
end $$;
commit;
select t.slug,p.name,p.enabled,p.steps,s.settings->'sales_follow_up' as configuration
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
join public.follow_up_policies p on p.tenant_id=t.id where t.slug='wesley_automoveis';
