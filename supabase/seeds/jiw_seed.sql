-- Seed do primeiro cliente real da plataforma: JIW - Solucoes tecnologicas.
-- Requer que `supabase-generalista-schema.sql` ja tenha sido executado.

with tenant_upsert as (
  insert into tenants (slug, name, industry, plan, status)
  values ('jiw', 'JIW - Solucoes tecnologicas', 'Tecnologia e servicos digitais', 'Piloto', 'active')
  on conflict (slug) do update
    set name = excluded.name,
        industry = excluded.industry,
        plan = excluded.plan,
        status = excluded.status,
        updated_at = now()
  returning id
),
tenant_ref as (
  select id from tenant_upsert
  union
  select id from tenants where slug = 'jiw'
  limit 1
),
settings_upsert as (
  insert into tenant_settings (
    tenant_id,
    timezone,
    business_hours,
    fallback_message,
    handoff_message,
    settings
  )
  select
    id,
    'America/Sao_Paulo',
    '{
      "monday": ["09:00", "18:00"],
      "tuesday": ["09:00", "18:00"],
      "wednesday": ["09:00", "18:00"],
      "thursday": ["09:00", "18:00"],
      "friday": ["09:00", "18:00"]
    }'::jsonb,
    'Nao consegui relacionar sua mensagem aos servicos da JIW. Posso ajudar com software, suporte de TI, trafego pago, social media, sites, automacoes ou consultoria digital?',
    'Vou encaminhar seu atendimento para um especialista da JIW continuar com voce.',
    '{
      "language": "pt-BR",
      "tone": "consultivo, objetivo e profissional",
      "primary_channel": "telegram",
      "service_categories": [
        "software_house",
        "suporte_ti",
        "trafego_pago",
        "social_media",
        "sites_landing_pages",
        "automacoes",
        "consultoria_digital"
      ]
    }'::jsonb
  from tenant_ref
  on conflict do nothing
),
channel_upsert as (
  insert into channels (tenant_id, type, name, external_id, status, config)
  select
    id,
    'telegram',
    'Bot Telegram JIW',
    'jiwtech_bot',
    'connected',
    '{
      "webhook_path": "telegram-jiw",
      "bot_username": "@jiwtech_bot",
      "botfather_pending": false
    }'::jsonb
  from tenant_ref
  on conflict (tenant_id, type, external_id) do update
    set name = excluded.name,
        status = excluded.status,
        config = excluded.config,
        updated_at = now()
),
ai_agent_upsert as (
  insert into ai_agents (
    tenant_id,
    name,
    provider,
    model,
    temperature,
    max_tokens,
    active_prompt_version,
    settings
  )
  select
    id,
    'Assistente JIW',
    'mock',
    'mock-telegram-dev',
    0.35,
    700,
    1,
    '{
      "handoff_keywords": ["humano", "atendente", "especialista", "orcamento", "proposta", "contrato", "reuniao"],
      "lead_fields": ["nome", "empresa", "servico_interesse", "urgencia", "contato"]
    }'::jsonb
  from tenant_ref
  returning id, tenant_id
),
ai_agent_ref as (
  select id, tenant_id from ai_agent_upsert
  union
  select a.id, a.tenant_id
  from ai_agents a
  join tenant_ref t on t.id = a.tenant_id
  where a.name = 'Assistente JIW'
  limit 1
)
insert into ai_prompt_versions (
  tenant_id,
  ai_agent_id,
  version,
  prompt,
  guardrails,
  tools,
  active
)
select
  tenant_id,
  id,
  1,
  'Voce e o assistente da JIW - Solucoes tecnologicas. A JIW atende empresas com desenvolvimento de sistemas, sites, landing pages, automacoes, suporte de TI, infraestrutura, trafego pago, social media e consultoria digital. Seu papel e entender a necessidade do contato, qualificar o servico desejado, identificar urgencia, coletar nome/empresa/contato e encaminhar para especialista quando houver pedido de orcamento, proposta, suporte critico ou atendimento humano. Responda de forma objetiva, profissional e consultiva. Nao invente valores, prazos fechados ou garantias de resultado. Se o assunto fugir dos servicos digitais, informe que nao compete ao atendimento da JIW e reformule a pergunta para o contexto correto.',
  '[
    "Nao prometer resultado garantido em trafego pago ou social media.",
    "Nao informar preco fechado sem briefing.",
    "Encaminhar para humano em orcamento, contrato, urgencia tecnica ou proposta.",
    "Coletar dados minimos antes de encaminhar.",
    "Manter foco em tecnologia, suporte de TI e servicos digitais."
  ]'::jsonb,
  '[
    "criar_lead",
    "classificar_servico",
    "mover_kanban",
    "solicitar_humano",
    "criar_oportunidade"
  ]'::jsonb,
  true
from ai_agent_ref
on conflict (ai_agent_id, version) do update
  set prompt = excluded.prompt,
      guardrails = excluded.guardrails,
      tools = excluded.tools,
      active = excluded.active;

with tenant_ref as (
  select id from tenants where slug = 'jiw' limit 1
)
insert into channels (tenant_id, type, name, external_id, status, credentials_ref, config)
select
  id,
  'instagram',
  'Instagram DM JIW',
  'jiwtech',
  'prepared',
  'INSTAGRAM_PAGE_ACCESS_TOKEN_JIW',
  '{
    "webhook_path": "instagram-jiw",
    "instagram_username": "jiwtech",
    "requires_meta_app": true,
    "requires_page_access_token": true
  }'::jsonb
from tenant_ref
on conflict (tenant_id, type, external_id) do update
  set name = excluded.name,
      status = excluded.status,
      credentials_ref = excluded.credentials_ref,
      config = excluded.config,
      updated_at = now();

with tenant_ref as (
  select id from tenants where slug = 'jiw' limit 1
),
board_upsert as (
  insert into kanban_boards (tenant_id, name, is_default)
  select id, 'Atendimento JIW', true from tenant_ref
  returning id, tenant_id
),
board_ref as (
  select id, tenant_id from board_upsert
  union
  select b.id, b.tenant_id
  from kanban_boards b
  join tenant_ref t on t.id = b.tenant_id
  where b.name = 'Atendimento JIW'
  limit 1
)
insert into kanban_columns (tenant_id, board_id, name, position, automation_key)
select tenant_id, id, name, position, automation_key
from board_ref
cross join (
  values
    ('Novo contato', 1, 'novo_contato'),
    ('Qualificacao', 2, 'qualificacao'),
    ('Briefing necessario', 3, 'briefing'),
    ('Orcamento solicitado', 4, 'orcamento'),
    ('Suporte tecnico', 5, 'suporte'),
    ('Atendimento humano', 6, 'humano'),
    ('Fechado', 7, 'fechado')
) as columns(name, position, automation_key);
-- Se este seed for executado mais de uma vez em um ambiente sem constraint unica,
-- remova duplicatas mantendo o primeiro registro criado de cada coluna.
delete from kanban_columns a
using kanban_columns b
where a.id > b.id
  and a.tenant_id = b.tenant_id
  and a.board_id = b.board_id
  and a.name = b.name;

with tenant_ref as (
  select id from tenants where slug = 'jiw' limit 1
),
funnel_upsert as (
  insert into funnels (tenant_id, name, currency, is_default)
  select id, 'Funil Comercial JIW', 'BRL', true from tenant_ref
  returning id, tenant_id
),
funnel_ref as (
  select id, tenant_id from funnel_upsert
  union
  select f.id, f.tenant_id
  from funnels f
  join tenant_ref t on t.id = f.tenant_id
  where f.name = 'Funil Comercial JIW'
  limit 1
)
insert into funnel_stages (tenant_id, funnel_id, name, probability, position)
select tenant_id, id, name, probability, position
from funnel_ref
cross join (
  values
    ('Lead recebido', 10, 1),
    ('Diagnostico', 25, 2),
    ('Proposta', 55, 3),
    ('Negociacao', 75, 4),
    ('Cliente fechado', 100, 5)
) as stages(name, probability, position);
delete from funnel_stages a
using funnel_stages b
where a.id > b.id
  and a.tenant_id = b.tenant_id
  and a.funnel_id = b.funnel_id
  and a.name = b.name;

with tenant_ref as (
  select id from tenants where slug = 'jiw' limit 1
)
insert into automation_rules (tenant_id, name, trigger_type, conditions, actions, priority, active)
select id, name, trigger_type, conditions::jsonb, actions::jsonb, priority, true
from tenant_ref
cross join (
  values
    (
      'Pedido de orcamento',
      'keyword_or_intent',
      '{"keywords": ["orcamento", "proposta", "quanto custa", "valor", "preco"]}',
      '["mover_kanban:orcamento", "criar_oportunidade", "solicitar_humano"]',
      10
    ),
    (
      'Suporte de TI urgente',
      'keyword_or_intent',
      '{"keywords": ["urgente", "fora do ar", "sem internet", "sistema caiu", "erro", "suporte"]}',
      '["mover_kanban:suporte", "solicitar_humano"]',
      5
    ),
    (
      'Interesse em trafego ou social media',
      'keyword_or_intent',
      '{"keywords": ["trafego", "anuncio", "instagram", "social media", "conteudo", "meta ads", "google ads"]}',
      '["mover_kanban:briefing", "classificar_servico:marketing_digital"]',
      20
    ),
    (
      'Interesse em software ou site',
      'keyword_or_intent',
      '{"keywords": ["sistema", "software", "app", "site", "landing page", "automacao", "integracao"]}',
      '["mover_kanban:briefing", "classificar_servico:software_house"]',
      20
    )
) as rules(name, trigger_type, conditions, actions, priority);
delete from automation_rules a
using automation_rules b
where a.id > b.id
  and a.tenant_id = b.tenant_id
  and a.name = b.name;
