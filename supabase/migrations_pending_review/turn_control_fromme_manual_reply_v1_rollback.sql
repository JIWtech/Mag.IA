-- ROLLBACK de turn_control_fromme_manual_reply_v1.sql: restaura as 3 funções como estavam em produção
-- em 2026-10-21 antes da migração (conferido contra prosrc). As origens inseridas pelo backfill ficam
-- (source_kind=authenticated_provider_outbound); sem as funções novas elas não alteram o comportamento.
begin;

create or replace function public.magia_capture_authenticated_control()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare principal uuid;
begin
  if auth.uid() is not null and new.channel_type='whatsapp' and new.direction='outbound'
    and (new.sender_type='human' or new.service in ('conversation_closed','conversation_assigned','resume_ai','appointment_payment_confirmed','manual_reply','handoff_requested'))
    and exists(select 1 from public.tenant_members where tenant_id=new.tenant_id and user_id=auth.uid()
      and status='active' and role in ('owner','admin','manager','operator','agent')) then
    insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot)
      values(new.id,new.tenant_id,auth.uid(),public.magia_control_event_projection(to_jsonb(new))) on conflict do nothing;
  elsif new.channel_type='whatsapp' and new.direction='outbound' and new.sender_type='human'
    and not exists(select 1 from public.conversation_turn_delivery_attempts da where da.tenant_id=new.tenant_id and da.chat_id=new.external_conversation_id
      and (da.provider_message_id=new.external_message_id or da.status in ('attempting','uncertain')))
    and not exists(select 1 from public.channel_events ce where ce.tenant_id=new.tenant_id and ce.channel_type='whatsapp'
      and ce.external_message_id=new.external_message_id and ce.sender_type='assistant') then
    select s.principal_id into principal from public.conversation_turn_ingress_facts f
      join public.conversation_turn_ingress_sources s on s.id=f.source_id where f.tenant_id=new.tenant_id
        and f.chat_id=new.external_conversation_id and f.external_message_id=new.external_message_id and f.from_me
        and s.enabled and s.tenant_id=f.tenant_id and s.instance_name=f.instance_name limit 1;
    if found then
      insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot,source_kind)
        values(new.id,new.tenant_id,principal,public.magia_control_event_projection(to_jsonb(new)),'authenticated_provider_outbound') on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

create or replace function public.magia_turn_control_evidence(p_tenant uuid, p_chat text, p_token uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; e public.channel_events%rowtype; ids jsonb; authority jsonb; kind text;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token
    or jsonb_array_length(q.claimed)=0 or p_outcome is null or p_outcome not in ('done','cancelled') then return null; end if;
  -- All claimed IDs must identify the original inbound in this exact tenant/chat.
  if exists(select 1 from jsonb_array_elements(q.claimed) m where not exists (
    select 1 from public.channel_events c where c.id::text=m->>'event_id'
      and c.tenant_id=p_tenant and c.channel_type='whatsapp' and c.external_conversation_id=p_chat
      and c.external_message_id=m->>'id' and c.direction='inbound'
  )) then return null; end if;
  perform c.id from public.channel_events c join jsonb_array_elements(q.claimed) m on c.id::text=m->>'event_id'
    order by c.id for share of c;
  select jsonb_agg(m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  select * into e from public.channel_events c where c.tenant_id=p_tenant and c.channel_type='whatsapp'
    and c.external_conversation_id=p_chat and c.direction='outbound' and c.sender_type='system'
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=c.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c)))
    and c.service='conversation_closed'
    and ((c.raw_payload->>'command'='close_conversation' and nullif(c.raw_payload->>'closed_by','') is not null)
      or (c.ai_provider='sales_operator' and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant
        and tm.user_id::text=c.raw_payload->>'operator_id' and tm.status='active'
        and tm.role in ('owner','admin','manager','operator','agent'))))
    and (c.created_at>=q.claimed_at or c.id::text=q.boundary_id)
    and not exists(select 1 from jsonb_array_elements(q.claimed) m join public.channel_events i on i.id::text=m->>'event_id'
      where i.created_at>c.created_at)
    order by c.created_at desc,c.id desc limit 1 for share;
  if found then return jsonb_build_object('kind','conversation_closed','event_id',e.id,'claimed_event_ids',ids); end if;
  -- Inspect the latest explicit control event; an old assignment cannot survive
  -- a later resume/reset/close. Ordinary CORE handoff flags do not qualify.
  select * into e from public.channel_events c where c.tenant_id=p_tenant and c.channel_type='whatsapp'
    and c.external_conversation_id=p_chat and c.direction='outbound'
    and (((c.sender_type='human' or c.service in ('conversation_assigned','conversation_closed','resume_ai','appointment_payment_confirmed','handoff_requested','manual_reply'))
      and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=c.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c))))
       or ((c.service='conversation_reset' or c.ai_provider='conversation_reset')
         and exists(select 1 from public.conversation_turn_delivery_attempts da where da.tenant_id=p_tenant
           and da.chat_id=p_chat and da.status='confirmed' and da.outbound_event_id=c.id
           and da.provider_message_id=c.external_message_id))
       or (c.handoff is true and exists(select 1 from public.conversation_turn_delivery_attempts da
         where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
           and da.status='confirmed' and da.outbound_event_id=c.id and da.provider_message_id=c.external_message_id)))
    order by c.created_at desc,c.id desc limit 1 for share;
  if found and (p_outcome='done' or e.created_at>=q.claimed_at)
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
    and (e.sender_type='human' or (e.sender_type='system' and e.service in ('conversation_assigned','handoff_requested')
      and ((e.raw_payload->>'command'='assign_conversation' and nullif(e.raw_payload->>'assigned_by','') is not null)
        or (e.ai_provider='sales_operator' and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant
          and tm.user_id::text=e.raw_payload->>'operator_id' and tm.status='active'
          and tm.role in ('owner','admin','manager','operator','agent')))))) then
    return jsonb_build_object('kind','human_control','event_id',e.id,'claimed_event_ids',ids);
  end if;
  if e.id is not null and p_outcome='cancelled' and e.created_at>=q.claimed_at and e.ai_provider='sales_operator'
    and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
    and exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant and tm.status='active'
      and tm.user_id::text=e.raw_payload->>'operator_id' and tm.role in ('owner','admin','manager','operator','agent')) then
    return jsonb_build_object('kind','operator_control_changed','event_id',e.id,'claimed_event_ids',ids);
  end if;
  if e.id is not null and (p_outcome='done' or e.created_at>=q.claimed_at) and (
    (e.handoff is true and exists(select 1 from public.conversation_turn_delivery_attempts da
      where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
        and da.status='confirmed' and da.outbound_event_id=e.id and da.provider_message_id=e.external_message_id))
    or (e.service='appointment_payment_confirmed' and e.raw_payload->>'command'='confirm_payment_signal'
      and exists(select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
      and nullif(e.raw_payload->>'confirmed_by','') is not null and exists(select 1 from public.appointments ap
        where ap.id::text=e.raw_payload->>'appointment_id' and ap.tenant_id=p_tenant and ap.channel_type='whatsapp'
          and ap.external_conversation_id=p_chat and ap.status='confirmed'
          and ap.metadata->>'signal_confirmation_state'='sent' and ap.metadata->>'confirmation_message_id'=e.external_message_id))
  ) then return jsonb_build_object('kind','persisted_handoff','event_id',e.id,'claimed_event_ids',ids); end if;
  return jsonb_build_object('kind','unproven');
end $$;

create or replace function public.magia_turn_suppression_status(p_tenant uuid, p_chat text, p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; cfg jsonb; l public.sales_leads%rowtype;
  f public.conversation_turn_ingress_facts%rowtype; a public.conversation_turn_suppression_authorizations%rowtype;
  facts jsonb:='{}'; candidates text[]; excluded text; control_proof jsonb;
  latest_control public.channel_events%rowtype;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then raise exception 'STALE_SUPPRESSION_TURN'; end if;
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant for share;
  if not found then raise exception 'TENANT_CONFIGURATION_MISSING'; end if;
  if cfg->>'ai_enabled'='false' then facts:=facts||jsonb_build_object('ai_disabled',jsonb_build_object('source','tenant_settings','enabled',false)); end if;
  select * into l from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=q.boundary_id for share;
  if found and l.ai_locked and cfg#>'{sales,stages}' ? l.stage_key
    and cfg#>>array['sales','stages',l.stage_key,'allow_ai'] is distinct from 'true' then
    facts:=facts||jsonb_build_object('lead_locked',jsonb_build_object('source','sales_leads+tenant_settings','lead_id',l.id,'revision',l.revision,'stage_key',l.stage_key));
  end if;
  select x.* into f from public.conversation_turn_ingress_facts x join public.conversation_turn_ingress_sources s on s.id=x.source_id
    where x.tenant_id=p_tenant and x.chat_id=p_chat and x.instance_name=q.instance_name and s.enabled and not x.from_me
      and s.tenant_id=x.tenant_id and s.instance_name=x.instance_name
      and exists(select 1 from jsonb_array_elements(q.claimed) m where m->>'id'=x.external_message_id)
    order by x.received_at desc,x.external_message_id desc limit 1 for share of x,s;
  if found then
    if f.owner_saved is true then facts:=facts||jsonb_build_object('owner_saved_contact',jsonb_build_object('source','authenticated_ingress','source_id',f.source_id,'message_id',f.external_message_id,'digest',f.body_sha256)); end if;
    if f.business_account is true then facts:=facts||jsonb_build_object('commercial_contact',jsonb_build_object('source','authenticated_ingress','source_id',f.source_id,'message_id',f.external_message_id,'digest',f.body_sha256)); end if;
  end if;
  if cfg->'contact_exclusion_enabled'='true'::jsonb or cfg->>'contact_exclusion_enabled'='true' then
    -- LID aliases only from authenticated ingress, never mutable raw_payload.
    candidates:=public.magia_exclusion_phone_candidates(case when p_chat like '%@lid' then f.phone_jid else p_chat end);
    select phone into excluded from public.tenant_ai_excluded_contacts where tenant_id=p_tenant and phone=any(candidates) order by phone limit 1 for share;
    if found then facts:=facts||jsonb_build_object('contact_excluded',jsonb_build_object('source','tenant_ai_excluded_contacts','phone',excluded)); end if;
  end if;
  for a in select * from public.conversation_turn_suppression_authorizations where tenant_id=p_tenant
    and chat_id=p_chat and turn_token=p_token and claimed=q.claimed for share loop
    facts:=facts||jsonb_build_object(a.kind,jsonb_build_object('source','authenticated_operator','actor_id',a.actor_id,'created_at',a.created_at));
  end loop;
  control_proof:=public.magia_turn_control_evidence(p_tenant,p_chat,p_token,'done');
  -- Legacy human ownership is a safety hold, never terminal evidence. Do not
  -- silently clear it merely because the new origin ledger starts empty.
  select c.* into latest_control from public.channel_events c
    where c.tenant_id=p_tenant and c.channel_type='whatsapp'
      and c.external_conversation_id=p_chat and c.direction='outbound'
      and (c.sender_type='human' or c.service in
        ('conversation_assigned','conversation_closed','resume_ai','appointment_payment_confirmed','handoff_requested','manual_reply','conversation_reset')
        or c.ai_provider='conversation_reset' or c.handoff is true)
    order by c.created_at desc,c.id desc limit 1 for share;
  if found and facts='{}'::jsonb
    and (latest_control.sender_type='human' or latest_control.service in
      ('conversation_assigned','handoff_requested','manual_reply') or latest_control.handoff is true)
    and not exists(select 1 from public.conversation_turn_control_origins o
      where o.event_id=latest_control.id and o.tenant_id=p_tenant
        and o.event_snapshot=public.magia_control_event_projection(to_jsonb(latest_control)))
    and not exists(select 1 from public.conversation_turn_delivery_attempts da
      where da.tenant_id=p_tenant and da.chat_id=p_chat and da.session_id=q.boundary_id
        and da.status='confirmed' and da.outbound_event_id=latest_control.id
        and da.provider_message_id=latest_control.external_message_id) then
    raise exception 'TURN_CONTROL_ORIGIN_REQUIRED';
  end if;
  if control_proof->>'kind' in ('human_control','persisted_handoff') then
    facts:=facts||jsonb_build_object('human_control',control_proof);
  elsif control_proof->>'kind'='conversation_closed' then
    facts:=facts||jsonb_build_object('conversation_closed',control_proof);
  end if;
  return jsonb_build_object('contract','noria_turn_lifecycle_v1','evidence',facts);
end $$;

commit;
