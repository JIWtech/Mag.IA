-- Durable, service-only queue. No existing customer data is deleted or rewritten.
begin;
create table if not exists public.conversation_turn_queue (
  tenant_id uuid not null references public.tenants(id),
  channel_type text not null,
  chat_id text not null,
  instance_name text not null,
  pending jsonb not null default '[]',
  claimed jsonb not null default '[]',
  quiet_until timestamptz not null default now(),
  token uuid,
  lease_until timestamptz,
  claimed_at timestamptz,
  boundary_id text not null default 'initial',
  phase text not null default 'ready' check (phase in ('ready','processing','sending','uncertain')),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, channel_type, chat_id)
);
alter table public.conversation_turn_queue enable row level security;
revoke all on public.conversation_turn_queue from anon, authenticated;
grant all on public.conversation_turn_queue to service_role;

create or replace function public.magia_enqueue_turn(
  p_tenant uuid, p_chat text, p_instance text, p_message jsonb, p_quiet_ms integer default 8000
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s text; eid uuid; q public.conversation_turn_queue%rowtype;
begin
  select slug into s from public.tenants where id = p_tenant and status = 'active' and deleted_at is null;
  if s is null or nullif(p_chat,'') is null or nullif(p_message->>'id','') is null then
    raise exception 'Invalid tenant, chat or message';
  end if;
  if not exists (select 1 from public.channels where tenant_id=p_tenant and type='whatsapp'
      and status='active' and (external_id=p_instance or config->>'instance_name'=p_instance)) then
    raise exception 'Instance does not belong to tenant';
  end if;
  insert into public.conversation_turn_queue(tenant_id,channel_type,chat_id,instance_name)
    values(p_tenant,'whatsapp',p_chat,p_instance) on conflict do nothing;
  select * into q from public.conversation_turn_queue
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,
    external_message_id,direction,sender_type,contact_name,message_text,stage,handoff,ai_provider,raw_payload)
  values(p_tenant,s,'whatsapp',p_chat,p_message->>'id','inbound','contact',p_message->>'name',
    p_message->>'text','Buffering',false,'buffer',coalesce(p_message->'raw','{}'::jsonb))
  on conflict do nothing returning id into eid;
  if eid is null then return jsonb_build_object('duplicate',true); end if;
  update public.conversation_turn_queue set
    pending=pending || jsonb_build_array(jsonb_build_object('event_id',eid,'id',p_message->>'id',
      'text',p_message->>'text','name',p_message->>'name','received_at',clock_timestamp())),
    quiet_until=clock_timestamp() + make_interval(secs=>greatest(3000,least(p_quiet_ms,45000))/1000.0),
    instance_name=p_instance, updated_at=clock_timestamp()
  where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('duplicate',false,'event_id',eid);
end $$;

create or replace function public.magia_claim_turn(p_tenant uuid, p_chat text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; b text; k uuid; s text;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found then return jsonb_build_object('claimed',false,'reason','empty'); end if;
  if q.phase='uncertain' then return jsonb_build_object('claimed',false,'reason','delivery_uncertain'); end if;
  if q.token is not null and q.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','busy');
  end if;
  if q.phase='sending' then
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('claimed',false,'reason','delivery_uncertain');
  end if;
  if q.token is not null then
    q.pending := q.claimed || q.pending;
  end if;
  if jsonb_array_length(q.pending)=0 or q.quiet_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','quiet_window');
  end if;
  select slug into s from public.tenants where id=p_tenant;
  select id::text into b from public.channel_events
    where tenant_slug=s and channel_type='whatsapp' and external_conversation_id=p_chat
      and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  k:=gen_random_uuid();
  update public.conversation_turn_queue set token=k,phase='processing',claimed=q.pending,pending='[]',
    lease_until=clock_timestamp()+interval '180 seconds',claimed_at=clock_timestamp(),
    boundary_id=coalesce(b,'initial'),updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('claimed',true,'token',k,'messages',q.pending,
    'boundary_id',coalesce(b,'initial'),'instance',q.instance_name,'tenant_slug',s);
end $$;

create or replace function public.magia_commit_turn(p_tenant uuid,p_chat text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; b text; s text;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'processing' or q.lease_until<=clock_timestamp() then
    return jsonb_build_object('committed',false,'reason','lost_lease');
  end if;
  select slug into s from public.tenants where id=p_tenant;
  select id::text into b from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  if coalesce(b,'initial')<>q.boundary_id or exists (
    select 1 from public.channel_events where tenant_slug=s and channel_type='whatsapp'
      and external_conversation_id=p_chat and created_at>q.claimed_at
      and (handoff=true or service='conversation_assigned') and ai_provider is distinct from 'buffer'
  ) then
    return jsonb_build_object('committed',false,'reason','conversation_control_changed');
  end if;
  if jsonb_array_length(q.pending)>0 then
    return jsonb_build_object('committed',false,'reason','new_messages');
  end if;
  update public.conversation_turn_queue set phase='sending',lease_until=clock_timestamp()+interval '180 seconds',
    updated_at=clock_timestamp() where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('committed',true);
end $$;

create or replace function public.magia_finish_turn(p_tenant uuid,p_chat text,p_token uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype;
begin
  if p_outcome not in ('done','retry','cancelled','failed','uncertain') then raise exception 'Invalid outcome'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token then return jsonb_build_object('finished',false); end if;
  if p_outcome='retry' and q.phase<>'processing' then raise exception 'Cannot retry committed turn'; end if;
  if p_outcome='uncertain' then
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  else
    update public.conversation_turn_queue set
      pending=case when p_outcome='retry' then claimed || pending else pending end,
      claimed='[]',token=null,lease_until=null,phase='ready',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  end if;
  return jsonb_build_object('finished',true,'outcome',p_outcome);
end $$;

revoke all on function public.magia_enqueue_turn(uuid,text,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.magia_claim_turn(uuid,text) from public,anon,authenticated;
revoke all on function public.magia_commit_turn(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_finish_turn(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.magia_enqueue_turn(uuid,text,text,jsonb,integer) to service_role;
grant execute on function public.magia_claim_turn(uuid,text) to service_role;
grant execute on function public.magia_commit_turn(uuid,text,uuid) to service_role;
grant execute on function public.magia_finish_turn(uuid,text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
