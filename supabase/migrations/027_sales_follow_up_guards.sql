-- Requires 019_follow_up_jobs, 021, 025_sales_capability and 026 exclusions.
-- No tenant policy is enabled by this migration.
begin;
create or replace function public.magia_sales_followup_eligible(p_tenant uuid,p_chat text,p_anchor uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; lead public.sales_leads%rowtype; anchor public.channel_events%rowtype;
  boundary text; exclusion jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sales follow-up denied'; end if;
  select s.settings into cfg from public.tenant_settings s join public.tenants t on t.id=s.tenant_id
    where t.id=p_tenant and t.status='active' and t.deleted_at is null;
  if not found or cfg->>'conversation_capability' is distinct from 'sales_v1'
    or cfg->>'ai_enabled' is distinct from 'true' or cfg->>'follow_up_enabled' is distinct from 'true'
    or cfg#>>'{sales_follow_up,enabled}' is distinct from 'true'
    or cfg->>'contact_exclusion_enabled' is distinct from 'true' then return false; end if;
  exclusion:=public.magia_contact_exclusion_status(p_tenant,p_chat);
  if exclusion->>'blocked' is distinct from 'false' then return false; end if;
  select * into anchor from public.channel_events where id=p_anchor and tenant_id=p_tenant
    and channel_type='whatsapp' and external_conversation_id=p_chat;
  if not found or anchor.direction is distinct from 'outbound' or anchor.sender_type is distinct from 'assistant'
    or anchor.handoff is true or anchor.service is distinct from 'sales_qualification'
    or anchor.ai_provider is distinct from 'sales_core' then return false; end if;
  select coalesce((select e.id::text from public.channel_events e where e.tenant_id=p_tenant
    and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
    and (e.service='conversation_closed' or e.ai_provider in ('conversation_closed','conversation_reset'))
    order by e.created_at desc,e.id desc limit 1),'initial') into boundary;
  select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=boundary;
  if not found or lead.ai_locked is true or lead.interest_registered is true
    or lead.stage_key not in (coalesce(cfg#>>'{sales,stage_keys,initial}',''),coalesce(cfg#>>'{sales,stage_keys,qualifying}',''))
    or cfg#>>array['sales','stages',lead.stage_key,'allow_ai'] is distinct from 'true'
    or anchor.raw_payload->>'conversation_session_id' is distinct from boundary then return false; end if;
  if exists(select 1 from public.channel_events e where e.tenant_id=p_tenant and e.channel_type='whatsapp'
    and e.external_conversation_id=p_chat and (e.created_at,e.id)>(anchor.created_at,anchor.id)
    and ((e.direction='inbound' and e.sender_type='contact') or e.handoff is true
      or e.sender_type='human' or e.service in ('conversation_closed','conversation_assigned','resume_ai')
      or (e.direction='outbound' and e.ai_provider is distinct from 'configured_follow_up'))) then return false; end if;
  return true;
end $$;

create or replace function public.magia_guard_sales_followup_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.tenant_settings s where s.tenant_id=new.tenant_id
    and s.settings->>'conversation_capability'='sales_v1') then
    if new.channel_type<>'whatsapp' or not public.magia_sales_followup_eligible(
      new.tenant_id,new.external_conversation_id,new.anchor_event_id) then return null; end if;
  end if;
  return new;
end $$;
drop trigger if exists magia_guard_sales_followup_insert on public.follow_up_jobs;
create trigger magia_guard_sales_followup_insert before insert on public.follow_up_jobs
for each row execute function public.magia_guard_sales_followup_insert();

create or replace function public.magia_validate_sales_followup(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.follow_up_jobs%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sales follow-up validation denied'; end if;
  select * into job from public.follow_up_jobs where id=p_job and lease_token=p_lease
    and status='processing' and locked_until>clock_timestamp();
  if not found then return jsonb_build_object('allowed',false,'reason','lease_invalid'); end if;
  if not exists(select 1 from public.follow_up_policies p where p.id=job.policy_id and p.tenant_id=job.tenant_id
    and p.channel_type=job.channel_type and p.enabled) then
    return jsonb_build_object('allowed',false,'reason','policy_disabled'); end if;
  return jsonb_build_object('allowed',public.magia_sales_followup_eligible(job.tenant_id,
    job.external_conversation_id,job.anchor_event_id),'reason','sales_eligibility');
end $$;
revoke all on function public.magia_sales_followup_eligible(uuid,text,uuid),
  public.magia_guard_sales_followup_insert(),public.magia_validate_sales_followup(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.magia_sales_followup_eligible(uuid,text,uuid),
  public.magia_validate_sales_followup(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
