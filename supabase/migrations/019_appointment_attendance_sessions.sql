-- Keep the old RPC for compatibility. Activate session_v2 only after publishing its core.
begin;
create or replace function public.magia_reserve_session_appointment(p_tenant uuid, p_unit text, p_service text,
  p_date date, p_time time, p_name text, p_chat text, p_request text, p_channel text default 'whatsapp',
  p_notes text default null, p_session text default 'initial')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare spec jsonb; service_name text; start_time timestamptz; boundary text; appointment public.appointments%rowtype;
begin
  perform public.magia_schedule_authorize(p_tenant);
  if nullif(trim(p_request), '') is null or nullif(trim(p_name), '') is null
    or p_channel not in ('whatsapp', 'telegram', 'manual') then raise exception 'INVALID_RESERVATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_channel || ':' || coalesce(nullif(p_chat, ''), p_request), 0));
  if p_channel <> 'manual' then
    select e.id::text into boundary from public.channel_events e
    join public.tenants t on t.slug=e.tenant_slug
    where t.id=p_tenant and e.channel_type=p_channel and e.external_conversation_id=p_chat
      and (e.service='conversation_closed' or e.ai_provider in ('conversation_closed','conversation_reset'))
    order by e.created_at desc,e.id desc limit 1;
    boundary := coalesce(boundary,'initial');
    if auth.role() = 'service_role' and p_session is distinct from boundary then raise exception 'STALE_ATTENDANCE'; end if;
  else
    boundary := 'manual:' || p_request;
  end if;
  select * into appointment from public.appointments where tenant_id=p_tenant and metadata->>'reservation_request'=p_request;
  if found then
    if appointment.metadata->>'unit_id' is distinct from p_unit
      or appointment.metadata->>'service_id' is distinct from p_service
      or appointment.metadata->>'requested_date' is distinct from p_date::text
      or appointment.metadata->>'requested_time' is distinct from to_char(p_time,'HH24:MI')
      or appointment.contact_name is distinct from trim(p_name)
      or appointment.channel_type is distinct from p_channel
      or appointment.external_conversation_id is distinct from nullif(p_chat,'')
      then raise exception 'RESERVATION_REQUEST_REUSED_WITH_DIFFERENT_DATA'; end if;
    if p_channel <> 'manual' and coalesce(appointment.metadata->>'conversation_session_id','initial') <> boundary
      then raise exception 'EXISTING_BOOKING_REQUIRES_REVIEW'; end if;
    return to_jsonb(appointment);
  end if;
  spec := public.magia_schedule_spec(p_tenant,p_unit,p_service);
  start_time := (p_date+p_time) at time zone (spec->>'timezone');
  -- A customer may hold multiple bookings, but retrying the same booking must not consume another place.
  if nullif(p_chat,'') is not null then
    select * into appointment from public.appointments where tenant_id=p_tenant and channel_type=p_channel
      and external_conversation_id=p_chat and starts_at=start_time
      and metadata->>'unit_id'=p_unit and metadata->>'service_id'=p_service
      and lower(trim(contact_name))=lower(trim(p_name))
      and status not in ('cancelled','canceled','completed','done','no_show')
      order by id limit 1;
    if found then
      if p_channel <> 'manual' and coalesce(appointment.metadata->>'conversation_session_id','initial') <> boundary
        then raise exception 'EXISTING_BOOKING_REQUIRES_REVIEW'; end if;
      return to_jsonb(appointment);
    end if;
  end if;
  select name into service_name from public.tenant_service_catalog where tenant_id=p_tenant and external_id=p_service and active;
  insert into public.appointments(tenant_id,title,starts_at,ends_at,status,contact_name,channel_type,external_conversation_id,created_by,notes,metadata)
  values(p_tenant,service_name || ' - ' || trim(p_name),start_time,
    start_time+make_interval(mins => (spec->>'duration')::integer),'pending_payment',trim(p_name),p_channel,nullif(p_chat,''),auth.uid(),p_notes,
    jsonb_build_object('unit_id',p_unit,'service_id',p_service,'service',service_name,'customer_name',trim(p_name),
      'requested_date',p_date,'requested_time',to_char(p_time,'HH24:MI'),'source','capacity_reservation',
      'payment_status','pending','reservation_request',p_request,'conversation_session_id',boundary)) returning * into appointment;
  return to_jsonb(appointment);
end $$;
revoke all on function public.magia_reserve_session_appointment(uuid,text,text,date,time,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.magia_reserve_session_appointment(uuid,text,text,date,time,text,text,text,text,text,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
