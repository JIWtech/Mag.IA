-- Watermarks de leitura por usuario e conversa.
-- O marcador nunca pertence ao fluxo de automacao: e somente estado de UI,
-- isolado por tenant e por usuario autenticado.
begin;

create table if not exists public.conversation_reads (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_type text not null check (nullif(trim(channel_type), '') is not null),
  external_conversation_id text not null check (nullif(trim(external_conversation_id), '') is not null),
  last_read_event_id uuid references public.channel_events(id) on delete set null,
  last_read_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, channel_type, external_conversation_id)
);

comment on table public.conversation_reads is
  'Watermark individual de leitura das conversas, usado exclusivamente pela interface.';

alter table public.conversation_reads enable row level security;

drop policy if exists conversation_reads_select_own_member on public.conversation_reads;
create policy conversation_reads_select_own_member
on public.conversation_reads
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants tenant
    join public.tenant_members member on member.tenant_id = tenant.id
    where tenant.id = conversation_reads.tenant_id
      and tenant.status = 'active'
      and tenant.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
);

-- A RPC usa a sessao autenticada normal; as policies tambem protegem qualquer
-- acesso direto e nunca aceitam user_id diferente de auth.uid().
drop policy if exists conversation_reads_insert_own_member on public.conversation_reads;
create policy conversation_reads_insert_own_member
on public.conversation_reads
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants tenant
    join public.tenant_members member on member.tenant_id = tenant.id
    where tenant.id = conversation_reads.tenant_id
      and tenant.status = 'active'
      and tenant.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
);

drop policy if exists conversation_reads_update_own_member on public.conversation_reads;
create policy conversation_reads_update_own_member
on public.conversation_reads
for update
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants tenant
    join public.tenant_members member on member.tenant_id = tenant.id
    where tenant.id = conversation_reads.tenant_id
      and tenant.status = 'active'
      and tenant.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.tenants tenant
    join public.tenant_members member on member.tenant_id = tenant.id
    where tenant.id = conversation_reads.tenant_id
      and tenant.status = 'active'
      and tenant.deleted_at is null
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  )
);

revoke all on table public.conversation_reads from anon, authenticated;
grant select, insert, update on table public.conversation_reads to authenticated;

create or replace function public.conversation_reads_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversation_reads_set_updated_at on public.conversation_reads;
create trigger conversation_reads_set_updated_at
before update on public.conversation_reads
for each row execute function public.conversation_reads_set_updated_at();

-- A funcao deriva user_id de auth.uid(), exige membership ativo e confirma que
-- o evento pertence ao tenant e a conversa informados antes de gravar o watermark.
create or replace function public.mark_conversation_read(
  p_tenant_id uuid,
  p_channel_type text,
  p_external_conversation_id text,
  p_last_read_event_id uuid
)
returns public.conversation_reads
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_slug text;
  v_event_at timestamptz;
  v_marker public.conversation_reads;
  v_channel_type text := lower(trim(coalesce(p_channel_type, '')));
  v_external_conversation_id text := lower(trim(coalesce(p_external_conversation_id, '')));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_tenant_id is null or p_last_read_event_id is null
    or v_channel_type = '' or v_external_conversation_id = '' then
    raise exception 'Invalid conversation read marker';
  end if;

  select tenant.slug into v_tenant_slug
  from public.tenants tenant
  join public.tenant_members member on member.tenant_id = tenant.id
  where tenant.id = p_tenant_id
    and tenant.status = 'active'
    and tenant.deleted_at is null
    and member.user_id = v_user_id
    and member.status = 'active';

  if v_tenant_slug is null then
    raise exception 'Tenant access denied';
  end if;

  select event.created_at into v_event_at
  from public.channel_events event
  where event.id = p_last_read_event_id
    and event.tenant_slug = v_tenant_slug
    and (event.tenant_id is null or event.tenant_id = p_tenant_id)
    and lower(trim(coalesce(event.channel_type, ''))) = v_channel_type
    and (
      case
        when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
          and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@s.whatsapp.net'
          then nullif(regexp_replace(split_part(lower(trim(event.external_conversation_id)), '@', 1), '\D', '', 'g'), '') || '@s.whatsapp.net'
        when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
          and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@g.us'
          then lower(trim(event.external_conversation_id))
        when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
          and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@broadcast'
          then lower(trim(event.external_conversation_id))
        when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
          and regexp_replace(coalesce(event.external_conversation_id, ''), '\D', '', 'g') ~ '^[0-9]{10,15}$'
          then regexp_replace(event.external_conversation_id, '\D', '', 'g') || '@s.whatsapp.net'
        else lower(trim(coalesce(event.external_conversation_id, '')))
      end
    ) = v_external_conversation_id;

  if v_event_at is null then
    raise exception 'Conversation event not found for this tenant';
  end if;

  insert into public.conversation_reads (
    tenant_id,
    user_id,
    channel_type,
    external_conversation_id,
    last_read_event_id,
    last_read_at
  ) values (
    p_tenant_id,
    v_user_id,
    v_channel_type,
    v_external_conversation_id,
    p_last_read_event_id,
    v_event_at
  )
  on conflict (tenant_id, user_id, channel_type, external_conversation_id)
  do update set
    last_read_event_id = excluded.last_read_event_id,
    last_read_at = excluded.last_read_at
  where public.conversation_reads.last_read_at < excluded.last_read_at
    or (
      public.conversation_reads.last_read_at = excluded.last_read_at
      and public.conversation_reads.last_read_event_id is distinct from excluded.last_read_event_id
    )
  returning * into v_marker;

  if v_marker.tenant_id is null then
    select * into v_marker
    from public.conversation_reads
    where tenant_id = p_tenant_id
      and user_id = v_user_id
      and channel_type = v_channel_type
      and external_conversation_id = v_external_conversation_id;
  end if;

  return v_marker;
end;
$$;

revoke all on function public.mark_conversation_read(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.mark_conversation_read(uuid, text, text, uuid) to authenticated;

-- Nao exibe historico como novo logo apos o deploy: cada membro ativo inicia
-- com o ultimo evento conhecido de cada conversa como watermark.
with normalized_events as (
  select
    tenant.id as tenant_id,
    case
      when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp' then 'whatsapp'
      else lower(trim(coalesce(event.channel_type, '')))
    end as channel_type,
    case
      when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
        and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@s.whatsapp.net'
        then nullif(regexp_replace(split_part(lower(trim(event.external_conversation_id)), '@', 1), '\D', '', 'g'), '') || '@s.whatsapp.net'
      when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
        and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@g.us'
        then lower(trim(event.external_conversation_id))
      when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
        and lower(trim(coalesce(event.external_conversation_id, ''))) like '%@broadcast'
        then lower(trim(event.external_conversation_id))
      when lower(trim(coalesce(event.channel_type, ''))) = 'whatsapp'
        and regexp_replace(coalesce(event.external_conversation_id, ''), '\D', '', 'g') ~ '^[0-9]{10,15}$'
        then regexp_replace(event.external_conversation_id, '\D', '', 'g') || '@s.whatsapp.net'
      else lower(trim(coalesce(event.external_conversation_id, '')))
    end as external_conversation_id,
    event.id as last_read_event_id,
    event.created_at as last_read_at
  from public.channel_events event
  join public.tenants tenant on tenant.slug = event.tenant_slug
  where tenant.status = 'active'
    and tenant.deleted_at is null
    and (event.tenant_id is null or event.tenant_id = tenant.id)
    and event.created_at is not null
    and nullif(trim(coalesce(event.channel_type, '')), '') is not null
    and nullif(trim(coalesce(event.external_conversation_id, '')), '') is not null
), latest_events as (
  select distinct on (tenant_id, channel_type, external_conversation_id)
    tenant_id,
    channel_type,
    external_conversation_id,
    last_read_event_id,
    last_read_at
  from normalized_events
  where external_conversation_id <> ''
  order by tenant_id, channel_type, external_conversation_id, last_read_at desc, last_read_event_id desc
)
insert into public.conversation_reads (
  tenant_id,
  user_id,
  channel_type,
  external_conversation_id,
  last_read_event_id,
  last_read_at
)
select
  latest.tenant_id,
  member.user_id,
  latest.channel_type,
  latest.external_conversation_id,
  latest.last_read_event_id,
  latest.last_read_at
from latest_events latest
join public.tenant_members member on member.tenant_id = latest.tenant_id
where member.status = 'active'
on conflict (tenant_id, user_id, channel_type, external_conversation_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_reads'
  ) then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
