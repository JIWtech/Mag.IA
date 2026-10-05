-- Generic, opt-in capacity enforcement. Enable only after publishing the compatible core.
begin;

create table if not exists public.appointment_capacity_slots (
  tenant_id uuid not null references public.tenants(id),
  unit_id text not null,
  resource_id text not null,
  starts_at timestamptz not null,
  used integer not null check (used >= 0),
  primary key (tenant_id, unit_id, resource_id, starts_at)
);
create table if not exists public.appointment_capacity_allocations (
  appointment_id uuid primary key references public.appointments(id) on delete cascade deferrable initially deferred,
  tenant_id uuid not null,
  unit_id text not null,
  resource_id text not null,
  starts_at timestamptz not null,
  foreign key (tenant_id, unit_id, resource_id, starts_at)
    references public.appointment_capacity_slots(tenant_id, unit_id, resource_id, starts_at)
);
alter table public.appointment_capacity_slots enable row level security;
alter table public.appointment_capacity_allocations enable row level security;
revoke all on public.appointment_capacity_slots, public.appointment_capacity_allocations from public, anon, authenticated;

create or replace function public.magia_schedule_authorize(p_tenant uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not exists (
    select 1 from public.tenant_members m where m.tenant_id = p_tenant
    and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner', 'admin', 'manager', 'agent', 'operator')
  ) then raise exception 'Scheduling access denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant and status = 'active')
    then raise exception 'Inactive tenant'; end if;
end $$;

create or replace function public.magia_schedule_spec(p_tenant uuid, p_unit text, p_service text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; unit jsonb; resource text;
begin
  select settings->'appointment_scheduling' into cfg from public.tenant_settings where tenant_id = p_tenant;
  if coalesce((cfg->>'enabled')::boolean, false) is not true then raise exception 'SCHEDULE_NOT_CONFIGURED'; end if;
  unit := cfg->'units'->p_unit;
  resource := cfg->'service_resources'->>p_service;
  if unit is null or resource is null or coalesce((unit->'capacities'->>resource)::integer, 0) < 1
    then raise exception 'SCHEDULE_NOT_CONFIGURED'; end if;
  if not exists (select 1 from public.tenant_service_catalog where tenant_id = p_tenant and external_id = p_service and active)
    then raise exception 'SERVICE_NOT_ACTIVE'; end if;
  return jsonb_build_object('unit', unit, 'resource', resource, 'capacity', (unit->'capacities'->>resource)::integer,
    'timezone', cfg->>'timezone', 'duration', (cfg->>'duration_minutes')::integer);
end $$;

-- Existing unclassified bookings must not disappear from availability calculations.
create or replace function public.magia_schedule_legacy_conflict(p_tenant uuid, p_unit text, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.appointments a
    where a.tenant_id = p_tenant and (p_exclude is null or a.id <> p_exclude)
      and a.status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show')
      and a.starts_at < p_end and coalesce(a.ends_at, a.starts_at + interval '2 hours') > p_start
      and (coalesce(a.metadata->>'unit_id', '') = '' or a.metadata->>'unit_id' = p_unit)
      and not exists (select 1 from public.appointment_capacity_allocations x where x.appointment_id = a.id));
$$;

create or replace function public.magia_appointment_capacity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare allocation public.appointment_capacity_allocations%rowtype;
  cfg jsonb; spec jsonb; local_start timestamp; slot_used integer; enabled boolean;
begin
  if tg_op <> 'INSERT' then
    select * into allocation from public.appointment_capacity_allocations where appointment_id = old.id for update;
    if tg_op = 'UPDATE' then
      -- Payment verification and notes preserve an existing allocation or an unclassified legacy booking.
      if new.tenant_id = old.tenant_id and new.starts_at = old.starts_at
        and new.ends_at is not distinct from old.ends_at
        and new.metadata->>'unit_id' is not distinct from old.metadata->>'unit_id'
        and new.metadata->>'service_id' is not distinct from old.metadata->>'service_id'
        and (new.status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show'))
          = (old.status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show')) then return new; end if;
    end if;
    if allocation.appointment_id is not null then
      update public.appointment_capacity_slots set used = used - 1
        where tenant_id = allocation.tenant_id and unit_id = allocation.unit_id
          and resource_id = allocation.resource_id and starts_at = allocation.starts_at;
      delete from public.appointment_capacity_allocations where appointment_id = old.id;
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  if new.status in ('cancelled', 'canceled', 'completed', 'done', 'no_show') then return new; end if;
  select settings->'appointment_scheduling' into cfg from public.tenant_settings where tenant_id = new.tenant_id;
  enabled := coalesce((cfg->>'enabled')::boolean, false);
  if not enabled then return new; end if;
  spec := public.magia_schedule_spec(new.tenant_id, new.metadata->>'unit_id', new.metadata->>'service_id');
  local_start := new.starts_at at time zone (spec->>'timezone');
  if new.starts_at <= now() or local_start <> date_trunc('minute', local_start)
    or not coalesce((spec->'unit'->'starts'->extract(dow from local_start)::integer::text) ? to_char(local_start, 'HH24:MI'), false)
    or new.ends_at is distinct from new.starts_at + make_interval(mins => (spec->>'duration')::integer)
    then raise exception 'INVALID_SESSION_SLOT'; end if;
  -- Atomic row update serializes competitors for the last place. No count-then-insert race.
  insert into public.appointment_capacity_slots as slots(tenant_id, unit_id, resource_id, starts_at, used)
    values(new.tenant_id, new.metadata->>'unit_id', spec->>'resource', new.starts_at, 1)
    on conflict (tenant_id, unit_id, resource_id, starts_at)
    do update set used = slots.used + 1 where slots.used < (spec->>'capacity')::integer
    returning used into slot_used;
  if slot_used is null then raise exception 'SLOT_UNAVAILABLE'; end if;
  if public.magia_schedule_legacy_conflict(new.tenant_id, new.metadata->>'unit_id', new.starts_at, new.ends_at, new.id)
    then raise exception 'LEGACY_BOOKING_REQUIRES_REVIEW'; end if;
  insert into public.appointment_capacity_allocations values(new.id, new.tenant_id, new.metadata->>'unit_id', spec->>'resource', new.starts_at);
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('unit_name', spec->'unit'->>'name',
    'resource_id', spec->>'resource', 'duration_minutes', (spec->>'duration')::integer);
  return new;
end $$;
drop trigger if exists appointment_capacity_guard on public.appointments;
create trigger appointment_capacity_guard before insert or update or delete on public.appointments
for each row execute function public.magia_appointment_capacity_guard();

create or replace function public.magia_appointment_availability(p_tenant uuid, p_unit text, p_service text, p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare spec jsonb; start_text text; start_time timestamptz; result jsonb := '[]'; occupied integer;
begin
  perform public.magia_schedule_authorize(p_tenant);
  spec := public.magia_schedule_spec(p_tenant, p_unit, p_service);
  for start_text in select jsonb_array_elements_text(spec->'unit'->'starts'->extract(dow from p_date)::integer::text) loop
    start_time := (p_date + start_text::time) at time zone (spec->>'timezone');
    select used into occupied from public.appointment_capacity_slots
      where tenant_id = p_tenant and unit_id = p_unit and resource_id = spec->>'resource' and starts_at = start_time;
    if start_time > now() and coalesce(occupied, 0) < (spec->>'capacity')::integer
      and not public.magia_schedule_legacy_conflict(p_tenant, p_unit, start_time, start_time + make_interval(mins => (spec->>'duration')::integer))
      then result := result || to_jsonb(start_text); end if;
  end loop;
  return jsonb_build_object('date', p_date, 'unit_id', p_unit, 'available_starts', result);
end $$;

create or replace function public.magia_reserve_appointment(p_tenant uuid, p_unit text, p_service text,
  p_date date, p_time time, p_name text, p_chat text, p_request text, p_channel text default 'whatsapp', p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare spec jsonb; service_name text; start_time timestamptz; appointment public.appointments%rowtype;
begin
  perform public.magia_schedule_authorize(p_tenant);
  if nullif(trim(p_request), '') is null or nullif(trim(p_name), '') is null
    or p_channel not in ('whatsapp', 'telegram', 'manual') then raise exception 'INVALID_RESERVATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_channel || ':' || coalesce(nullif(p_chat, ''), p_request), 0));
  select * into appointment from public.appointments where tenant_id = p_tenant and metadata->>'reservation_request' = p_request;
  if found then
    if appointment.metadata->>'unit_id' is distinct from p_unit
      or appointment.metadata->>'service_id' is distinct from p_service
      or appointment.metadata->>'requested_date' is distinct from p_date::text
      or appointment.metadata->>'requested_time' is distinct from to_char(p_time, 'HH24:MI')
      or appointment.contact_name is distinct from trim(p_name)
      or appointment.channel_type is distinct from p_channel
      or appointment.external_conversation_id is distinct from nullif(p_chat, '')
      then raise exception 'RESERVATION_REQUEST_REUSED_WITH_DIFFERENT_DATA'; end if;
    return to_jsonb(appointment);
  end if;
  if nullif(p_chat, '') is not null and exists (select 1 from public.appointments where tenant_id = p_tenant
    and channel_type = p_channel and external_conversation_id = p_chat and starts_at > now()
    and status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show')) then raise exception 'EXISTING_BOOKING_REQUIRES_REVIEW'; end if;
  spec := public.magia_schedule_spec(p_tenant, p_unit, p_service);
  select name into service_name from public.tenant_service_catalog where tenant_id = p_tenant and external_id = p_service and active;
  start_time := (p_date + p_time) at time zone (spec->>'timezone');
  insert into public.appointments(tenant_id, title, starts_at, ends_at, status, contact_name, channel_type, external_conversation_id, created_by, notes, metadata)
  values (p_tenant, service_name || ' - ' || trim(p_name), start_time,
    start_time + make_interval(mins => (spec->>'duration')::integer), 'pending_payment', trim(p_name), p_channel, nullif(p_chat, ''), auth.uid(), p_notes,
    jsonb_build_object('unit_id', p_unit, 'service_id', p_service, 'service', service_name,
      'customer_name', trim(p_name), 'requested_date', p_date, 'requested_time', to_char(p_time, 'HH24:MI'),
      'source', 'capacity_reservation', 'payment_status', 'pending', 'reservation_request', p_request)) returning * into appointment;
  return to_jsonb(appointment);
end $$;

revoke all on function public.magia_schedule_authorize(uuid), public.magia_schedule_spec(uuid,text,text),
  public.magia_schedule_legacy_conflict(uuid,text,timestamptz,timestamptz,uuid), public.magia_appointment_capacity_guard(),
  public.magia_appointment_availability(uuid,text,text,date), public.magia_reserve_appointment(uuid,text,text,date,time,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.magia_appointment_availability(uuid,text,text,date),
  public.magia_reserve_appointment(uuid,text,text,date,time,text,text,text,text,text) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
