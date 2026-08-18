-- Template para cadastrar um novo cliente Telegram na Mag.IA.
-- Antes de executar, substituir todos os valores marcados como AJUSTAR.
-- Requer migrations 001 a 008 aplicadas.

with tenant_upsert as (
  insert into tenants (slug, name, industry, plan, status)
  values (
    'AJUSTAR_SLUG',
    'AJUSTAR_NOME_CLIENTE',
    'AJUSTAR_SEGMENTO',
    'Piloto',
    'active'
  )
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
  select id from tenants where slug = 'AJUSTAR_SLUG'
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
      "monday": ["08:00", "18:00"],
      "tuesday": ["08:00", "18:00"],
      "wednesday": ["08:00", "18:00"],
      "thursday": ["08:00", "18:00"],
      "friday": ["08:00", "18:00"]
    }'::jsonb,
    'Nao consegui relacionar sua mensagem ao atendimento da empresa. Pode reformular dentro do contexto dos servicos oferecidos?',
    'Vou encaminhar seu atendimento para uma pessoa da equipe continuar com voce.',
    '{
      "language": "pt-BR",
      "tone": "consultivo, objetivo e profissional",
      "primary_channel": "telegram",
      "service_categories": ["AJUSTAR_CATEGORIA_1", "AJUSTAR_CATEGORIA_2", "AJUSTAR_CATEGORIA_3"]
    }'::jsonb
  from tenant_ref tr
  where not exists (
    select 1 from tenant_settings s where s.tenant_id = tr.id
  )
  returning tenant_id
),
channel_upsert as (
  insert into channels (tenant_id, type, name, external_id, status, config)
  select
    id,
    'telegram',
    'Telegram',
    'AJUSTAR_USERNAME_BOT_SEM_ARROBA',
    'active',
    jsonb_build_object(
      'webhook_path', '/webhook/telegram?tenant_slug=AJUSTAR_SLUG',
      'bot_username', '@AJUSTAR_USERNAME_BOT_SEM_ARROBA',
      'token_env', 'TELEGRAM_BOT_TOKEN_AJUSTAR_SLUG_EM_CAIXA_ALTA'
    )
  from tenant_ref
  on conflict (tenant_id, type, external_id) do update
    set name = excluded.name,
        status = excluded.status,
        config = excluded.config,
        updated_at = now()
  returning tenant_id
),
agent_upsert as (
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
    'Atendente principal',
    'gemini',
    'gemini-2.5-flash-lite',
    0.65,
    300,
    1,
    '{
      "handoff_keywords": ["humano", "atendente", "especialista", "orcamento", "proposta", "urgente"],
      "lead_fields": ["nome", "empresa", "servico_interesse", "urgencia", "contato"]
    }'::jsonb
  from tenant_ref tr
  where not exists (
    select 1
    from ai_agents a
    where a.tenant_id = tr.id
      and a.name = 'Atendente principal'
  )
  returning id, tenant_id
),
agent_ref as (
  select id, tenant_id from agent_upsert
  union
  select a.id, a.tenant_id
  from ai_agents a
  join tenant_ref tr on tr.id = a.tenant_id
  where a.name = 'Atendente principal'
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
  'Voce e o assistente virtual da AJUSTAR_NOME_CLIENTE. Atenda em portugues do Brasil, entenda a necessidade do contato, responda de forma natural e objetiva, faca no maximo 2 ou 3 perguntas por mensagem e solicite atendimento humano quando houver pedido de orcamento, urgencia, reclamacao ou duvida que exija decisao comercial. Nao invente precos, prazos, garantias ou disponibilidade.',
  '[
    "Nao inventar preco, prazo ou disponibilidade.",
    "Nao responder assuntos fora do escopo do cliente.",
    "Encaminhar para humano quando houver urgencia, reclamacao ou pedido comercial direto."
  ]'::jsonb,
  '["tenant_service_catalog", "handoff"]'::jsonb,
  true
from agent_ref
on conflict (ai_agent_id, version) do update
  set prompt = excluded.prompt,
      guardrails = excluded.guardrails,
      tools = excluded.tools,
      active = excluded.active;

