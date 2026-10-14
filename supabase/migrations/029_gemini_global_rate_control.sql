-- Distributed Gemini admission control for the shared WhatsApp CORE.
-- This migration is intentionally not applied by the build. Deploy it through
-- the normal reviewed Supabase migration process before enabling required mode.

create table if not exists public.gemini_rate_control_state (
  scope text not null,
  model text not null,
  circuit_generation bigint not null default 0,
  circuit_open_until timestamptz,
  circuit_reason text,
  probe_lease_id text,
  probe_expires_at timestamptz,
  consecutive_upstream_failures integer not null default 0,
  configured_max_rpm integer not null check (configured_max_rpm > 0),
  configured_max_tpm integer not null check (configured_max_tpm > 0),
  configured_max_rpd integer not null check (configured_max_rpd > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, model),
  constraint gemini_rate_control_scope_safe check (scope ~ '^[a-zA-Z0-9._:-]{1,120}$'),
  constraint gemini_rate_control_model_safe check (model ~ '^[a-zA-Z0-9._:-]{1,120}$')
);

create table if not exists public.gemini_rate_control_leases (
  scope text not null,
  model text not null,
  lease_id text not null,
  circuit_generation bigint not null,
  is_probe boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (scope, model, lease_id)
);

create index if not exists gemini_rate_control_leases_expiry_idx
  on public.gemini_rate_control_leases (scope, model, expires_at);

create table if not exists public.gemini_rate_control_events (
  id bigint generated always as identity primary key,
  scope text not null,
  model text not null,
  lease_id text not null,
  estimated_tokens integer not null check (estimated_tokens > 0),
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists gemini_rate_control_events_window_idx
  on public.gemini_rate_control_events (scope, model, occurred_at desc);

alter table public.gemini_rate_control_state enable row level security;
alter table public.gemini_rate_control_leases enable row level security;
alter table public.gemini_rate_control_events enable row level security;
revoke all on public.gemini_rate_control_state from anon, authenticated;
revoke all on public.gemini_rate_control_leases from anon, authenticated;
revoke all on public.gemini_rate_control_events from anon, authenticated;

create or replace function public.magia_gemini_acquire(
  p_scope text,
  p_model text,
  p_lease_id text,
  p_estimated_tokens integer,
  p_max_concurrent integer,
  p_max_rpm integer,
  p_max_tpm integer,
  p_max_rpd integer,
  p_lease_ttl_ms integer,
  p_probe_cooldown_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.gemini_rate_control_state%rowtype;
  v_active integer;
  v_rpm integer;
  v_tpm bigint;
  v_rpd integer;
  v_probe boolean := false;
  v_probe_recovery_until timestamptz;
  v_probe_cooldown_ms integer := greatest(1000, least(coalesce(p_probe_cooldown_ms, 30000), 300000));
begin
  if p_scope !~ '^[a-zA-Z0-9._:-]{1,120}$'
     or p_model !~ '^[a-zA-Z0-9._:-]{1,120}$'
     or length(coalesce(p_lease_id, '')) not between 8 and 180
     or p_estimated_tokens <= 0
     or p_max_concurrent <= 0
     or p_max_rpm <= 0
     or p_max_tpm <= 0
     or p_max_rpd <= 0
     or p_lease_ttl_ms not between 20000 and 120000
     or p_probe_cooldown_ms not between 1000 and 300000 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_configuration');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_model, 0));

  delete from public.gemini_rate_control_leases
   where scope = p_scope and model = p_model and expires_at <= v_now;
  delete from public.gemini_rate_control_events
   where scope = p_scope and model = p_model and occurred_at < v_now - interval '25 hours';

  insert into public.gemini_rate_control_state(
    scope, model, configured_max_rpm, configured_max_tpm, configured_max_rpd
  ) values (
    p_scope, p_model, p_max_rpm, p_max_tpm, p_max_rpd
  )
  on conflict (scope, model) do nothing;

  select * into v_state
    from public.gemini_rate_control_state
   where scope = p_scope and model = p_model
   for update;

  if v_state.configured_max_rpm <> p_max_rpm
     or v_state.configured_max_tpm <> p_max_tpm
     or v_state.configured_max_rpd <> p_max_rpd then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'configuration_mismatch',
      'configured_max_rpm', v_state.configured_max_rpm,
      'configured_max_tpm', v_state.configured_max_tpm,
      'configured_max_rpd', v_state.configured_max_rpd
    );
  end if;

  if exists (
    select 1 from public.gemini_rate_control_leases
     where scope = p_scope and model = p_model and lease_id = p_lease_id
  ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'duplicate_lease_id',
      'generation', v_state.circuit_generation
    );
  end if;

  if v_state.circuit_open_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'circuit_open',
      'retry_after_ms', greatest(1, floor(extract(epoch from (v_state.circuit_open_until - v_now)) * 1000)::integer),
      'generation', v_state.circuit_generation
    );
  end if;

  if v_state.circuit_reason is not null then
    if v_state.probe_lease_id is not null then
      if v_state.probe_expires_at > v_now then
        return jsonb_build_object(
          'allowed', false,
          'reason', 'half_open_busy',
          'retry_after_ms', greatest(1, floor(extract(epoch from (v_state.probe_expires_at - v_now)) * 1000)::integer),
          'generation', v_state.circuit_generation
        );
      end if;

      v_probe_recovery_until := coalesce(v_state.probe_expires_at, v_now)
        + make_interval(secs => v_probe_cooldown_ms / 1000.0);
      update public.gemini_rate_control_state
         set circuit_generation = circuit_generation + 1,
             circuit_open_until = v_probe_recovery_until,
             circuit_reason = 'probe_timeout',
             probe_lease_id = null,
             probe_expires_at = null,
             consecutive_upstream_failures = 0,
             updated_at = v_now
       where scope = p_scope and model = p_model;
      v_state.circuit_generation := v_state.circuit_generation + 1;
      v_state.circuit_open_until := v_probe_recovery_until;
      v_state.circuit_reason := 'probe_timeout';
      v_state.probe_lease_id := null;
      v_state.probe_expires_at := null;
      if v_probe_recovery_until > v_now then
        return jsonb_build_object(
          'allowed', false,
          'reason', 'probe_timeout_cooldown',
          'retry_after_ms', greatest(1, floor(extract(epoch from (v_probe_recovery_until - v_now)) * 1000)::integer),
          'generation', v_state.circuit_generation
        );
      end if;
    end if;
    v_probe := true;
  end if;

  select count(*) into v_active
    from public.gemini_rate_control_leases
   where scope = p_scope and model = p_model and expires_at > v_now;
  if v_active >= p_max_concurrent then
    return jsonb_build_object('allowed', false, 'reason', 'concurrency_busy', 'retry_after_ms', 100);
  end if;

  select count(*), coalesce(sum(estimated_tokens), 0)
    into v_rpm, v_tpm
    from public.gemini_rate_control_events
   where scope = p_scope and model = p_model
     and occurred_at > v_now - interval '60 seconds';
  if v_rpm >= p_max_rpm then
    return jsonb_build_object('allowed', false, 'reason', 'rpm_exceeded', 'retry_after_ms', 1000);
  end if;
  if v_tpm + p_estimated_tokens > p_max_tpm then
    return jsonb_build_object('allowed', false, 'reason', 'tpm_exceeded', 'retry_after_ms', 1000);
  end if;

  select count(*) into v_rpd
    from public.gemini_rate_control_events
   where scope = p_scope and model = p_model
     and occurred_at > v_now - interval '24 hours';
  if v_rpd >= p_max_rpd then
    return jsonb_build_object('allowed', false, 'reason', 'rpd_exceeded', 'retry_after_ms', 60000);
  end if;

  if v_probe then
    update public.gemini_rate_control_state
       set probe_lease_id = p_lease_id,
           probe_expires_at = v_now + make_interval(secs => p_lease_ttl_ms / 1000.0),
           updated_at = v_now
     where scope = p_scope and model = p_model;
  end if;

  insert into public.gemini_rate_control_leases(
    scope, model, lease_id, circuit_generation, is_probe, expires_at
  ) values (
    p_scope, p_model, p_lease_id, v_state.circuit_generation, v_probe,
    v_now + make_interval(secs => p_lease_ttl_ms / 1000.0)
  );
  insert into public.gemini_rate_control_events(scope, model, lease_id, estimated_tokens, occurred_at)
  values (p_scope, p_model, p_lease_id, p_estimated_tokens, v_now);

  return jsonb_build_object(
    'allowed', true,
    'reason', case when v_probe then 'half_open_probe' else 'ok' end,
    'lease_id', p_lease_id,
    'generation', v_state.circuit_generation,
    'is_probe', v_probe,
    'active', v_active + 1,
    'rpm', v_rpm + 1,
    'tpm', v_tpm + p_estimated_tokens,
    'rpd', v_rpd + 1
  );
end;
$$;

create or replace function public.magia_gemini_release(
  p_scope text,
  p_model text,
  p_lease_id text,
  p_outcome text,
  p_cooldown_ms integer default 30000
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease public.gemini_rate_control_leases%rowtype;
  v_state public.gemini_rate_control_state%rowtype;
  v_wait_ms integer := greatest(1000, least(coalesce(p_cooldown_ms, 30000), 300000));
  v_fails integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_model, 0));
  select * into v_lease from public.gemini_rate_control_leases
   where scope = p_scope and model = p_model and lease_id = p_lease_id for update;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'lease_missing_or_expired');
  end if;
  delete from public.gemini_rate_control_leases
   where scope = p_scope and model = p_model and lease_id = p_lease_id;
  select * into v_state from public.gemini_rate_control_state
   where scope = p_scope and model = p_model for update;

  if not found then
    return jsonb_build_object('released', false, 'reason', 'state_missing');
  end if;

  if p_outcome = 'success' then
    if v_lease.is_probe and v_lease.circuit_generation = v_state.circuit_generation
       and v_state.probe_lease_id = p_lease_id then
      update public.gemini_rate_control_state
         set circuit_open_until = null, circuit_reason = null,
             probe_lease_id = null, probe_expires_at = null,
             consecutive_upstream_failures = 0, updated_at = v_now
       where scope = p_scope and model = p_model;
      return jsonb_build_object('released', true, 'reason', 'probe_closed_circuit');
    end if;

    if v_lease.circuit_generation = v_state.circuit_generation
       and v_state.circuit_reason is null
       and v_state.consecutive_upstream_failures > 0 then
      update public.gemini_rate_control_state
         set consecutive_upstream_failures = 0,
             updated_at = v_now
       where scope = p_scope and model = p_model;
      return jsonb_build_object('released', true, 'reason', 'success_reset_upstream_failures');
    end if;
    return jsonb_build_object('released', true, 'reason', 'success_without_circuit_mutation');
  end if;

  if v_lease.circuit_generation <> v_state.circuit_generation then
    return jsonb_build_object(
      'released', true,
      'reason', 'stale_generation_ignored',
      'lease_generation', v_lease.circuit_generation,
      'current_generation', v_state.circuit_generation
    );
  end if;

  if p_outcome = 'rate_limit' then
    update public.gemini_rate_control_state
       set circuit_generation = circuit_generation + 1,
           circuit_open_until = v_now + make_interval(secs => v_wait_ms / 1000.0),
           circuit_reason = 'rate_limit', probe_lease_id = null,
           probe_expires_at = null, consecutive_upstream_failures = 0,
           updated_at = v_now
     where scope = p_scope and model = p_model;
    return jsonb_build_object('released', true, 'reason', 'circuit_opened');
  end if;

  if p_outcome = 'upstream_server' then
    v_fails := v_state.consecutive_upstream_failures + 1;
    update public.gemini_rate_control_state
       set consecutive_upstream_failures = v_fails,
           circuit_generation = circuit_generation + case when v_fails >= 3 or v_lease.is_probe then 1 else 0 end,
           circuit_open_until = case when v_fails >= 3 or v_lease.is_probe then v_now + make_interval(secs => v_wait_ms / 1000.0) else circuit_open_until end,
           circuit_reason = case when v_fails >= 3 or v_lease.is_probe then 'upstream_server' else circuit_reason end,
           probe_lease_id = case when v_fails >= 3 or v_lease.is_probe then null else probe_lease_id end,
           probe_expires_at = case when v_fails >= 3 or v_lease.is_probe then null else probe_expires_at end,
           updated_at = v_now
     where scope = p_scope and model = p_model;
    return jsonb_build_object('released', true, 'reason', case when v_fails >= 3 or v_lease.is_probe then 'circuit_opened' else 'upstream_recorded' end);
  end if;

  if v_lease.is_probe and v_state.probe_lease_id = p_lease_id then
    update public.gemini_rate_control_state
       set circuit_generation = circuit_generation + 1,
           circuit_open_until = v_now + make_interval(secs => v_wait_ms / 1000.0),
           circuit_reason = case when p_outcome = 'network_or_timeout' then 'network_or_timeout' else 'probe_failure' end,
           probe_lease_id = null,
           probe_expires_at = null,
           consecutive_upstream_failures = 0,
           updated_at = v_now
     where scope = p_scope and model = p_model;
    return jsonb_build_object('released', true, 'reason', 'probe_failure_cooldown');
  end if;

  return jsonb_build_object('released', true, 'reason', 'released_without_circuit_mutation');
end;
$$;

revoke all on function public.magia_gemini_acquire(text,text,text,integer,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.magia_gemini_release(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.magia_gemini_acquire(text,text,text,integer,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.magia_gemini_release(text,text,text,text,integer) to service_role;
