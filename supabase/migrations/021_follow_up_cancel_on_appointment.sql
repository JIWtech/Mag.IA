-- Follow-up somente para conversas sem agendamento ou pre-agendamento futuro.
-- Execute depois de 019_follow_up_jobs.sql.
begin;

create or replace function public.magia_schedule_followups(
  p_tenant uuid,
  p_channel text,
  p_chat text,
  p_anchor uuid,
  p_contact text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  policy public.follow_up_policies%rowtype;
  step jsonb;
  inserted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Follow-up scheduling denied';
  end if;

  -- Pending payment also represents a registered pre-booking. Do not pursue it.
  if exists (
    select 1
    from public.appointments appointment
    where appointment.tenant_id = p_tenant
      and appointment.channel_type = p_channel
      and appointment.external_conversation_id = p_chat
      and appointment.starts_at > now()
      and lower(coalesce(appointment.status, 'scheduled')) not in (
        'cancelled', 'canceled', 'cancelado', 'cancelada', 'completed', 'done', 'no_show'
      )
  ) then
    update public.follow_up_jobs
    set status = 'cancelled', updated_at = now(), error = 'appointment_exists'
    where tenant_id = p_tenant
      and channel_type = p_channel
      and external_conversation_id = p_chat
      and status = 'pending';
    return 0;
  end if;

  select * into policy
  from public.follow_up_policies
  where tenant_id = p_tenant and channel_type = p_channel and enabled
  order by created_at
  limit 1;
  if not found then return 0; end if;

  update public.follow_up_jobs
  set status = 'cancelled', updated_at = now(), error = 'newer_outbound_reply'
  where tenant_id = p_tenant
    and channel_type = p_channel
    and external_conversation_id = p_chat
    and status = 'pending';

  for step in select value from jsonb_array_elements(policy.steps) loop
    if coalesce((step->>'delay_minutes')::integer, 0) < 1 or nullif(step->>'key', '') is null then
      continue;
    end if;
    insert into public.follow_up_jobs (
      tenant_id, policy_id, channel_type, external_conversation_id, contact_name,
      anchor_event_id, step_key, objective, due_at
    ) values (
      p_tenant, policy.id, p_channel, p_chat, p_contact, p_anchor,
      step->>'key', coalesce(step->>'objective', 'Retomar conversa'),
      now() + make_interval(mins => (step->>'delay_minutes')::integer)
    ) on conflict do nothing;
    inserted := inserted + 1;
  end loop;
  return inserted;
end $$;

create or replace function public.magia_cancel_followups_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(coalesce(new.external_conversation_id, '')), '') is not null
    and new.starts_at > now()
    and lower(coalesce(new.status, 'scheduled')) not in (
      'cancelled', 'canceled', 'cancelado', 'cancelada', 'completed', 'done', 'no_show'
    ) then
    update public.follow_up_jobs
    set status = 'cancelled', updated_at = now(), error = 'appointment_exists'
    where tenant_id = new.tenant_id
      and channel_type = new.channel_type
      and external_conversation_id = new.external_conversation_id
      and status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists magia_cancel_followups_from_appointment on public.appointments;
create trigger magia_cancel_followups_from_appointment
after insert or update of status, starts_at, channel_type, external_conversation_id
on public.appointments
for each row execute function public.magia_cancel_followups_from_appointment();

revoke all on function public.magia_schedule_followups(uuid, text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.magia_schedule_followups(uuid, text, text, uuid, text)
to service_role;

commit;
