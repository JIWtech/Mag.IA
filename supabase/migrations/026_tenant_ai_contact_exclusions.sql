-- Compatible with the private VCF import already applied. Does not import/delete contacts.
begin;
create table if not exists public.tenant_ai_excluded_contacts (
  tenant_id uuid not null references public.tenants(id),
  phone text not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);
alter table public.tenant_ai_excluded_contacts enable row level security;
revoke all on public.tenant_ai_excluded_contacts from public,anon,authenticated;
grant all on public.tenant_ai_excluded_contacts to service_role;

create or replace function public.magia_exclusion_phone_candidates(p_value text)
returns text[] language plpgsql immutable set search_path=public,pg_temp as $$
declare p text; national text; candidates text[];
begin
  if p_value is null or p_value like '%@lid' or
    (p_value like '%@%' and p_value not like '%@s.whatsapp.net' and p_value not like '%@c.us') then return '{}'; end if;
  p:=regexp_replace(split_part(split_part(trim(p_value),'@',1),':',1),'[^0-9]','','g');
  if p !~ '^[1-9][0-9]{9,14}$' then return '{}'; end if;
  if length(p) in (10,11) and p_value not like '%@%' and left(trim(p_value),1)<>'+' then p:='55'||p; end if;
  candidates:=array[p];
  if left(p,2)='55' and length(p) in (12,13) then
    national:=substr(p,3);
    candidates:=candidates||national;
    -- Only the Brazilian mobile ninth digit is optional, never arbitrary suffix matching.
    if length(p)=13 and substr(p,5,1)='9' and substr(p,6,1) ~ '[6-9]' then
      candidates:=candidates||('55'||substr(national,1,2)||substr(national,4))
        ||(substr(national,1,2)||substr(national,4));
    elsif length(p)=12 and substr(p,5,1) ~ '[6-9]' then
      candidates:=candidates||('55'||substr(national,1,2)||'9'||substr(national,3))
        ||(substr(national,1,2)||'9'||substr(national,3));
    end if;
  end if;
  return candidates;
end $$;

create or replace function public.magia_contact_exclusion_status(p_tenant uuid,p_chat text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; phone text:=p_chat; candidates text[]; blocked boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Contact exclusion lookup denied'; end if;
  select s.settings into cfg from public.tenant_settings s join public.tenants t on t.id=s.tenant_id
    where t.id=p_tenant and t.status='active' and t.deleted_at is null;
  if not found then raise exception 'Active tenant configuration missing'; end if;
  if coalesce(cfg->>'contact_exclusion_enabled','false')<>'true' then
    return jsonb_build_object('enabled',false,'blocked',false,'reason','disabled');
  end if;
  -- Empty/missing lists must not silently re-enable the bot for an opted-in tenant.
  if not exists(select 1 from public.tenant_ai_excluded_contacts where tenant_id=p_tenant) then
    return jsonb_build_object('enabled',true,'blocked',true,'reason','exclusion_list_empty');
  end if;
  if p_chat like '%@lid' then
    select e.raw_payload->>'exclusion_phone' into phone from public.channel_events e
      where e.tenant_id=p_tenant and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
        and e.direction='inbound' and e.sender_type='contact'
        and e.raw_payload->>'exclusion_phone' ~ '^[1-9][0-9]{9,14}@s[.]whatsapp[.]net$'
      order by e.created_at desc,e.id desc limit 1;
  end if;
  candidates:=public.magia_exclusion_phone_candidates(phone);
  if cardinality(candidates)=0 then
    return jsonb_build_object('enabled',true,'blocked',true,'reason','contact_identity_unresolved');
  end if;
  select exists(select 1 from public.tenant_ai_excluded_contacts e
    where e.tenant_id=p_tenant and e.phone=any(candidates)) into blocked;
  return jsonb_build_object('enabled',true,'blocked',blocked,
    'reason',case when blocked then 'contact_excluded' else 'not_excluded' end,
    'resolved_phone',case when p_chat like '%@lid' then phone else null end);
end $$;
revoke all on function public.magia_exclusion_phone_candidates(text),
  public.magia_contact_exclusion_status(uuid,text) from public,anon,authenticated;
grant execute on function public.magia_exclusion_phone_candidates(text),
  public.magia_contact_exclusion_status(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
