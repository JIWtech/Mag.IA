# RPCs publicadas — snapshot somente leitura

Capturado de NORIA-prod em 18/10/2026 (America/Sao_Paulo) por pg_get_functiondef. Referência para revisão e paridade; NÃO executar como migração ou rollback: contém o descarte inseguro em claim e não possui retry durável. Nenhuma função foi executada nesta captura. As seis assinaturas tinham EXECUTE somente para postgres e service_role.

## magia_begin_turn_delivery(uuid,text,uuid)

```sql
CREATE OR REPLACE FUNCTION public.magia_begin_turn_delivery(p_tenant uuid, p_chat text, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q public.conversation_turn_queue%rowtype; attempt public.conversation_turn_delivery_attempts%rowtype;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending'
    then raise exception 'STALE_DELIVERY_ATTEMPT'; end if;
  insert into public.conversation_turn_delivery_attempts(tenant_id,chat_id,session_id,turn_token,status,claimed_event_ids)
  values(p_tenant,p_chat,q.boundary_id,p_token,'attempting',coalesce((
    select jsonb_agg(value->>'event_id') from jsonb_array_elements(q.claimed)
  ),'[]'::jsonb))
  on conflict(turn_token) do update set updated_at=clock_timestamp()
  returning * into attempt;
  update public.conversation_turn_queue set current_delivery_id=attempt.id,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('id',attempt.id,'status',attempt.status);
end $function$
```

## magia_claim_turn(uuid,text)

```sql
CREATE OR REPLACE FUNCTION public.magia_claim_turn(p_tenant uuid, p_chat text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q public.conversation_turn_queue%rowtype; b text; k uuid; s text; delivered uuid;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found then return jsonb_build_object('claimed',false,'reason','empty'); end if;
  if q.phase='uncertain' then
    select e.id into delivered from public.channel_events e
      where e.tenant_id=p_tenant and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
        and e.direction='outbound' and e.raw_payload->>'delivery_attempt_id'=q.current_delivery_id::text
      order by e.created_at desc limit 1;
    if delivered is not null then
      update public.conversation_turn_delivery_attempts set status='confirmed',outbound_event_id=delivered,
        confirmed_at=coalesce(confirmed_at,clock_timestamp()),resolved_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=q.current_delivery_id;
      update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',
        current_delivery_id=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
      select * into q from public.conversation_turn_queue where tenant_id=p_tenant
        and channel_type='whatsapp' and chat_id=p_chat;
    elsif jsonb_array_length(q.pending)=0 or q.quiet_until>clock_timestamp() then
      return jsonb_build_object('claimed',false,'reason','delivery_uncertain');
    else
      update public.conversation_turn_delivery_attempts set status='superseded_uncertain',resolved_at=clock_timestamp(),
        updated_at=clock_timestamp(),error_code='newer_inbound_without_delivery_proof'
        where id=q.current_delivery_id and status<>'confirmed';
      update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',
        current_delivery_id=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
      select * into q from public.conversation_turn_queue where tenant_id=p_tenant
        and channel_type='whatsapp' and chat_id=p_chat;
    end if;
  end if;
  if q.token is not null and q.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','busy'); end if;
  if q.phase='sending' then
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    update public.conversation_turn_delivery_attempts set status='uncertain',updated_at=clock_timestamp(),
      error_code=coalesce(error_code,'sending_lease_expired') where id=q.current_delivery_id and status<>'confirmed';
    return jsonb_build_object('claimed',false,'reason','delivery_uncertain');
  end if;
  if q.token is not null then q.pending:=q.claimed||q.pending; end if;
  if jsonb_array_length(q.pending)=0 or q.quiet_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','quiet_window'); end if;
  select slug into s from public.tenants where id=p_tenant;
  select id::text into b from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  k:=gen_random_uuid();
  update public.conversation_turn_queue set token=k,phase='processing',claimed=q.pending,pending='[]',
    lease_until=clock_timestamp()+interval '180 seconds',claimed_at=clock_timestamp(),current_delivery_id=null,
    boundary_id=coalesce(b,'initial'),updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('claimed',true,'token',k,'messages',q.pending,
    'boundary_id',coalesce(b,'initial'),'instance',q.instance_name,'tenant_slug',s);
end $function$
```

## magia_commit_turn(uuid,text,uuid)

```sql
CREATE OR REPLACE FUNCTION public.magia_commit_turn(p_tenant uuid, p_chat text, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
```

## magia_confirm_turn_delivery(uuid,text,uuid,uuid,text,uuid)

```sql
CREATE OR REPLACE FUNCTION public.magia_confirm_turn_delivery(p_tenant uuid, p_chat text, p_token uuid, p_attempt uuid, p_provider_message text, p_outbound_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q public.conversation_turn_queue%rowtype; affected integer;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.current_delivery_id is distinct from p_attempt
    then return jsonb_build_object('confirmed',false,'reason','stale_delivery'); end if;
  update public.conversation_turn_delivery_attempts set status='confirmed',provider_message_id=p_provider_message,
    outbound_event_id=p_outbound_event,confirmed_at=clock_timestamp(),resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_attempt and tenant_id=p_tenant and turn_token=p_token;
  get diagnostics affected=row_count;
  return jsonb_build_object('confirmed',affected=1);
end $function$
```

## magia_enqueue_turn(uuid,text,text,jsonb,integer)

```sql
CREATE OR REPLACE FUNCTION public.magia_enqueue_turn(p_tenant uuid, p_chat text, p_instance text, p_message jsonb, p_quiet_ms integer DEFAULT 8000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
```

## magia_finish_turn(uuid,text,uuid,text)

```sql
CREATE OR REPLACE FUNCTION public.magia_finish_turn(p_tenant uuid, p_chat text, p_token uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q public.conversation_turn_queue%rowtype;
begin
  if p_outcome not in ('done','retry','cancelled','failed','uncertain') then raise exception 'Invalid outcome'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token then return jsonb_build_object('finished',false); end if;
  if p_outcome='retry' and q.phase<>'processing' then raise exception 'Cannot retry committed turn'; end if;
  if p_outcome='uncertain' then
    update public.conversation_turn_delivery_attempts set status='uncertain',updated_at=clock_timestamp(),
      error_code=coalesce(error_code,'provider_confirmation_missing') where id=q.current_delivery_id and status<>'confirmed';
    update public.conversation_turn_queue set phase='uncertain',updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  else
    update public.conversation_turn_queue set pending=case when p_outcome='retry' then claimed||pending else pending end,
      claimed='[]',token=null,lease_until=null,phase='ready',current_delivery_id=null,updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  end if;
  return jsonb_build_object('finished',true,'outcome',p_outcome);
end $function$
```

