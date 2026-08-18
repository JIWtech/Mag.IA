-- Mag.IA - Setup Supabase do piloto JIW
-- Como usar:
-- 1. Abra este arquivo.
-- 2. Copie TODO o conteudo.
-- 3. Cole no Supabase SQL Editor.
-- 4. Clique em Run.

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
  webhook_path text,
  bot_username text,
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

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  channel_id uuid references channels(id) on delete set null,
  status text default 'ia_ativa',
  stage text,
  external_conversation_id text,
  source_channel text,
  assigned_user_id uuid references users(id) on delete set null,
  assigned_team_id uuid references teams(id) on delete set null,
  ai_paused boolean default false,
  last_message_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

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
  external_message_id text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

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

create index if not exists contacts_tenant_phone_idx on contacts (tenant_id, phone);
create index if not exists contacts_tenant_external_handle_idx on contacts (tenant_id, external_handle);
create index if not exists conversations_tenant_status_idx on conversations (tenant_id, status);
create index if not exists conversations_tenant_last_message_idx on conversations (tenant_id, last_message_at desc);
create index if not exists messages_conversation_created_idx on messages (conversation_id, created_at);
create index if not exists messages_tenant_created_idx on messages (tenant_id, created_at desc);
create index if not exists conversation_events_tenant_created_idx on conversation_events (tenant_id, created_at desc);
create index if not exists channel_events_tenant_created_idx on channel_events (tenant_slug, created_at desc);
create index if not exists channel_events_external_conversation_idx on channel_events (tenant_slug, channel_type, external_conversation_id);

create unique index if not exists channels_tenant_type_external_unique
  on channels (tenant_id, type, external_id)
  where external_id is not null;

create unique index if not exists conversations_tenant_channel_external_unique
  on conversations (tenant_id, channel_id, external_conversation_id)
  where external_conversation_id is not null;

create unique index if not exists messages_tenant_external_unique
  on messages (tenant_id, channel_id, external_message_id)
  where external_message_id is not null;

create unique index if not exists channel_events_external_message_unique
  on channel_events (tenant_slug, channel_type, external_message_id)
  where external_message_id is not null;

create unique index if not exists tenant_settings_tenant_unique on tenant_settings (tenant_id);
create unique index if not exists kanban_boards_tenant_name_unique on kanban_boards (tenant_id, name);
create unique index if not exists kanban_columns_tenant_board_name_unique on kanban_columns (tenant_id, board_id, name);
create unique index if not exists funnels_tenant_name_unique on funnels (tenant_id, name);
create unique index if not exists funnel_stages_tenant_funnel_name_unique on funnel_stages (tenant_id, funnel_id, name);
create unique index if not exists automation_rules_tenant_name_unique on automation_rules (tenant_id, name);
create unique index if not exists ai_agents_tenant_name_unique on ai_agents (tenant_id, name);

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
alter table channel_events enable row level security;

insert into tenants (slug, name, industry, plan, status)
values ('jiw', 'JIW - Solucoes tecnologicas', 'Tecnologia e servicos digitais', 'Piloto', 'active')
on conflict (slug) do update
set name = excluded.name,
    industry = excluded.industry,
    plan = excluded.plan,
    status = excluded.status,
    updated_at = now();

insert into tenant_settings (tenant_id, timezone, business_hours, fallback_message, handoff_message, settings)
select
  t.id,
  'America/Sao_Paulo',
  '{"monday":["09:00","18:00"],"tuesday":["09:00","18:00"],"wednesday":["09:00","18:00"],"thursday":["09:00","18:00"],"friday":["09:00","18:00"]}'::jsonb,
  'Nao consegui relacionar sua mensagem aos servicos da JIW. Posso ajudar com software, suporte de TI, trafego pago, social media, sites, automacoes ou consultoria digital?',
  'Vou encaminhar seu atendimento para um especialista da JIW continuar com voce.',
  '{"language":"pt-BR","tone":"consultivo, objetivo e profissional","primary_channel":"telegram","service_categories":["software_house","suporte_ti","trafego_pago","social_media","sites_landing_pages","automacoes","consultoria_digital"]}'::jsonb
from tenants t
where t.slug = 'jiw'
on conflict (tenant_id) do update
set timezone = excluded.timezone,
    business_hours = excluded.business_hours,
    fallback_message = excluded.fallback_message,
    handoff_message = excluded.handoff_message,
    settings = excluded.settings,
    updated_at = now();

insert into channels (tenant_id, type, name, external_id, status, webhook_path, bot_username, config)
select
  t.id,
  'telegram',
  'Bot Telegram JIW',
  'jiwtech_bot',
  'connected',
  'telegram-jiw-real',
  '@jiwtech_bot',
  '{"webhook_path":"telegram-jiw-real","bot_username":"@jiwtech_bot","botfather_pending":false}'::jsonb
from tenants t
where t.slug = 'jiw'
on conflict (tenant_id, type, external_id) do update
set name = excluded.name,
    status = excluded.status,
    webhook_path = excluded.webhook_path,
    bot_username = excluded.bot_username,
    config = excluded.config,
    updated_at = now();

insert into ai_agents (tenant_id, name, provider, model, temperature, max_tokens, active_prompt_version, settings)
select
  t.id,
  'Assistente JIW',
  'gemini',
  'gemini-2.5-flash',
  0.35,
  700,
  1,
  '{"handoff_keywords":["humano","atendente","especialista","orcamento","proposta","contrato","reuniao"],"lead_fields":["nome","empresa","servico_interesse","urgencia","contato"]}'::jsonb
from tenants t
where t.slug = 'jiw'
on conflict (tenant_id, name) do update
set provider = excluded.provider,
    model = excluded.model,
    temperature = excluded.temperature,
    max_tokens = excluded.max_tokens,
    active_prompt_version = excluded.active_prompt_version,
    settings = excluded.settings,
    updated_at = now();

insert into ai_prompt_versions (tenant_id, ai_agent_id, version, prompt, guardrails, tools, active)
select
  a.tenant_id,
  a.id,
  1,
  'Voce e o assistente da JIW - Solucoes tecnologicas. A JIW atende empresas com desenvolvimento de sistemas, sites, landing pages, automacoes, suporte de TI, infraestrutura, trafego pago, social media e consultoria digital. Seu papel e entender a necessidade do contato, qualificar o servico desejado, identificar urgencia, coletar nome/empresa/contato e encaminhar para especialista quando houver pedido de orcamento, proposta, suporte critico ou atendimento humano. Responda de forma objetiva, profissional e consultiva. Nao invente valores, prazos fechados ou garantias de resultado. Se o assunto fugir dos servicos digitais, informe que nao compete ao atendimento da JIW e reformule a pergunta para o contexto correto.',
  '["Nao prometer resultado garantido em trafego pago ou social media.","Nao informar preco fechado sem briefing.","Encaminhar para humano em orcamento, contrato, urgencia tecnica ou proposta.","Coletar dados minimos antes de encaminhar.","Manter foco em tecnologia, suporte de TI e servicos digitais."]'::jsonb,
  '["criar_lead","classificar_servico","mover_kanban","solicitar_humano","criar_oportunidade"]'::jsonb,
  true
from ai_agents a
join tenants t on t.id = a.tenant_id
where t.slug = 'jiw' and a.name = 'Assistente JIW'
on conflict (ai_agent_id, version) do update
set prompt = excluded.prompt,
    guardrails = excluded.guardrails,
    tools = excluded.tools,
    active = excluded.active;

insert into kanban_boards (tenant_id, name, is_default)
select id, 'Atendimento JIW', true
from tenants
where slug = 'jiw'
on conflict (tenant_id, name) do update
set is_default = excluded.is_default;

insert into kanban_columns (tenant_id, board_id, name, position, automation_key)
select b.tenant_id, b.id, c.name, c.position, c.automation_key
from kanban_boards b
join tenants t on t.id = b.tenant_id
cross join (
  values
    ('Novo contato', 1, 'novo_contato'),
    ('Qualificacao', 2, 'qualificacao'),
    ('Briefing necessario', 3, 'briefing'),
    ('Orcamento solicitado', 4, 'orcamento'),
    ('Suporte tecnico', 5, 'suporte'),
    ('Atendimento humano', 6, 'humano'),
    ('Fechado', 7, 'fechado')
) as c(name, position, automation_key)
where t.slug = 'jiw' and b.name = 'Atendimento JIW'
on conflict (tenant_id, board_id, name) do update
set position = excluded.position,
    automation_key = excluded.automation_key;

insert into funnels (tenant_id, name, currency, is_default)
select id, 'Funil Comercial JIW', 'BRL', true
from tenants
where slug = 'jiw'
on conflict (tenant_id, name) do update
set currency = excluded.currency,
    is_default = excluded.is_default;

insert into funnel_stages (tenant_id, funnel_id, name, probability, position)
select f.tenant_id, f.id, s.name, s.probability, s.position
from funnels f
join tenants t on t.id = f.tenant_id
cross join (
  values
    ('Lead recebido', 10, 1),
    ('Diagnostico', 25, 2),
    ('Proposta', 55, 3),
    ('Negociacao', 75, 4),
    ('Cliente fechado', 100, 5)
) as s(name, probability, position)
where t.slug = 'jiw' and f.name = 'Funil Comercial JIW'
on conflict (tenant_id, funnel_id, name) do update
set probability = excluded.probability,
    position = excluded.position;

insert into automation_rules (tenant_id, name, trigger_type, conditions, actions, priority, active)
select t.id, r.name, r.trigger_type, r.conditions::jsonb, r.actions::jsonb, r.priority, true
from tenants t
cross join (
  values
    ('Pedido de orcamento', 'keyword_or_intent', '{"keywords":["orcamento","proposta","quanto custa","valor","preco"]}', '["mover_kanban:orcamento","criar_oportunidade","solicitar_humano"]', 10),
    ('Suporte de TI urgente', 'keyword_or_intent', '{"keywords":["urgente","fora do ar","sem internet","sistema caiu","erro","suporte"]}', '["mover_kanban:suporte","solicitar_humano"]', 5),
    ('Interesse em trafego ou social media', 'keyword_or_intent', '{"keywords":["trafego","anuncio","instagram","social media","conteudo","meta ads","google ads"]}', '["mover_kanban:briefing","classificar_servico:marketing_digital"]', 20),
    ('Interesse em software ou site', 'keyword_or_intent', '{"keywords":["sistema","software","app","site","landing page","automacao","integracao"]}', '["mover_kanban:briefing","classificar_servico:software_house"]', 20)
) as r(name, trigger_type, conditions, actions, priority)
where t.slug = 'jiw'
on conflict (tenant_id, name) do update
set trigger_type = excluded.trigger_type,
    conditions = excluded.conditions,
    actions = excluded.actions,
    priority = excluded.priority,
    active = excluded.active,
    updated_at = now();

select
  'setup_jiw_ok' as status,
  (select count(*) from tenants where slug = 'jiw') as tenants,
  (select count(*) from channels c join tenants t on t.id = c.tenant_id where t.slug = 'jiw') as channels,
  (select count(*) from kanban_columns kc join tenants t on t.id = kc.tenant_id where t.slug = 'jiw') as kanban_columns,
  (select count(*) from funnel_stages fs join tenants t on t.id = fs.tenant_id where t.slug = 'jiw') as funnel_stages,
  (select count(*) from automation_rules ar join tenants t on t.id = ar.tenant_id where t.slug = 'jiw') as automation_rules;
