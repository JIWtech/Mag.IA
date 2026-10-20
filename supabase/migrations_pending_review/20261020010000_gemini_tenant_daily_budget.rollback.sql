-- Rollback de 20261020010000_gemini_tenant_daily_budget.sql (NÃO APLICAR sem aprovação).
-- Antes do rollback, republicar o CORE anterior: o CORE novo falha fechado sem esta RPC.
-- magia_gemini_acquire/release e tabelas gemini_rate_control_* não são tocadas.
begin;
drop function if exists public.magia_gemini_reserve(uuid,integer,text,text,integer,text,integer,integer,integer,integer,integer,integer);
-- Tabelas mantidas para auditoria; remover somente com decisão explícita:
-- drop table if exists public.gemini_tenant_budget_reservations;
-- drop table if exists public.gemini_tenant_daily_usage;
notify pgrst, 'reload schema';
commit;
