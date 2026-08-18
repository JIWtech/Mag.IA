-- Schema MVP multi-tenant para plataforma generalista de automacao, atendimento e IA.
-- Execute no Supabase SQL Editor quando formos iniciar a integracao real.

create extension if not exists "pgcrypto";

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  industry text,
  plan text default 'mvp',
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists tenant_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  timezone text default 'America/Sao_Paulo',
  business_hours jsonb default '{}'::jsonb,
  fallback_message text,
  handoff_message text,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null,
  name text not null,
  external_id text,
  status text default 'pending',
  credentials_ref text,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, type, external_id)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  name text not null,
  email text,
  role text default 'agent',
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text,
  phone text,
  email text,
  external_handle text,
  source_channel text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create index if not exists contacts_tenant_phone_idx on contacts (tenant_id, phone);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  channel_id uuid references channels(id) on delete set null,
  status text default 'ia_ativa',
  stage text,
  assigned_user_id uuid references users(id) on delete set null,
  assigned_team_id uuid references teams(id) on delete set null,
  ai_paused boolean default false,
  last_message_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create index if not exists conversations_tenant_status_idx on conversations (tenant_id, status);
create index if not exists conversations_tenant_last_message_idx on conversations (tenant_id, last_message_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  channel_id uuid references channels(id) on delete set null,
  direction text not null,
  sender_type text not null,
  content_type text default 'text',
  content text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists messages_conversation_created_idx on messages (conversation_id, created_at);

create table if not exists conversation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  event_type text not null,
  description text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  color text default '#667085',
  created_at timestamptz default now(),
  unique (tenant_id, name)
);

create table if not exists conversation_tags (
  conversation_id uuid not null references conversations(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (conversation_id, tag_id)
);

create table if not exists kanban_boards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  is_default boolean default false,
  created_at timestamptz default now()
);

create table if not exists kanban_columns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id uuid not null references kanban_boards(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  automation_key text,
  created_at timestamptz default now()
);

create table if not exists kanban_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id uuid not null references kanban_boards(id) on delete cascade,
  column_id uuid not null references kanban_columns(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  subtitle text,
  value numeric default 0,
  position integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists funnels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  currency text default 'BRL',
  is_default boolean default false,
  created_at timestamptz default now()
);

create table if not exists funnel_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid not null references funnels(id) on delete cascade,
  name text not null,
  probability numeric default 0,
  position integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funnel_id uuid references funnels(id) on delete set null,
  stage_id uuid references funnel_stages(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  value numeric default 0,
  status text default 'open',
  assigned_user_id uuid references users(id) on delete set null,
  expected_close_at date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  conditions jsonb default '{}'::jsonb,
  actions jsonb default '[]'::jsonb,
  priority integer default 100,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists automation_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_id uuid references automation_rules(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  status text not null,
  input jsonb default '{}'::jsonb,
  output jsonb default '{}'::jsonb,
  error text,
  created_at timestamptz default now()
);

create table if not exists ai_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  provider text default 'gemini',
  model text,
  temperature numeric default 0.4,
  max_tokens integer default 650,
  active_prompt_version integer default 1,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ai_agent_id uuid not null references ai_agents(id) on delete cascade,
  version integer not null,
  prompt text not null,
  guardrails jsonb default '[]'::jsonb,
  tools jsonb default '[]'::jsonb,
  active boolean default false,
  created_at timestamptz default now(),
  unique (ai_agent_id, version)
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text default 'scheduled',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

insert into tenants (slug, name, industry, plan)
values
  ('avvento', 'Avvento Auto', 'Automotivo', 'Piloto'),
  ('teste', 'Tenant Teste', 'Generalista', 'MVP')
on conflict (slug) do nothing;
