-- Somente leitura. Rodar antes (ausencia do tenant e esperada) e depois do 01.
select id, email, email_confirmed_at from auth.users
where id='8fb2bc06-94d5-4abe-83b2-1aed41a346ae';

select t.id,t.slug,t.status,m.user_id,m.role,m.status as member_status
from public.tenant_members m join public.tenants t on t.id=m.tenant_id
where m.user_id='8fb2bc06-94d5-4abe-83b2-1aed41a346ae';

select t.id,t.slug,t.status,s.timezone,
  s.settings->>'onboarding_status' as onboarding_status,
  s.settings->>'ai_enabled' as ai_enabled,
  s.settings->>'whatsapp_processing_mode' as processing_mode,
  s.settings->>'payment_signal_enabled' as payment_signal_enabled
from public.tenants t left join public.tenant_settings s on s.tenant_id=t.id
where t.slug='wesley_automoveis';

-- Apos 01: nenhum canal. Apos 03: somente wesley-carros, status pending.
-- Apos 04: canal active. Use 05_validar_ativacao.sql para a capacidade comercial.
-- Prompts legados ativos devem continuar ausentes.
select c.id,c.type,c.external_id,c.status from public.channels c
join public.tenants t on t.id=c.tenant_id where t.slug='wesley_automoveis';
select p.id,p.active from public.ai_prompt_versions p
join public.tenants t on t.id=p.tenant_id where t.slug='wesley_automoveis' and p.active=true;

-- Consultar politicas existentes; nao recriar RLS global para cadastrar Wesley.
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in
  ('tenants','tenant_members','tenant_settings','channels','channel_events','tenant_service_catalog','kanban_boards','kanban_columns')
order by tablename,policyname;
