-- Recuperacao de revisao por encerramento autenticado + limite entre sessoes.
-- Nao altera filas existentes; a conversa travada e resolvida pelo operador via
-- magia_resolve_turn_review (close_with_evidence).

create or replace function public.magia_resolve_turn_review(
  p_tenant uuid,p_ticket uuid,p_expected_revision bigint,p_action text,p_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.conversation_turn_review_tickets%rowtype; q public.conversation_turn_queue%rowtype;
  pol public.conversation_turn_retry_policy%rowtype; actor uuid; result jsonb; proof jsonb; reviewer boolean;
  bt timestamptz; before_p jsonb; after_p jsonb;
begin
  actor:=auth.uid();
  reviewer:=exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=actor);
  -- Closing one's own authenticated attendance is not general review authority.
  -- Recheck that exact closure below, under the queue/ticket locks.
  if actor is null or (not reviewer and (p_action is distinct from 'close_with_evidence'
    or not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=actor
      and status='active' and role in ('owner','admin','manager','operator','agent')))) then
    raise exception 'TURN_REVIEW_FORBIDDEN';
  end if;
  if p_action is null or p_action not in ('acknowledge','finalize_confirmed','close_with_evidence','resume_unattempted')
    or nullif(btrim(p_note),'') is null then raise exception 'INVALID_REVIEW_RESOLUTION'; end if;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant;
  if not found then raise exception 'TURN_REVIEW_NOT_FOUND'; end if;
  -- Same lock order as every queue RPC/trigger: queue first, then ticket.
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=t.chat_id for update;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant for update;
  if q.tenant_id is null or t.resolved_at is not null or p_expected_revision is null
    or t.revision<>p_expected_revision or q.phase not in ('review','uncertain')
    or to_jsonb(q) is distinct from t.queue_snapshot then raise exception 'STALE_TURN_REVIEW'; end if;
  if p_action='acknowledge' then
    update public.conversation_turn_review_tickets set acknowledged_by=actor,acknowledged_at=clock_timestamp(),
      notification_pending=false,revision=revision+1,updated_at=clock_timestamp() where id=t.id;
    return jsonb_build_object('resolved',false,'acknowledged',true,'revision',t.revision+1);
  elsif p_action='finalize_confirmed' then
    -- finish revalidates the ledger + outbound evidence; no HTTP send occurs.
    result:=public.magia_finish_turn(p_tenant,q.chat_id,q.token,'done');
    if result->>'outcome' is distinct from 'done' then raise exception 'CONFIRMED_DELIVERY_REQUIRED'; end if;
    select evidence into proof from public.conversation_turn_terminal_receipts where turn_token=q.token;
  else
    -- Check the entire claimed message set across tokens, not merely a NULL
    -- current_delivery_id. Missing legacy ledger entries are NOT no-send proof.
    if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
      where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=q.chat_id
        and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
          where a.claimed_event_ids ? (m->>'event_id')))) then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
    if p_action='close_with_evidence' then
      proof:=public.magia_turn_terminal_evidence(p_tenant,q.chat_id,q.token,'cancelled');
      if proof is null then raise exception 'TERMINAL_EVIDENCE_MISSING'; end if;
      if not reviewer and (q.phase<>'review' or proof->>'kind' is distinct from 'conversation_closed'
        or not exists(select 1 from public.conversation_turn_control_origins o
          where o.event_id::text=proof->>'event_id' and o.tenant_id=p_tenant
            and o.actor_id=actor and o.source_kind='authenticated_operator')) then
        raise exception 'TURN_REVIEW_FORBIDDEN';
      end if;
      -- Session boundary: messages received up to the closure belong to the
      -- closed session and are receipted with it (never answered or resent).
      -- Only messages received after the closure stay pending for a new batch.
      select e.created_at into bt from public.channel_events e where e.id::text=proof->>'event_id' and e.tenant_id=p_tenant;
      select coalesce(jsonb_agg(x.m order by x.ord) filter (where x.stale),'[]'::jsonb),
             coalesce(jsonb_agg(x.m order by x.ord) filter (where not x.stale),'[]'::jsonb)
        into before_p,after_p
        from (select m,ord,exists(select 1 from public.channel_events c where c.id::text=m->>'event_id'
                and c.tenant_id=p_tenant and c.created_at<=bt) as stale
              from jsonb_array_elements(q.pending) with ordinality as t(m,ord)) x;
      insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
        values(q.token,p_tenant,q.chat_id,'cancelled',q.claimed||before_p,proof);
      update public.conversation_turn_queue set phase='ready',claimed='[]',pending=after_p,token=null,lease_until=null,current_delivery_id=null,
        retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
        next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    else
      -- Only a v1 REVIEW batch with no delivery reservation may be resumed.
      -- UNCERTAIN and all legacy batches have no resend action in this RPC.
      if q.phase<>'review' or q.retry_batch_id is null or q.token is null then raise exception 'NO_SEND_PROOF_REQUIRED'; end if;
      select * into pol from public.conversation_turn_retry_policy where tenant_id=p_tenant;
      if not found then raise exception 'RETRY_POLICY_REQUIRED'; end if;
      proof:=jsonb_build_object('kind','v1_no_delivery_reservation','prior_batch_id',q.retry_batch_id);
      update public.conversation_turn_queue set phase='ready',token=gen_random_uuid(),lease_until=clock_timestamp(),
        retry_batch_id=gen_random_uuid(),attempt_count=0,retry_max_attempts=pol.max_attempts,
        retry_base_seconds=pol.base_backoff_seconds,retry_cap_seconds=pol.max_backoff_seconds,
        next_attempt_at=clock_timestamp()+make_interval(secs=>pol.base_backoff_seconds),last_error_code=null,
        review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    end if;
  end if;
  update public.conversation_turn_review_tickets set resolved_by=actor,resolved_at=clock_timestamp(),resolution=p_action,
    resolution_note=p_note,resolution_snapshot=to_jsonb(q),resolution_evidence=proof,notification_pending=false,
    updated_at=clock_timestamp() where id=t.id;
  return jsonb_build_object('resolved',true,'action',p_action,'ticket_id',t.id);
end $$;

create or replace function public.magia_resolve_closed_turn_review(p_event uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.channel_events%rowtype; q public.conversation_turn_queue%rowtype;
  t public.conversation_turn_review_tickets%rowtype; proof jsonb;
begin
  select c.* into e from public.channel_events c
    join public.conversation_turn_control_origins o on o.event_id=c.id and o.tenant_id=c.tenant_id
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c))
    where c.id=p_event and c.channel_type='whatsapp' and c.direction='outbound'
      and c.sender_type='system' and c.service='conversation_closed'
      and c.raw_payload->>'command'='close_conversation'
      and o.actor_id=auth.uid() and o.source_kind='authenticated_operator';
  if not found then return jsonb_build_object('resolved',false,'reason','closure_not_proven'); end if;
  select * into q from public.conversation_turn_queue where tenant_id=e.tenant_id
    and channel_type='whatsapp' and chat_id=e.external_conversation_id for update;
  if not found or q.phase<>'review' or q.token is null or jsonb_array_length(q.claimed)=0 then
    return jsonb_build_object('resolved',false,'reason','no_covered_review');
  end if;
  if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
    where a.tenant_id=q.tenant_id and a.channel_type=q.channel_type and a.chat_id=q.chat_id
      and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
        where a.claimed_event_ids ? (m->>'event_id')))) then
    return jsonb_build_object('resolved',false,'reason','delivery_reconciliation_required');
  end if;
  proof:=public.magia_turn_terminal_evidence(q.tenant_id,q.chat_id,q.token,'cancelled');
  if proof->>'kind' is distinct from 'conversation_closed'
    or proof->>'event_id' is distinct from e.id::text then
    return jsonb_build_object('resolved',false,'reason','closure_does_not_cover_batch');
  end if;
  select * into t from public.conversation_turn_review_tickets where tenant_id=q.tenant_id
    and channel_type=q.channel_type and chat_id=q.chat_id and resolved_at is null for update;
  if not found then raise exception 'TURN_REVIEW_TICKET_MISSING'; end if;
  return public.magia_resolve_turn_review(q.tenant_id,t.id,t.revision,'close_with_evidence',
    'Authenticated attendance closure: '||e.id::text);
end $$;

create or replace function public.magia_record_turn_control_event(p_event jsonb)
returns setof public.channel_events language plpgsql security definer set search_path=public,pg_temp as $$
declare tid uuid; slug text; e public.channel_events%rowtype;
begin
  tid:=(p_event->>'tenant_id')::uuid;
  if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=tid and user_id=auth.uid()
    and status='active' and role in ('owner','admin','manager','operator','agent')) then raise exception 'CONTROL_ORIGIN_FORBIDDEN'; end if;
  select t.slug into slug from public.tenants t where t.id=tid and t.status='active' and t.deleted_at is null;
  if slug is null or p_event->>'channel_type' is distinct from 'whatsapp' or p_event->>'direction' is distinct from 'outbound'
    or p_event->>'sender_type' is null or p_event->>'sender_type' not in ('human','system') or nullif(p_event->>'external_conversation_id','') is null
    or nullif(p_event->>'external_message_id','') is null then raise exception 'CONTROL_EVENT_SCOPE_MISMATCH'; end if;
  perform 1 from public.conversation_turn_queue where tenant_id=tid and channel_type='whatsapp'
    and chat_id=p_event->>'external_conversation_id' for update;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,
    sender_type,contact_name,message_text,service,stage,handoff,response_text,raw_payload,ai_provider,ai_model,ai_error,ai_usage,
    sent_by_user,delivery_status,command_id,created_at)
  values(tid,slug,'whatsapp',p_event->>'external_conversation_id',p_event->>'external_message_id','outbound',p_event->>'sender_type',
    p_event->>'contact_name',p_event->>'message_text',p_event->>'service',p_event->>'stage',coalesce((p_event->>'handoff')::boolean,false),
    p_event->>'response_text',coalesce(p_event->'raw_payload','{}'),p_event->>'ai_provider',p_event->>'ai_model',p_event->>'ai_error',
    coalesce(p_event->'ai_usage','{}'),p_event->>'sent_by_user',p_event->>'delivery_status',p_event->>'command_id',clock_timestamp())
    on conflict do nothing returning * into e;
  if e.id is null then
    select * into e from public.channel_events where tenant_id=tid and channel_type='whatsapp'
      and external_conversation_id=p_event->>'external_conversation_id' and external_message_id=p_event->>'external_message_id';
  end if;
  if e.id is null then raise exception 'CONTROL_EVENT_NOT_PERSISTED'; end if;
  perform public.magia_attest_turn_control_event(tid,e.id);
  -- Only this authenticated closure may finish its covered, unattempted REVIEW
  -- batch. Keep uncertain and every unresolved delivery under reconciliation.
  if e.service='conversation_closed' then
    perform public.magia_resolve_closed_turn_review(e.id);
  end if;
  return next e;
end $$;

create or replace function public.magia_claim_turn(p_tenant uuid, p_chat text)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare q public.conversation_turn_queue%rowtype; pol public.conversation_turn_retry_policy%rowtype;
  b text; bt timestamptz; k uuid; s text; r jsonb; batch jsonb; fresh jsonb;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found then return jsonb_build_object('claimed',false,'reason','empty'); end if;
  if q.phase in ('uncertain','review') then
    return jsonb_build_object('claimed',false,'reason',case when q.phase='review' then 'technical_review_required' else 'delivery_uncertain' end);
  end if;
  if q.token is not null and q.lease_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','busy');
  end if;
  if q.phase in ('processing','sending') then
    r:=public.magia_fail_turn(p_tenant,p_chat,q.token,'lease_expired',true);
    return jsonb_build_object('claimed',false,'reason',r->>'reason');
  end if;
  if q.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','retry_backoff');
  end if;
  select slug into s from public.tenants where id=p_tenant and status='active' and deleted_at is null;
  if s is null then return jsonb_build_object('claimed',false,'reason','inactive_tenant'); end if;
  select id::text,created_at into b,bt from public.channel_events where tenant_slug=s and channel_type='whatsapp'
    and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1;
  -- Session limit: pending messages received before the latest closure/reset
  -- belong to the previous session and must never open a new turn.
  select coalesce(jsonb_agg(m order by ord),'[]'::jsonb) into fresh
    from jsonb_array_elements(q.pending) with ordinality as t(m,ord)
    where bt is null or not exists(select 1 from public.channel_events c where c.id::text=m->>'event_id'
      and c.tenant_id=p_tenant and c.created_at<=bt);
  if fresh is distinct from q.pending then
    update public.conversation_turn_queue set pending=fresh,updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    q.pending:=fresh;
  end if;
  batch:=q.claimed||q.pending;
  if jsonb_array_length(batch)=0 or q.quiet_until>clock_timestamp() then
    return jsonb_build_object('claimed',false,'reason','quiet_window');
  end if;
  if q.retry_batch_id is null and jsonb_array_length(q.claimed)>0 then
    update public.conversation_turn_queue set phase='review',last_error_code='legacy_untracked_batch',
      review_required_at=clock_timestamp(),updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('claimed',false,'reason','technical_review_required');
  end if;
  if q.retry_batch_id is not null and (q.retry_max_attempts is null or q.attempt_count>=q.retry_max_attempts) then
    update public.conversation_turn_queue set phase='review',review_required_at=clock_timestamp(),
      last_error_code=case when q.retry_max_attempts is null then 'retry_policy_missing' else 'retry_budget_exhausted' end,
      updated_at=clock_timestamp() where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('claimed',false,'reason','technical_review_required');
  end if;
  if q.retry_batch_id is null then
    select * into pol from public.conversation_turn_retry_policy where tenant_id=p_tenant;
    q.retry_batch_id:=gen_random_uuid(); q.attempt_count:=0;
    q.retry_max_attempts:=pol.max_attempts; q.retry_base_seconds:=pol.base_backoff_seconds; q.retry_cap_seconds:=pol.max_backoff_seconds;
  end if;
  k:=gen_random_uuid();
  update public.conversation_turn_queue set token=k,phase='processing',claimed=batch,pending='[]',
    lease_until=clock_timestamp()+interval '180 seconds',claimed_at=clock_timestamp(),current_delivery_id=null,
    boundary_id=coalesce(b,'initial'),retry_batch_id=q.retry_batch_id,attempt_count=q.attempt_count+1,
    retry_max_attempts=q.retry_max_attempts,retry_base_seconds=q.retry_base_seconds,retry_cap_seconds=q.retry_cap_seconds,
    next_attempt_at=null,review_required_at=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('claimed',true,'token',k,'messages',batch,'boundary_id',coalesce(b,'initial'),
    'instance',q.instance_name,'tenant_slug',s,'retry_batch_id',q.retry_batch_id,
    'attempt_count',q.attempt_count+1,'contract','noria_turn_lifecycle_v1');
end $$;

revoke all on function public.magia_resolve_closed_turn_review(uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_claim_turn(uuid,text) from public,anon,authenticated;
