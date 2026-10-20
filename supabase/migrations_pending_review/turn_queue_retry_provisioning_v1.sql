-- PROPOSTA (nao aplicada): provisionamento da politica de retry e tratamento de
-- concorrencia (new_messages_before_commit). Requer aprovacao explicita.
-- Os valores 3 / 30s / 900s abaixo sao PROPOSTOS e precisam ser aprovados
-- pelo responsavel antes de aplicar; alterar na unica constante da funcao.
-- Nao libera, reenvia nem altera nenhuma fila em 'review'/'uncertain' existente.

create or replace function public.magia_provision_turn_retry_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.conversation_turn_retry_policy(tenant_id,max_attempts,base_backoff_seconds,max_backoff_seconds)
  values(new.id,3,30,900) on conflict (tenant_id) do nothing;
  return new;
end $$;
revoke all on function public.magia_provision_turn_retry_policy() from public,anon,authenticated;

drop trigger if exists trg_provision_turn_retry_policy on public.tenants;
create trigger trg_provision_turn_retry_policy after insert on public.tenants
  for each row execute function public.magia_provision_turn_retry_policy();

insert into public.conversation_turn_retry_policy(tenant_id,max_attempts,base_backoff_seconds,max_backoff_seconds)
select t.id,3,30,900 from public.tenants t on conflict (tenant_id) do nothing;

create or replace function public.magia_finish_turn(p_tenant uuid,p_chat text,p_token uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; has_attempt boolean; confirmed boolean; proof jsonb;
begin
  if p_outcome is null or p_outcome not in ('done','retry','cancelled','failed','uncertain','review') then raise exception 'Invalid outcome'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then return jsonb_build_object('finished',false); end if;
  if p_outcome='retry' and q.phase<>'processing' then raise exception 'Cannot retry committed turn'; end if;
  if p_outcome='retry' then
    -- Concurrency, not failure: nothing was committed or sent, and newer inbound
    -- messages are already in `pending`. Claim merges claimed||pending, so the
    -- batch is requeued immediately without consuming retry budget and without
    -- depending on a configured policy. Any other retry keeps the budgeted path.
    if q.phase='processing' and q.retry_batch_id is not null and q.current_delivery_id is null
       and jsonb_array_length(q.pending)>0 and not exists (
         select 1 from public.conversation_turn_delivery_attempts a where a.tenant_id=p_tenant
           and a.channel_type='whatsapp' and a.chat_id=p_chat and a.turn_token=p_token) then
      update public.conversation_turn_queue set phase='ready',lease_until=clock_timestamp(),next_attempt_at=null,
        attempt_count=greatest(q.attempt_count-1,0),last_error_code='new_messages_before_commit',
        review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
      update public.conversation_turn_queue u set retry_max_attempts=pol.max_attempts,
        retry_base_seconds=pol.base_backoff_seconds,retry_cap_seconds=pol.max_backoff_seconds
        from public.conversation_turn_retry_policy pol
        where u.tenant_id=p_tenant and u.channel_type='whatsapp' and u.chat_id=p_chat
          and pol.tenant_id=p_tenant and u.retry_max_attempts is null;
      return jsonb_build_object('finished',true,'outcome','ready','reason','new_messages_coalesced',
        'retry_queued',true,'attempt_count',greatest(q.attempt_count-1,0),'contract','noria_turn_lifecycle_v1');
    end if;
    return public.magia_fail_turn(p_tenant,p_chat,p_token,'new_messages_before_commit',true);
  end if;
  if p_outcome='failed' then return public.magia_fail_turn(p_tenant,p_chat,p_token,'legacy_failed_outcome',false); end if;
  if p_outcome in ('uncertain','review') then
    update public.conversation_turn_queue set phase=case when q.current_delivery_id is not null then 'uncertain' else p_outcome end,
      last_error_code=coalesce(last_error_code,'explicit_technical_hold'),review_required_at=clock_timestamp(),
      lease_until=clock_timestamp(),updated_at=clock_timestamp()
      where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
    return jsonb_build_object('finished',true,'outcome',case when q.current_delivery_id is not null then 'uncertain' else p_outcome end,
      'retry_queued',false,'contract','noria_turn_lifecycle_v1');
  end if;
  select exists(select 1 from public.conversation_turn_delivery_attempts where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat and turn_token=p_token) into has_attempt;
  perform a.id from public.conversation_turn_delivery_attempts a join public.channel_events e on e.id=a.outbound_event_id
    where a.id=q.current_delivery_id and a.tenant_id=p_tenant and a.turn_token=p_token for share of a,e;
  select exists(select 1 from public.conversation_turn_delivery_attempts a join public.channel_events e on e.id=a.outbound_event_id
    where a.id=q.current_delivery_id and a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=p_chat
      and a.turn_token=p_token and a.status='confirmed' and a.confirmed_at is not null
      and nullif(a.provider_message_id,'') is not null and e.tenant_id=p_tenant and e.channel_type='whatsapp'
      and e.external_conversation_id=p_chat and e.direction='outbound' and e.sender_type='assistant'
      and e.external_message_id=a.provider_message_id and e.raw_payload->>'delivery_attempt_id'=a.id::text) into confirmed;
  if has_attempt or q.current_delivery_id is not null then
    if p_outcome<>'done' or not confirmed then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
  elsif q.phase not in ('processing','sending') or q.retry_batch_id is null or q.lease_until is null
      or q.lease_until<=clock_timestamp() or (p_outcome='done' and q.phase<>'sending') then
    raise exception 'UNRESOLVED_TURN_REQUIRES_REVIEW';
  else
    proof:=public.magia_turn_terminal_evidence(p_tenant,p_chat,p_token,p_outcome);
    if proof is null then
      return public.magia_fail_turn(p_tenant,p_chat,p_token,'TERMINAL_EVIDENCE_MISSING:'||p_outcome,false);
    end if;
  end if;
  if confirmed then proof:=jsonb_build_object('kind','confirmed_delivery','delivery_attempt_id',q.current_delivery_id); end if;
  insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
    values(p_token,p_tenant,p_chat,p_outcome,q.claimed,proof);
  update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',current_delivery_id=null,
    retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
    next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('finished',true,'outcome',p_outcome,'retry_queued',false,'contract','noria_turn_lifecycle_v1');
end $$;
