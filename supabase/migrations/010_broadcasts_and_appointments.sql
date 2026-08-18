-- Disparos e agendamentos multi-tenant.
-- Execute apos 008_auth_multi_tenant_policies.sql.

create table if not exists broadcast_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text,
  channel_type text not null default 'telegram'
    check (channel_type in ('telegram', 'whatsapp', 'instagram', 'instagram_direct', 'webchat')),
  external_conversation_id text,
  phone text,
  email text,
  source text default 'manual',
  tags text[] default '{}'::text[],
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, channel_type, external_conversation_id)
);

create index if not exists broadcast_contacts_tenant_channel_idx
  on broadcast_contacts (tenant_id, channel_type, created_at desc);

create table if not exists broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  channel_type text not null default 'telegram'
    check (channel_type in ('telegram', 'whatsapp', 'instagram', 'instagram_direct', 'webchat')),
  message_text text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'partial_error', 'failed', 'cancelled')),
  total_recipients integer default 0,
  sent_count integer default 0,
  failed_count integer default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  sent_at timestamptz
);

create index if not exists broadcast_campaigns_tenant_created_idx
  on broadcast_campaigns (tenant_id, created_at desc);

create table if not exists broadcast_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  campaign_id uuid not null references broadcast_campaigns(id) on delete cascade,
  contact_id uuid references broadcast_contacts(id) on delete set null,
  channel_type text not null default 'telegram',
  external_conversation_id text not null,
  contact_name text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  external_message_id text,
  sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists broadcast_recipients_campaign_idx
  on broadcast_campaign_recipients (campaign_id, status);

create index if not exists broadcast_recipients_tenant_created_idx
  on broadcast_campaign_recipients (tenant_id, created_at desc);

alter table appointments
  add column if not exists channel_type text default 'manual',
  add column if not exists external_conversation_id text,
  add column if not exists contact_name text,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

create index if not exists appointments_tenant_starts_idx
  on appointments (tenant_id, starts_at);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'broadcast_campaigns'
  ) then
    alter publication supabase_realtime add table public.broadcast_campaigns;
  end if;
end $$;

alter table broadcast_contacts enable row level security;
alter table broadcast_campaigns enable row level security;
alter table broadcast_campaign_recipients enable row level security;
alter table appointments enable row level security;

drop policy if exists "broadcast_contacts_member_select" on broadcast_contacts;
create policy "broadcast_contacts_member_select"
on broadcast_contacts
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "broadcast_contacts_member_insert" on broadcast_contacts;
create policy "broadcast_contacts_member_insert"
on broadcast_contacts
for insert
to authenticated
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "broadcast_contacts_member_update" on broadcast_contacts;
create policy "broadcast_contacts_member_update"
on broadcast_contacts
for update
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
)
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_contacts.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "broadcast_campaigns_member_select" on broadcast_campaigns;
create policy "broadcast_campaigns_member_select"
on broadcast_campaigns
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "broadcast_campaigns_member_insert" on broadcast_campaigns;
create policy "broadcast_campaigns_member_insert"
on broadcast_campaigns
for insert
to authenticated
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "broadcast_campaigns_member_update" on broadcast_campaigns;
create policy "broadcast_campaigns_member_update"
on broadcast_campaigns
for update
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
)
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaigns.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "broadcast_recipients_member_select" on broadcast_campaign_recipients;
create policy "broadcast_recipients_member_select"
on broadcast_campaign_recipients
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "broadcast_recipients_member_insert" on broadcast_campaign_recipients;
create policy "broadcast_recipients_member_insert"
on broadcast_campaign_recipients
for insert
to authenticated
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "broadcast_recipients_member_update" on broadcast_campaign_recipients;
create policy "broadcast_recipients_member_update"
on broadcast_campaign_recipients
for update
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
)
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = broadcast_campaign_recipients.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "appointments_member_select" on appointments;
create policy "appointments_member_select"
on appointments
for select
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "appointments_member_insert" on appointments;
create policy "appointments_member_insert"
on appointments
for insert
to authenticated
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

drop policy if exists "appointments_member_update" on appointments;
create policy "appointments_member_update"
on appointments
for update
to authenticated
using (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
)
with check (
  exists (
    select 1 from tenant_members tm
    where tm.tenant_id = appointments.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  )
);

notify pgrst, 'reload schema';
