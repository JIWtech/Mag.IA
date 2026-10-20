-- Migration: 20261019210000_sales_assignment_preserves_human_stage.sql
-- NÃO APLICAR sem autorização expressa. Arquivo para revisão (P0 19/10/2026).
-- Rollback EXATO: 20261019210000_sales_assignment_preserves_human_stage.rollback.sql
--   (definições ativas lidas de produção em 19/10/2026; md5 de pg_get_functiondef:
--    magia_sales_human_control=72c10076b95086cf996247d087533a84,
--    magia_sales_save=d7beeb57cebfd85ab4ef8379ea1b0337).
--
-- Duas dimensões, já existentes no schema, passam a ser respeitadas:
--   * estado/etapa comercial: sales_leads.stage_key (decidido pela EXT) e a
--     classificação em state.financing.temperature (+ espelho derivado `hot`);
--   * controle da conversa: sales_leads.ai_locked + evento conversation_assigned.
-- Nenhuma tabela/coluna nova.
--
-- 1) magia_sales_human_control (trigger AFTER INSERT em channel_events)
--    Antes: qualquer conversation_assigned/manual_reply/handoff_requested movia o
--    lead para stage_keys.human, sobrescrevendo sales_appraisal/financing/hot que o
--    CORE acabara de gravar pela decisão da EXT (o CORE grava a etapa e, em
--    seguida, registra a atribuição).
--    Agora: se a etapa atual é configurada como humana (allow_ai=false) e não
--    encerrada, ela é mantida e só o bloqueio é garantido. Etapas de IA continuam
--    indo para human; conversation_closed -> closed e resume_ai -> qualifying
--    inalterados. Mesma seleção de lead; a linha passa a ser travada (FOR UPDATE)
--    antes da leitura da etapa. A ordem de locks (fila -> lead) é a mesma de
--    magia_sales_save, evitando deadlock.
--
-- 2) magia_sales_save
--    A coluna `hot` só era calculada para deposit_and_financing_documents_v2
--    (documentos cpf/cnh/birth_date extraídos). Único tenant sales_v1 (Gênesis)
--    usa deposit_30_and_financing_documents_v1, avaliada pela EXT; `hot` ficava
--    sempre false. `hot` é um indicador DERIVADO/legado (o Kanban usa stage_key e
--    state.*.temperature; `hot` só é fallback quando não há etapa persistida).
--    Agora, para regra diferente da v2, `hot` espelha a classificação autorizada
--    pela EXT somente se: rule == sales.hot_lead_rule configurada, threshold
--    válido, preço>0, entrada*100 >= preço*sdr_rules.hot_lead_percent e, se o
--    critério financing_documents existir, documents_complete=true. Divergência
--    -> exceção explícita (não há sobrescrita silenciosa). O ramo v2, p_stage,
--    p_register, validações de turno/sessão/revisão/ai_locked, depósito e
--    documentos permanecem idênticos.
--    Nota: p_register=true pode substituir p_stage (ramo legado). O CORE envia
--    p_register=false para a Gênesis (decisão autoritativa da EXT); não alterado.
begin;
CREATE OR REPLACE FUNCTION public.magia_sales_human_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg jsonb; target text; session text; lead_id uuid; current_stage text;
begin
  if coalesce(new.ai_provider,'')='sales_operator' or new.direction is distinct from 'outbound'
    or coalesce(new.service,'') not in ('conversation_closed','conversation_assigned','manual_reply','handoff_requested','resume_ai')
    then return new; end if;
  select settings into cfg from public.tenant_settings where tenant_id=new.tenant_id;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' then return new; end if;
  target := cfg->'sales'->'stage_keys'->>(case when new.service='conversation_closed' then 'closed'
    when new.service='resume_ai' then 'qualifying' else 'human' end);
  perform 1 from public.conversation_turn_queue where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id for update;
  select coalesce((select id::text from public.channel_events where tenant_id=new.tenant_id
    and channel_type=new.channel_type and external_conversation_id=new.external_conversation_id
    and id<>new.id and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial') into session;
  -- Lock the lead row that the original statement would update (same selection).
  select id, stage_key into lead_id, current_stage from public.sales_leads where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id and session_id=session
    order by created_at desc limit 1 for update;
  if lead_id is null then return new; end if;
  -- Responsibility for the conversation is NOT the commercial stage. When the
  -- lead is already in a configured human-owned, non-closed stage (allow_ai=false,
  -- e.g. appraisal/financing/hot decided by the tenant extension), an assignment,
  -- manual reply or handoff request keeps that stage and only guarantees the lock.
  if new.service in ('conversation_assigned','manual_reply','handoff_requested')
    and current_stage is not null
    and (cfg->'sales'->'stages') ? current_stage
    and coalesce((cfg->'sales'->'stages'->current_stage->>'allow_ai')::boolean,false)=false
    and coalesce((cfg->'sales'->'stages'->current_stage->>'closed')::boolean,false)=false then
    target := current_stage;
  end if;
  update public.sales_leads set ai_locked=new.service<>'resume_ai',stage_key=target,
    revision=revision+1,updated_at=now()
  where id=lead_id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.magia_sales_save(p_tenant uuid, p_chat text, p_session text, p_token uuid, p_revision integer, p_request text, p_state jsonb, p_product jsonb, p_stage text, p_register boolean DEFAULT false, p_documents jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg jsonb; lead public.sales_leads%rowtype; q public.conversation_turn_queue%rowtype;
  stage text; deposit bigint; price bigint; threshold numeric; hot boolean := false; doc jsonb;
  hot_rule text; required_docs jsonb; docs_complete boolean := false;
  have_cpf boolean := false; have_cnh boolean := false; have_birth_date boolean := false;
begin
  select settings into cfg from public.tenant_settings where tenant_id=p_tenant;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' or cfg->>'ai_enabled' is distinct from 'true'
    then raise exception 'SALES_DISABLED'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase<>'sending' or q.boundary_id<>p_session
    then raise exception 'STALE_SALES_TURN'; end if;
  if coalesce((select id::text from public.channel_events where tenant_id=p_tenant and channel_type='whatsapp'
    and external_conversation_id=p_chat and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial')<>p_session then raise exception 'STALE_SALES_SESSION'; end if;
  select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=p_session for update;
  if found and (lead.revision<>p_revision or lead.ai_locked) then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if lead.id is null and p_revision<>0 then raise exception 'SALES_CONTROL_CHANGED'; end if;
  if jsonb_typeof(p_state)<>'object' or length(p_state::text)>12000 then raise exception 'INVALID_SALES_STATE'; end if;
  deposit:=nullif(p_state->>'deposit_cents','')::bigint;
  price:=nullif(p_product->>'price_cents','')::bigint;
  if deposit<0 or (price is not null and deposit>price) then raise exception 'INVALID_DEPOSIT'; end if;
  hot_rule:=cfg->'sales'->>'hot_lead_rule';
  threshold:=nullif(cfg->'sdr_rules'->>'hot_lead_percent','')::numeric;
  required_docs:=coalesce(cfg->'sales'->'required_financing_documents','[]'::jsonb);
  if hot_rule='deposit_and_financing_documents_v2' then
    if threshold is null or threshold<=0 or threshold>100 then raise exception 'INVALID_HOT_LEAD_THRESHOLD'; end if;
    if cfg->'sales'->>'collect_documents' is distinct from 'true'
      or jsonb_typeof(required_docs)<>'array' or jsonb_array_length(required_docs)=0
      or exists(select 1 from jsonb_array_elements_text(required_docs) as required(value)
        where required.value not in ('cpf','cnh','birth_date'))
      then raise exception 'INVALID_FINANCING_DOCUMENT_POLICY'; end if;
    select coalesce(bool_or(length(regexp_replace(coalesce(x->>'cpf',''),'\D','','g'))=11),false),
      coalesce(bool_or(length(regexp_replace(coalesce(x->>'cnh',''),'\D','','g'))=11),false),
      coalesce(bool_or(coalesce(x->>'birth_date','')~'^\d{4}-\d{2}-\d{2}$'),false)
      into have_cpf,have_cnh,have_birth_date
    from (select extracted x from public.sales_documents where lead_id=lead.id
      union all select value->'extracted' from jsonb_array_elements(p_documents)) docs;
    docs_complete:=(not (required_docs ? 'cpf') or have_cpf) and (not (required_docs ? 'cnh') or have_cnh)
      and (not (required_docs ? 'birth_date') or have_birth_date);
    hot:=coalesce(price>0 and deposit is not null and deposit::numeric*100>=price::numeric*threshold and docs_complete,false);
  elsif nullif(hot_rule,'') is not null then
    -- Any other configured rule is evaluated by the tenant extension (EXT is the
    -- commercial authority). `hot` is a DERIVED mirror of that authorised
    -- classification; the RPC only checks that it is bound to the configured
    -- rule and arithmetically consistent, and refuses it otherwise.
    if p_state->'financing'->>'temperature'='hot' then
      if p_state->'financing'->>'rule' is distinct from hot_rule then raise exception 'LEAD_CLASSIFICATION_RULE_MISMATCH'; end if;
      if threshold is null or threshold<=0 or threshold>100 then raise exception 'INVALID_HOT_LEAD_THRESHOLD'; end if;
      if price is null or price<=0 or deposit is null or deposit::numeric*100<price::numeric*threshold
        then raise exception 'LEAD_CLASSIFICATION_INCONSISTENT'; end if;
      if jsonb_typeof(p_state->'financing'->'criteria')='array' and (p_state->'financing'->'criteria') ? 'financing_documents'
        and p_state->'financing'->>'documents_complete' is distinct from 'true'
        then raise exception 'LEAD_CLASSIFICATION_INCONSISTENT'; end if;
      hot:=true;
    end if;
  end if;
  stage:=p_stage;
  if p_register then
    if nullif(p_state->>'customer_name','') is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
    if p_state->>'intent'='buy' then
      if nullif(p_product->>'id','') is null or price is null then raise exception 'PRODUCT_REQUIRED'; end if;
      stage:=cfg->'sales'->'stage_keys'->>(case when hot then 'hot' else 'qualifying' end);
    elsif p_state->>'intent'='sell' then stage:=cfg->'sales'->'stage_keys'->>'appraisal';
    else raise exception 'INVALID_INTEREST'; end if;
  end if;
  if not (cfg->'sales'->'stages' ? stage) then raise exception 'INVALID_SALES_STAGE'; end if;
  insert into public.sales_leads(tenant_id,chat_id,session_id,stage_key,ai_locked,state,product,deposit_cents,hot,interest_registered,last_request)
  values(p_tenant,p_chat,p_session,stage,not coalesce((cfg->'sales'->'stages'->stage->>'allow_ai')::boolean,false),
    p_state,p_product,deposit,hot,p_register,p_request)
  on conflict(tenant_id,channel_type,chat_id,session_id) do update set stage_key=excluded.stage_key,ai_locked=excluded.ai_locked,
    state=excluded.state,product=excluded.product,deposit_cents=excluded.deposit_cents,hot=excluded.hot,
    interest_registered=sales_leads.interest_registered or excluded.interest_registered,last_request=excluded.last_request,
    revision=sales_leads.revision+1,updated_at=now() returning * into lead;
  for doc in select value from jsonb_array_elements(p_documents) loop
    if not exists(select 1 from public.channel_events e where e.id=(doc->>'event_id')::uuid and e.tenant_id=p_tenant
      and e.external_conversation_id=p_chat and e.channel_type='whatsapp' and e.direction='inbound')
      then raise exception 'DOCUMENT_SCOPE_MISMATCH'; end if;
    if length((doc->'extracted')::text)>5000 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
    insert into public.sales_documents(tenant_id,lead_id,event_id,extracted)
      values(p_tenant,lead.id,(doc->>'event_id')::uuid,doc->'extracted') on conflict do nothing;
  end loop;
  return to_jsonb(lead);
end $function$;

revoke all on function public.magia_sales_human_control() from public,anon,authenticated;
revoke all on function public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
