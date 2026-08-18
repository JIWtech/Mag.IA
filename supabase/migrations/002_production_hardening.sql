-- Hardening inicial para MVP multi-tenant da Mag.IA.
-- Execute apos 001_core_multi_tenant.sql.

alter table channels
  add column if not exists webhook_path text,
  add column if not exists bot_username text;

alter table conversations
  add column if not exists external_conversation_id text,
  add column if not exists source_channel text;

alter table messages
  add column if not exists external_message_id text;

alter table kanban_columns
  add constraint kanban_columns_unique_name unique (tenant_id, board_id, name);

alter table funnel_stages
  add constraint funnel_stages_unique_name unique (tenant_id, funnel_id, name);

alter table automation_rules
  add constraint automation_rules_unique_name unique (tenant_id, name);

create unique index if not exists channels_tenant_type_external_unique
  on channels (tenant_id, type, external_id)
  where external_id is not null;

create unique index if not exists conversations_tenant_channel_external_unique
  on conversations (tenant_id, channel_id, external_conversation_id)
  where external_conversation_id is not null;

create unique index if not exists messages_tenant_external_unique
  on messages (tenant_id, channel_id, external_message_id)
  where external_message_id is not null;

create index if not exists contacts_tenant_external_handle_idx
  on contacts (tenant_id, external_handle);

create index if not exists messages_tenant_created_idx
  on messages (tenant_id, created_at desc);

create index if not exists conversation_events_tenant_created_idx
  on conversation_events (tenant_id, created_at desc);

-- RLS fica preparado, mas policies finais dependem de auth/app roles.
alter table tenants enable row level security;
alter table tenant_settings enable row level security;
alter table channels enable row level security;
alter table teams enable row level security;
alter table users enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table conversation_events enable row level security;
alter table tags enable row level security;
alter table conversation_tags enable row level security;
alter table kanban_boards enable row level security;
alter table kanban_columns enable row level security;
alter table kanban_cards enable row level security;
alter table funnels enable row level security;
alter table funnel_stages enable row level security;
alter table opportunities enable row level security;
alter table automation_rules enable row level security;
alter table automation_executions enable row level security;
alter table ai_agents enable row level security;
alter table ai_prompt_versions enable row level security;
alter table appointments enable row level security;
alter table audit_logs enable row level security;

-- Durante a fase n8n service-role, o n8n usa chave de servico e ignora RLS.
-- Antes de liberar login real para clientes, criar tabela tenant_members e policies por auth.uid().
