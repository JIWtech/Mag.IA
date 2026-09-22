-- Setup definitivo do tenant Clinica da Nubia.
-- Execute no SQL Editor do Supabase.
-- Antes de rodar, ajuste:
--   1. AJUSTAR_EMAIL_OWNER
--   2. Bronzeamento_Nubia_bot
--   3. Opcionalmente, nome/plano/status do tenant.
--
-- O token do Telegram deve ficar em variavel do n8n/EasyPanel:
--   TELEGRAM_BOT_TOKEN_CLINICA_NUBIA=token_real

begin;

insert into public.tenants (slug, name, industry, plan, status)
values (
  'clinica_nubia',
  'Clinica da Nubia',
  'Estetica e bronzeamento',
  'mvp',
  'active'
)
on conflict (slug) do update
set
  name = excluded.name,
  industry = excluded.industry,
  plan = excluded.plan,
  status = excluded.status,
  updated_at = now();

insert into public.tenant_members (tenant_id, user_id, role, status)
select
  t.id,
  u.id,
  'owner',
  'active'
from public.tenants t
join auth.users u on u.email = 'cachorrodapatasuja@gmail.com'
where t.slug = 'clinica_nubia'
on conflict (tenant_id, user_id) do update
set
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

insert into public.channels (
  tenant_id,
  type,
  name,
  external_id,
  status,
  credentials_ref,
  config
)
select
  t.id,
  'telegram',
  'Telegram - Clinica da Nubia',
  'Bronzeamento_Nubia_bot',
  'active',
  'TELEGRAM_BOT_TOKEN_CLINICA_NUBIA',
  jsonb_build_object(
    'bot_username', 'Bronzeamento_Nubia_bot',
    'webhook_path', '/webhook/telegram?tenant_slug=clinica_nubia'
  )
from public.tenants t
where t.slug = 'clinica_nubia'
on conflict (tenant_id, type, external_id) do update
set
  name = excluded.name,
  status = excluded.status,
  credentials_ref = excluded.credentials_ref,
  config = excluded.config,
  updated_at = now();

insert into public.tenant_settings (
  tenant_id,
  timezone,
  business_hours,
  fallback_message,
  handoff_message,
  settings
)
select
  t.id,
  'America/Sao_Paulo',
  jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'days', jsonb_build_array('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'),
    'start', '08:00',
    'end', '18:00'
  ),
  'Desculpe, nao consegui entender. Pode reformular sua pergunta?',
  'Vou encaminhar sua conversa para atendimento humano. Em breve alguem da equipe continua por aqui.',
  jsonb_build_object(
    'tone', 'feminino, acolhedor, charmoso, elegante e direto',
    'ai_model', 'gemini-2.5-flash-lite',
    'ai_enabled', true,
    'ai_provider', 'gemini',
    'kanban_abandoned_after_hours', 24,
    'debounce_window_ms', 12000,
    'fragment_debounce_window_ms', 25000,
    'gemini_daily_limit', 80,
    'media_ai_enabled', false,
    'appointment_duration_minutes', 120,
    'default_ai_appointment_status', 'pending_payment',
    'payment_signal_enabled', true,
    'appointment_payment_trigger', 'SINAL PAGO',
    'payment_signal_stage', 'Verificar Sinal',
    'payment_signal_ack_message', 'Tá bom! Vou confirmar aqui, um momento.',
    'payment_signal_confirmation_message', 'Reserva efetuada! Recebemos sua confirmacao de sinal. O valor do sinal nao e reembolsavel em caso de cancelamento. Remarcacoes devem ser solicitadas com no minimo 24h de antecedencia, ou excepcionalmente ate 8h antes. A equipe vai conferir o pagamento e seguir com a confirmacao por aqui.',
    'deposit_percentage', 50,
    'payment', jsonb_build_object(
      'deposit_percentage', 50,
      'enabled', true,
      'signal_trigger', 'SINAL PAGO',
      'ack_message', 'Tá bom! Vou confirmar aqui, um momento.',
      'confirmation_message', 'Reserva efetuada! Recebemos sua confirmacao de sinal. O valor do sinal nao e reembolsavel em caso de cancelamento. Remarcacoes devem ser solicitadas com no minimo 24h de antecedencia, ou excepcionalmente ate 8h antes. A equipe vai conferir o pagamento e seguir com a confirmacao por aqui.',
      'pix_key', '21966353026',
      'pix_holder', 'Yhago Goncalves',
      'pix_institution', 'Mercado Pago',
      'accepted_payment_methods', jsonb_build_array('pix', 'link_cartao_credito', 'dinheiro_presencial')
    ),
    'service_categories', jsonb_build_array(
      'bronzeamento',
      'bronze a jato',
      'banho de lua',
      'descoloracao',
      'detox corporal',
      'agendamentos',
      'reclamacoes'
    ),
    'handoff_rules', jsonb_build_array(
      'cliente pedir atendente humano',
      'reclamacao',
      'orcamento complexo',
      'agendamento pronto para conferencia',
      'alteracao de horario'
    ),
    'system_prompt', $prompt$
Voce e da equipe de atendimento da Clinica da Nubia - Estetica e Bronzeamento.
Comunique-se sempre no feminino, com tom caloroso, gentil, acolhedor, charmoso, elegante e direto, como uma atendente experiente conversando pelo WhatsApp.

REGRA DE EMOJIS:
- Use emoji apenas na primeira resposta da conversa, se fizer sentido.
- Depois disso, use emoji no maximo a cada tres mensagens aproximadamente.
- Nunca use emoji em respostas seguidas.
- Se a conversa for sobre reclamacao, problema, pagamento ou atendimento humano, nao use emoji.

REGRAS CRITICAS DE COMPORTAMENTO:
1. Nunca diga que e uma inteligencia artificial ou assistente virtual. Diga apenas que e da equipe da Nubia.
2. Nunca repita informacoes que voce ja mencionou no historico da conversa.
3. Nunca envie blocos gigantes de texto. Mande mensagens curtas, fluidas e conversacionais, normalmente com 1 a 3 frases.
4. Nao repita saudacoes como "oi", "ola", "linda", "querida" no meio da conversa. Se o dialogo ja comecou, responda direto a duvida.
5. Quando a cliente perguntar diferenca entre servicos, explique de forma simples e comparativa em uma unica resposta curta.
6. Nao invente disponibilidade de agenda. Quando chegar no momento de marcar, diga que ira conferir com a equipe/Nubia.
7. Nao confirme horario, vaga ou agendamento final sem atendimento humano.

SERVICOS E VALORES OFICIAIS:
- Bronze classico: maquina, frente e costas. Valor: R$ 99,99.
- Bronze no sol: natural em espreguicadeira. Valor: R$ 99,99.
- Bronze Classico Centro: atendimento em dupla ou taxa exclusiva. Valor: R$ 119,99.
- Bronze a jato corpo todo: efeito natural, dura de 5 a 15 dias. Valor: R$ 149,99.
- Bronze a jato somente bojo: parte superior. Valor: R$ 49,99.
- Bronze a Jato VIP a domicilio. Valor: R$ 199,99.
- Bronze comfort: deitada em sala individual com privacidade. Valor: R$ 179,99.
- Bronze premium: maquina dupla frente e costas juntas. Valor: R$ 149,99.
- Potencia Bronze Classico: maquina + jato corpo todo. Valor: R$ 179,99.
- Potencia Bronze Comfort: comfort deitada + jato corpo todo. Valor: R$ 279,99.
- Potencia Bronze Premium: maquina dupla + jato corpo todo. Valor: R$ 229,99.
- Descoloracao simples. Valor: R$ 19,99.
- Descoloracao premium antialergica. Valor: R$ 39,99.
- Banho de lua comfort: completo com esfoliacao e manta termica. Valor: R$ 69,99.
- Detox corporal. Valor: R$ 49,99.
- Tatuagem solar temporaria. Valor: R$ 5,00.

DUVIDAS FREQUENTES:
- Resultado imediato: explique com delicadeza que o bronze e um processo gradual e que sessoes complementares/manutencao deixam o resultado mais uniforme e duradouro.
- Desconto amiga: informe que levar uma amiga para bronzear junto pode garantir condicao especial para as duas, mas que a equipe confirma a regra vigente.
- Publico atendido: os procedimentos sao voltados ao publico feminino. Homens podem pedir informacoes ou marcar para esposa, namorada, amiga, filha ou familiar.
- Menor de idade: menor de 18 anos so pode realizar atendimento com responsavel.

FLUXO DE AGENDAMENTO:
Quando a cliente quiser marcar horario, colete aos poucos:
1. Nome da cliente.
2. Servico escolhido.
3. Melhor dia.
4. Periodo preferido: manha ou tarde.
5. Se e cliente nova ou antiga.
6. Se for menor de idade, confirme que ira acompanhada de responsavel.

Quando nome, servico, data e horario estiverem completos, responda de forma curta confirmando que a reserva ficou pre-agendada e informe que para garantir o horario e necessario o pagamento do sinal.
Inclua no final apenas a tag interna:
[ACAO: CRIAR_AGENDAMENTO | nome=Nome da cliente | servico=Servico escolhido | data=AAAA-MM-DD | hora=HH:MM | status=pending_payment]

Se a cliente pedir o Pix, informe os dados configurados do Pix e peca para ela responder exatamente SINAL PAGO depois de pagar.
Enquanto a cliente nao enviar SINAL PAGO ou equivalente de pagamento realizado, continue tirando duvidas normalmente.
Quando a cliente enviar SINAL PAGO ou equivalente de pagamento realizado, o workflow envia apenas a confirmacao curta de recebimento, move para Verificar Sinal e silencia a IA.
A confirmacao final da reserva e regras de cancelamento/remarcacao so deve ser enviada quando o operador clicar em Confirmar no Kanban.

RECLAMACOES:
Se a cliente demonstrar insatisfacao, problema com procedimento, pagamento, resultado ou atendimento, acolha com respeito e responda:
"Sinto muito por isso, de verdade. Vou chamar a Nubia para verificar com prioridade e te dar continuidade por aqui."
Inclua no final apenas a tag interna [ACAO: RECLAMACAO].

ATENDIMENTO HUMANO:
Se a cliente pedir atendente, Nubia, humano, ligacao, alteracao de horario, cancelamento ou reclamacao, encaminhe para humano usando [HUMANO_SOLICITADO].
Nao use atendimento humano para o agendamento comum antes de SINAL PAGO.

FORMATO:
- Responda sempre em portugues do Brasil.
- Nao use Markdown.
- Nao use tabelas.
- Para listas, use bullets simples apenas quando necessario.
- Nao exponha tags internas ao cliente se o sistema remover as tags.
$prompt$
  )
from public.tenants t
where t.slug = 'clinica_nubia'
on conflict (tenant_id) do update
set
  timezone = excluded.timezone,
  business_hours = excluded.business_hours,
  fallback_message = excluded.fallback_message,
  handoff_message = excluded.handoff_message,
  settings = excluded.settings,
  updated_at = now();

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
),
updated_agent as (
  update public.ai_agents a
  set
    provider = 'gemini',
    model = 'gemini-2.5-flash-lite',
    temperature = 0.5,
    max_tokens = 700,
    active_prompt_version = 1,
    settings = jsonb_build_object(
      'purpose', 'atendimento comercial, pre-agendamento e sinal de pagamento',
      'channel', 'telegram'
    ),
    updated_at = now()
  from tenant_row t
  where a.tenant_id = t.id
    and a.name = 'Atendente Clinica da Nubia'
  returning a.id
)
insert into public.ai_agents (
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
  t.id,
  'Atendente Clinica da Nubia',
  'gemini',
  'gemini-2.5-flash-lite',
  0.5,
  700,
  1,
  jsonb_build_object(
    'purpose', 'atendimento comercial e triagem de agendamentos',
    'channel', 'telegram'
  )
from tenant_row t
where not exists (select 1 from updated_agent);

insert into public.ai_prompt_versions (
  tenant_id,
  ai_agent_id,
  version,
  prompt,
  guardrails,
  tools,
  active
)
select
  t.id,
  a.id,
  1,
  ts.settings->>'system_prompt',
  jsonb_build_array(
    'nao_confirmar_disponibilidade_sem humano',
    'nao_inventar_precos',
    'nao_expor_tags_internas'
  ),
  jsonb_build_array(
    'handoff',
    'kanban_stage_update',
    'appointments'
  ),
  true
from public.tenants t
join lateral (
  select *
  from public.ai_agents a
  where a.tenant_id = t.id
    and a.name = 'Atendente Clinica da Nubia'
  order by a.created_at desc
  limit 1
) a on true
join public.tenant_settings ts on ts.tenant_id = t.id
where t.slug = 'clinica_nubia'
on conflict (ai_agent_id, version) do update
set
  prompt = excluded.prompt,
  guardrails = excluded.guardrails,
  tools = excluded.tools,
  active = excluded.active;

update public.kanban_boards
set is_default = false
where tenant_id = (select id from public.tenants where slug = 'clinica_nubia');

insert into public.kanban_boards (tenant_id, name, is_default)
select
  t.id,
  'Kanban Clinica da Nubia',
  true
from public.tenants t
where t.slug = 'clinica_nubia'
on conflict (tenant_id, name) do update
set is_default = true;

delete from public.kanban_columns
where board_id = (
  select b.id
  from public.kanban_boards b
  join public.tenants t on t.id = b.tenant_id
  where t.slug = 'clinica_nubia'
    and b.name = 'Kanban Clinica da Nubia'
  limit 1
);

insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
select
  b.tenant_id,
  b.id,
  col.name,
  col.position,
  col.automation_key
from public.kanban_boards b
join public.tenants t on t.id = b.tenant_id
cross join (values
  ('Conversas IA', 1, 'conversas_ia'),
  ('Aguardando humano', 2, 'aguardando_humano'),
  ('Verificar Sinal', 3, 'verificar_sinal'),
  ('Com humano', 4, 'com_humano'),
  ('Finalizadas', 5, 'finalizadas'),
  ('Agendamentos', 6, 'agendamentos'),
  ('Conversas abandonadas', 7, 'conversas_abandonadas')
) as col(name, position, automation_key)
where t.slug = 'clinica_nubia'
  and b.name = 'Kanban Clinica da Nubia';

commit;

-- Validacao rapida:
-- select t.slug, ts.settings->>'ai_model' as ai_model, count(kc.id) as kanban_columns
-- from public.tenants t
-- join public.tenant_settings ts on ts.tenant_id = t.id
-- join public.kanban_boards kb on kb.tenant_id = t.id and kb.is_default = true
-- join public.kanban_columns kc on kc.board_id = kb.id
-- where t.slug = 'clinica_nubia'
-- group by t.slug, ts.settings->>'ai_model';
