-- Opt-in only. No tenant settings, existing leads, follow-up jobs or RLS changes.
begin;

create or replace function public.magia_sales_financing_qualification(p_state jsonb,p_product jsonb,p_documents jsonb)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare deposit bigint; price bigint; minimum bigint; doc jsonb; born date;
  cpf boolean:=false; cnh boolean:=false; birth boolean:=false; enough boolean; complete boolean; status text;
begin
  deposit:=nullif(p_state->>'deposit_cents','')::bigint;
  price:=nullif(p_product->>'price_cents','')::bigint;
  if price>0 and nullif(p_product->>'id','') is not null then
    minimum:=ceil(price::numeric*30/100)::bigint;
  end if;
  for doc in select value from jsonb_array_elements(coalesce(p_documents,'[]'::jsonb)) loop
    cpf:=cpf or regexp_replace(coalesce(doc->>'cpf',''),'[^0-9]','','g') ~ '^[0-9]{11}$';
    cnh:=cnh or regexp_replace(coalesce(doc->>'cnh',''),'[^0-9]','','g') ~ '^[0-9]{11}$';
    begin
      born:=null;
      if coalesce(doc->>'birth_date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        born:=(doc->>'birth_date')::date;
      elsif coalesce(doc->>'birth_date','') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
        born:=make_date(substring(doc->>'birth_date',7,4)::int,substring(doc->>'birth_date',4,2)::int,substring(doc->>'birth_date',1,2)::int);
      end if;
      birth:=birth or coalesce(born between date '1900-01-01' and current_date,false);
    exception when datetime_field_overflow or invalid_datetime_format then null;
    end;
  end loop;
  enough:=coalesce(minimum>0 and deposit>=minimum and deposit<=price,false);
  complete:=cpf and cnh and birth;
  status:=case when minimum is null then 'vehicle_pending'
    when deposit is null then 'deposit_unknown'
    when not enough then 'deposit_insufficient'
    when not complete then 'documents_pending' else 'ready' end;
  return jsonb_build_object('rule','deposit_30_and_financing_documents_v1','status',status,
    'deposit_cents',deposit,'minimum_deposit_cents',minimum,'deposit_sufficient',enough,
    'documents_complete',complete,'cpf_received',cpf,'cnh_received',cnh,'birth_date_received',birth);
end $$;
revoke all on function public.magia_sales_financing_qualification(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.magia_sales_financing_qualification(jsonb,jsonb,jsonb) to service_role;

create or replace function public.magia_sales_save(
  p_tenant uuid,p_chat text,p_session text,p_token uuid,p_revision integer,p_request text,
  p_state jsonb,p_product jsonb,p_stage text,p_register boolean default false,p_documents jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; lead public.sales_leads%rowtype; q public.conversation_turn_queue%rowtype;
  stage text; deposit bigint; price bigint; threshold numeric; hot boolean:=false; doc jsonb;
  financing_rule boolean; qualification jsonb; docs jsonb; purchase boolean;
begin
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' or cfg->>'ai_enabled' is distinct from 'true'
    then raise exception 'SALES_DISABLED'; end if;
  select * into q from public.conversation_turn_queue
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending'
    or q.boundary_id<>p_session then raise exception 'STALE_SALES_TURN'; end if;
  if coalesce((select id::text from public.channel_events where tenant_id=p_tenant
    and channel_type='whatsapp' and external_conversation_id=p_chat
    and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial')<>p_session then raise exception 'STALE_SALES_SESSION'; end if;
  select * into lead from public.sales_leads where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat and session_id=p_session for update;
  if found and (lead.revision<>p_revision or lead.ai_locked) then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if lead.id is null and p_revision<>0 then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if jsonb_typeof(p_state)<>'object' or length(p_state::text)>12000 then raise exception 'INVALID_SALES_STATE'; end if;
  deposit:=nullif(p_state->>'deposit_cents','')::bigint;
  price:=nullif(p_product->>'price_cents','')::bigint;
  if deposit<0 or (price is not null and deposit>price) then raise exception 'INVALID_DEPOSIT'; end if;
  threshold:=coalesce((cfg->'sdr_rules'->>'hot_lead_percent')::numeric,30);
  if threshold<0 or threshold>100 then raise exception 'INVALID_HOT_LEAD_THRESHOLD'; end if;
  hot:=coalesce(price>0 and deposit::numeric*100>=price::numeric*threshold,false);
  financing_rule:=coalesce(cfg#>>'{sales,hot_lead_rule}'='deposit_30_and_financing_documents_v1',false);
  purchase:=coalesce(coalesce(nullif(p_state->>'transaction_mode','unknown'),p_state->>'intent')='buy',false);

  if financing_rule then
    for doc in select value from jsonb_array_elements(p_documents) loop
      if exists(select 1 from public.sales_documents d where d.tenant_id=p_tenant
          and d.event_id=(doc->>'event_id')::uuid and (d.lead_id is distinct from lead.id or d.verification_status='rejected'))
        or (p_session<>'initial' and not exists(select 1 from public.channel_events e
          join public.channel_events b on b.id::text=p_session and b.tenant_id=p_tenant
          where e.id=(doc->>'event_id')::uuid and e.created_at>b.created_at)) then
        raise exception 'DOCUMENT_SESSION_MISMATCH';
      end if;
    end loop;
    -- Only this session's persisted documents, plus the current turn; no personal data in state.
    select coalesce(jsonb_agg(d.extracted),'[]'::jsonb) into docs from public.sales_documents d
      where d.tenant_id=p_tenant and d.lead_id=lead.id and d.verification_status<>'rejected';
    docs:=docs || coalesce((select jsonb_agg(value->'extracted') from jsonb_array_elements(p_documents)),'[]'::jsonb);
    qualification:=public.magia_sales_financing_qualification(p_state,p_product,docs);
    hot:=purchase and qualification->>'status'='ready';
    p_state:=p_state-'financing_qualification';
    if purchase then p_state:=p_state||jsonb_build_object('financing_qualification',qualification); end if;
    -- A model registration request cannot bypass incomplete financial qualification.
    if purchase and qualification->>'status'<>'ready' then p_register:=false; end if;
  end if;

  stage:=p_stage;
  if p_register then
    if nullif(p_state->>'customer_name','') is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
    if p_state->>'intent'='buy' then
      if nullif(p_product->>'id','') is null or price is null then raise exception 'PRODUCT_REQUIRED'; end if;
      stage:=cfg->'sales'->'stage_keys'->>(case when hot then 'hot' else 'human' end);
    elsif p_state->>'intent'='sell' then
      stage:=cfg->'sales'->'stage_keys'->>'appraisal';
    else raise exception 'INVALID_INTEREST'; end if;
  end if;
  if financing_rule then
    if hot and stage in (cfg#>>'{sales,stage_keys,initial}',cfg#>>'{sales,stage_keys,qualifying}',
        cfg#>>'{sales,stage_keys,human}',cfg#>>'{sales,stage_keys,hot}') then
      stage:=cfg#>>'{sales,stage_keys,hot}';
    elsif not hot and stage=cfg#>>'{sales,stage_keys,hot}' then
      stage:=cfg#>>'{sales,stage_keys,qualifying}';
    end if;
  end if;
  if not (cfg->'sales'->'stages' ? stage) then raise exception 'INVALID_SALES_STAGE'; end if;
  insert into public.sales_leads(tenant_id,chat_id,session_id,stage_key,ai_locked,state,product,
    deposit_cents,hot,interest_registered,last_request)
  values(p_tenant,p_chat,p_session,stage,
    not coalesce((cfg->'sales'->'stages'->stage->>'allow_ai')::boolean,false),
    p_state,p_product,deposit,hot,p_register,p_request)
  on conflict(tenant_id,channel_type,chat_id,session_id) do update set
    stage_key=excluded.stage_key,ai_locked=excluded.ai_locked,state=excluded.state,
    product=excluded.product,deposit_cents=excluded.deposit_cents,hot=excluded.hot,
    interest_registered=sales_leads.interest_registered or excluded.interest_registered,
    last_request=excluded.last_request,revision=sales_leads.revision+1,updated_at=now()
  returning * into lead;
  for doc in select value from jsonb_array_elements(p_documents) loop
    if not exists(select 1 from public.channel_events e where e.id=(doc->>'event_id')::uuid
      and e.tenant_id=p_tenant and e.external_conversation_id=p_chat and e.channel_type='whatsapp'
      and e.direction='inbound') then raise exception 'DOCUMENT_SCOPE_MISMATCH'; end if;
    if length((doc->'extracted')::text)>5000 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
    insert into public.sales_documents(tenant_id,lead_id,event_id,extracted)
    values(p_tenant,lead.id,(doc->>'event_id')::uuid,doc->'extracted') on conflict do nothing;
  end loop;
  return to_jsonb(lead);
end $$;
revoke all on function public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
