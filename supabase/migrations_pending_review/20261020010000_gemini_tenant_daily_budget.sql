-- Migration: 20261020010000_gemini_tenant_daily_budget.sql
-- NÃO APLICAR sem aprovação específica. Revisada em PostgreSQL isolado.
--
-- Problema: o limite diário por tenant (tenant_settings.settings.gemini_daily_limit,
-- padrão do CORE = 500, <=0 = ilimitado) era contado em $getWorkflowStaticData,
-- por processo/execução do n8n, sem reserva atômica entre workers.
--
-- Mudança: reserva durável e atômica do orçamento do tenant na MESMA transação da
-- aquisição global existente (magia_gemini_acquire, inalterada). Não cria outro
-- limitador global e não divide a quota global por tenant.
--   * Dia de orçamento = data UTC do servidor (mesma semântica do todayKey() atual).
--   * Unidade = 1 tentativa HTTP ao Gemini (mesma unidade do contador atual,
--     incluindo retries e o auditor semântico). Não há estorno em falha/timeout:
--     a chamada pode ter sido processada/cobrada pelo provedor.
--   * Ordem de locks: linha do tenant -> advisory lock (escopo:modelo) do controlador
--     global. Chamadas legadas só usam o advisory lock; não há ciclo.
--   * Idempotência: lease_id já reservado para o tenant não consome de novo.
--   * Sem configuração global (p_scope nulo), reserva apenas o orçamento do tenant.
--   * p_scope informado exige TODOS os limites (acquire legado trata NULL como sem limite).
-- Rollback: 20261020010000_gemini_tenant_daily_budget.rollback.sql
begin;

create table if not exists public.gemini_tenant_daily_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  budget_day date not null,
  used integer not null default 0 check (used >= 0),
  last_limit integer,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, budget_day)
);

create table if not exists public.gemini_tenant_budget_reservations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lease_id text not null check (length(lease_id) between 8 and 180),
  budget_day date not null,
  scope text,
  model text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, lease_id)
);
create index if not exists gemini_tenant_budget_reservations_day_idx
  on public.gemini_tenant_budget_reservations (tenant_id, budget_day);

alter table public.gemini_tenant_daily_usage enable row level security;
alter table public.gemini_tenant_budget_reservations enable row level security;
revoke all on public.gemini_tenant_daily_usage from public, anon, authenticated;
revoke all on public.gemini_tenant_budget_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.gemini_tenant_daily_usage to service_role;
grant select, insert, update, delete on public.gemini_tenant_budget_reservations to service_role;

create or replace function public.magia_gemini_reserve(
  p_tenant_id uuid,
  p_daily_limit integer,
  p_model text,
  p_lease_id text,
  p_estimated_tokens integer,
  p_scope text default null,
  p_max_concurrent integer default null,
  p_max_rpm integer default null,
  p_max_tpm integer default null,
  p_max_rpd integer default null,
  p_lease_ttl_ms integer default null,
  p_probe_cooldown_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_used integer;
  v_global jsonb := null;
  v_next_day_ms integer;
begin
  if p_tenant_id is null or p_daily_limit is null
     or coalesce(p_model, '') !~ '^[a-zA-Z0-9._:-]{1,120}$'
     or length(coalesce(p_lease_id, '')) not between 8 and 180
     or coalesce(p_estimated_tokens, 0) <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_configuration');
  end if;
  -- magia_gemini_acquire treats NULL limits as "no limit" (NULL comparisons never fail), so a
  -- global scope without every limit would silently disable the controller. Refuse it here.
  if p_scope is not null and (p_max_concurrent is null or p_max_rpm is null or p_max_tpm is null
     or p_max_rpd is null or p_lease_ttl_ms is null or p_probe_cooldown_ms is null) then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_configuration');
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'active') then
    return jsonb_build_object('allowed', false, 'reason', 'tenant_invalid');
  end if;

  insert into public.gemini_tenant_daily_usage(tenant_id, budget_day, used, last_limit)
  values (p_tenant_id, v_day, 0, p_daily_limit)
  on conflict (tenant_id, budget_day) do nothing;
  -- Serializes reservations of the SAME tenant/day only; other tenants are untouched.
  select used into v_used from public.gemini_tenant_daily_usage
   where tenant_id = p_tenant_id and budget_day = v_day for update;

  if exists (select 1 from public.gemini_tenant_budget_reservations
              where tenant_id = p_tenant_id and lease_id = p_lease_id) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate_lease_id',
      'tenant_used', v_used, 'tenant_limit', p_daily_limit);
  end if;

  v_next_day_ms := greatest(1, floor(extract(epoch from (((v_day + 1)::timestamp at time zone 'UTC') - v_now)) * 1000)::integer);
  if p_daily_limit > 0 and v_used >= p_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'tenant_daily_limit_exceeded',
      'retry_after_ms', v_next_day_ms, 'tenant_used', v_used, 'tenant_limit', p_daily_limit,
      'budget_day', v_day);
  end if;

  if p_scope is not null then
    v_global := public.magia_gemini_acquire(p_scope, p_model, p_lease_id, p_estimated_tokens,
      p_max_concurrent, p_max_rpm, p_max_tpm, p_max_rpd, p_lease_ttl_ms, p_probe_cooldown_ms);
    if coalesce((v_global->>'allowed')::boolean, false) is not true then
      -- Global denial consumes nothing from the tenant budget.
      return v_global || jsonb_build_object('tenant_used', v_used, 'tenant_limit', p_daily_limit,
        'tenant_reserved', false);
    end if;
  end if;

  update public.gemini_tenant_daily_usage
     set used = used + 1, last_limit = p_daily_limit, updated_at = v_now
   where tenant_id = p_tenant_id and budget_day = v_day;
  insert into public.gemini_tenant_budget_reservations(tenant_id, lease_id, budget_day, scope, model, created_at)
  values (p_tenant_id, p_lease_id, v_day, p_scope, p_model, v_now);
  -- Reservation rows only serve idempotency/audit of recent leases.
  delete from public.gemini_tenant_budget_reservations
   where tenant_id = p_tenant_id and budget_day < v_day - 1;

  return coalesce(v_global, jsonb_build_object('allowed', true, 'reason', 'ok', 'lease_id', p_lease_id))
    || jsonb_build_object('tenant_reserved', true, 'tenant_used', v_used + 1,
      'tenant_limit', p_daily_limit, 'budget_day', v_day, 'global_controlled', p_scope is not null);
end;
$function$;

revoke all on function public.magia_gemini_reserve(uuid,integer,text,text,integer,text,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.magia_gemini_reserve(uuid,integer,text,text,integer,text,integer,integer,integer,integer,integer,integer) to service_role;
notify pgrst, 'reload schema';
commit;
