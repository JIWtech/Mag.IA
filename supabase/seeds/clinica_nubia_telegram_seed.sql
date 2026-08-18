-- Seed do cliente: Clinica da Nubia.
-- Canal inicial: Telegram.
-- Requer migrations 001 a 008 aplicadas.
--
-- Antes de executar, conferir:
-- 1. Username real do bot no BotFather.
-- 2. Link real de agendamento, se ja existir.
-- 3. Token no .env do n8n como TELEGRAM_BOT_TOKEN_CLINICA_NUBIA.

with tenant_upsert as (
  insert into tenants (slug, name, industry, plan, status)
  values (
    'clinica_nubia',
    'Clinica da Nubia',
    'Estetica e bronzeamento',
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
  select id from tenants where slug = 'clinica_nubia'
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
      "friday": ["08:00", "18:00"],
      "saturday": ["08:00", "18:00"]
    }'::jsonb,
    'Nao consegui relacionar sua mensagem ao atendimento da Clinica da Nubia. Posso ajudar com bronzeamento a jato, duvidas sobre resultado, valores, formas de pagamento, atendimento em grupo ou agendamento.',
    'Vou encaminhar seu atendimento para a Nubia continuar com voce.',
    '{
      "language": "pt-BR",
      "ai_mode": "mock",
      "tone": "formal, acolhedor, claro e feminino",
      "primary_channel": "telegram",
      "customer_profile": "clientes 100% mulheres",
      "service_categories": [
        "bronzeamento_a_jato",
        "agendamento",
        "duvidas_sobre_resultado",
        "pacotes_para_amigas",
        "formas_de_pagamento",
        "reclamacoes"
      ],
      "business_context": {
        "units": 2,
        "working_hours": "08:00 as 18:00, com possibilidade de estender em dias de maior demanda",
        "human_responsible": "Nubia",
        "only_nubia_replies_human_messages": true,
        "audience": "mulheres",
        "expansion_context": "nova regiao com maior poder aquisitivo; preferir linguagem mais formal"
      },
      "appointment_rules": {
        "appointment_link": "AJUSTAR_LINK_DE_AGENDAMENTO",
        "handoff_required_for": ["agendamento", "reclamacao"],
        "required_fields_before_handoff": [
          "nome",
          "horario_desejado",
          "forma_de_pagamento",
          "cliente_antiga_ou_nova",
          "idade_ou_data_de_nascimento"
        ],
        "minor_rule": "menor de idade nao pode marcar sem responsavel",
        "group_capacity_note": "existem maquinas individuais e coletivas; em alguns horarios pode atender ate 6 pessoas, sendo 4 na coletiva e 2 na individual",
        "group_discount_note": "clientes podem procurar atendimento com amigas para desconto"
      },
      "ai_behavior": {
        "do_not_answer_if_close_contact": false,
        "close_contact_filter_pending": true,
        "avoid_claiming_immediate_result": true,
        "result_explanation": "explicar que o resultado pode aparecer na primeira sessao, mas geralmente e necessario mais de uma sessao para chegar no resultado desejado",
        "explain_spray_tan": true
      }
    }'::jsonb
  from tenant_ref tr
  where not exists (
    select 1
    from tenant_settings s
    where s.tenant_id = tr.id
  )
  returning tenant_id
),
channel_upsert as (
  insert into channels (tenant_id, type, name, external_id, status, config)
  select
    id,
    'telegram',
    'Telegram Clinica da Nubia',
    'clinica_nubia_bot',
    'active',
    jsonb_build_object(
      'webhook_path', '/webhook/telegram?tenant_slug=clinica_nubia',
      'bot_username', '@clinica_nubia_bot',
      'token_env', 'TELEGRAM_BOT_TOKEN_CLINICA_NUBIA',
      'appointment_link', 'AJUSTAR_LINK_DE_AGENDAMENTO'
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
    0.55,
    350,
    1,
    '{
      "handoff_keywords": [
        "agendar",
        "marcar",
        "horario",
        "reclamacao",
        "problema",
        "humano",
        "nubia",
        "atendente"
      ],
      "lead_fields": [
        "nome",
        "horario_desejado",
        "forma_de_pagamento",
        "cliente_antiga_ou_nova",
        "idade_ou_data_de_nascimento"
      ]
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
  'Voce e o assistente virtual da Clinica da Nubia. O publico atendido e formado por mulheres. Fale em portugues do Brasil com tom acolhedor, formal, claro e elegante. A Clinica da Nubia trabalha principalmente com bronzeamento a jato e atendimento estetico relacionado. Explique que o resultado do bronzeamento pode ser percebido desde a primeira sessao, mas nao prometa resultado imediato perfeito ou definitivo; oriente que normalmente mais de uma sessao pode ser necessaria para chegar ao tom desejado. Se perguntarem como e feito o bronzeamento a jato, explique de forma simples que o produto e aplicado de maneira uniforme na pele por equipamento proprio, buscando um bronzeado mais pratico e controlado, sem exposicao solar direta. Se a cliente falar sobre ir com amiga ou grupo, informe que pode existir condicao especial para amigas/grupos, mas que valores e encaixes devem ser confirmados pela Nubia. Para agendamento, reclamacao ou pedido direto para falar com responsavel, colete antes: nome, horario desejado, forma de pagamento, se e cliente antiga ou nova, e idade ou data de nascimento. Menor de idade precisa de responsavel. Depois inclua [HUMANO_SOLICITADO]. Nao confirme horario, preco final, desconto, disponibilidade, quantidade exata de maquinas ou encaixe sem validacao humana. Se a mensagem estiver fora do contexto da clinica, diga que nao conseguiu ajudar naquele assunto e reformule perguntando se a cliente deseja falar sobre bronzeamento, resultado, valores, pagamento, grupo de amigas ou agendamento.',
  '[
    "Nao prometer resultado imediato perfeito ou definitivo.",
    "Nao confirmar preco, desconto, horario ou disponibilidade sem validacao humana.",
    "Nao marcar menor de idade sem responsavel.",
    "Encaminhar agendamento e reclamacoes para humano.",
    "Coletar nome, horario desejado, forma de pagamento, cliente antiga/nova e idade/data de nascimento antes do handoff.",
    "Manter linguagem formal e acolhedora."
  ]'::jsonb,
  '["handoff", "tenant_service_catalog", "kanban_stage_update"]'::jsonb,
  true
from agent_ref
on conflict (ai_agent_id, version) do update
  set prompt = excluded.prompt,
      guardrails = excluded.guardrails,
      tools = excluded.tools,
      active = excluded.active;
