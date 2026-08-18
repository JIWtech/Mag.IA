-- Event log canonico para capturar mensagens reais antes da materializacao
-- completa em contacts/conversations/messages.

create table if not exists channel_events (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null,
  channel_type text not null,
  external_conversation_id text,
  external_message_id text,
  direction text not null,
  contact_name text,
  contact_handle text,
  message_text text,
  service text,
  stage text,
  handoff boolean default false,
  response_text text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists channel_events_tenant_created_idx
  on channel_events (tenant_slug, created_at desc);

create index if not exists channel_events_external_conversation_idx
  on channel_events (tenant_slug, channel_type, external_conversation_id);

create unique index if not exists channel_events_external_message_unique
  on channel_events (tenant_slug, channel_type, external_message_id)
  where external_message_id is not null;

alter table channel_events enable row level security;

-- n8n deve usar service role no Supabase, ignorando RLS.
-- Policies de leitura para clientes serao adicionadas junto com auth real.
