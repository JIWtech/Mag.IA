-- Atualizacao de escopo da Clinica da Nubia.
-- Objetivo:
-- 1. Manter servicos/valores no tenant_service_catalog.
-- 2. Configurar pagamento de sinal de 50%.
-- 3. Fazer a IA conduzir pre-agendamento sem humano ate a cliente informar pagamento do sinal.
-- 4. Apos SINAL PAGO ou equivalente de pagamento realizado, o workflow move para Verificar Sinal e silencia a IA.
-- 5. A confirmacao final so e enviada quando o operador clicar em Confirmar no Kanban.
--
-- Execute no SQL Editor do Supabase apos as migrations principais.

begin;

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
)
delete from public.tenant_service_catalog c
using tenant_row t
where c.tenant_id = t.id;

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
)
insert into public.tenant_service_catalog (
  tenant_id,
  external_source,
  external_id,
  category,
  name,
  description,
  billing_unit,
  price,
  notes,
  metadata,
  active
)
select
  t.id,
  'clinica_nubia_scope_v2',
  item.external_id,
  item.category,
  item.name,
  item.description,
  item.billing_unit,
  item.price,
  item.notes,
  item.metadata::jsonb,
  true
from tenant_row t
cross join (values
  (
    'bronze_classico',
    'Bronzeamento em Maquina',
    'Bronze Classico',
    'Bronze de corpo todo feito na maquina, primeiro frente e depois costas. Sala compartilhada para ate 6 clientes.',
    'sessao',
    99.99,
    'Reserve de 1h30 a 2h30 no espaco. Inclui avaliacao, preparo da pele e procedimento.',
    '{"modalidade":"maquina","sala":"compartilhada","capacidade_sala":6}'
  ),
  (
    'bronze_premium',
    'Bronzeamento em Maquina',
    'Bronze Premium',
    'Bronze com frente e costas ao mesmo tempo em maquina dupla. Sala individual.',
    'sessao',
    149.99,
    'Reserve de 1h30 a 2h30 no espaco. Inclui avaliacao, preparo da pele e procedimento.',
    '{"modalidade":"maquina","sala":"individual","maquina":"dupla"}'
  ),
  (
    'bronze_comfort',
    'Bronzeamento em Maquina',
    'Bronze Comfort',
    'Bronze em maquina deitada, em sala individual exclusiva, com mais conforto e relaxamento.',
    'sessao',
    179.99,
    'Reserve de 1h30 a 2h30 no espaco. Inclui avaliacao, preparo da pele e procedimento.',
    '{"modalidade":"maquina","sala":"individual","posicao":"deitada"}'
  ),
  (
    'bronze_no_sol',
    'Bronzeamento Solar',
    'Bronze no Sol',
    'Sessao de bronzeamento ao ar livre em espreguicadeira, com sol natural e produtos ativadores.',
    'sessao',
    99.99,
    'O bronze e um processo gradativo. Manutencoes ajudam a manter resultado mais uniforme e duradouro.',
    '{"modalidade":"sol","ambiente":"ao_ar_livre"}'
  ),
  (
    'bronze_jato_corpo_todo',
    'Bronze a Jato',
    'Bronze a Jato Corpo Todo',
    'Aplicacao em spray no corpo todo, com efeito de maquiagem corporal de longa duracao e bronzeado natural e uniforme.',
    'sessao',
    149.99,
    'Durabilidade media de 5 a 14 dias. Apos o procedimento, ficar de 8 a 12 horas sem tomar banho, se molhar ou suar. Vir com roupa escura e confortavel.',
    '{"modalidade":"jato","durabilidade_dias":"5 a 14"}'
  ),
  (
    'bronze_jato_bojo',
    'Bronze a Jato',
    'Bronze a Jato no Bojo',
    'Aplicacao em spray apenas no colo e parte superior, ideal para igualar a marquinha ou realcar o colo.',
    'sessao',
    49.99,
    'Apos o procedimento, ficar de 8 a 12 horas sem tomar banho, se molhar ou suar.',
    '{"modalidade":"jato","area":"colo_e_parte_superior"}'
  ),
  (
    'bronze_duplo_adicional_jato',
    'Bronze a Jato',
    'Bronze Duplo - Adicional Jato',
    'Combinacao de bronze de maquina ou bronze no sol com bronze a jato para resultado mais intenso, uniforme e duravel.',
    'adicional',
    99.99,
    'Valor adicional ao bronze escolhido. Exemplo: valor do bronze escolhido + R$ 99,99.',
    '{"modalidade":"combo","calculo":"valor_do_bronze_escolhido_mais_99_99"}'
  ),
  (
    'potencia_classico_ou_sol_jato',
    'Potencia Bronze',
    'Potencia Bronze Classico ou Sol + Jato',
    'Dois bronzes em uma unica sessao, combinando Classico ou Sol com Jato para potencializar intensidade e uniformidade.',
    'sessao',
    179.99,
    'Ideal para quem busca mais intensidade e praticidade em uma unica sessao.',
    '{"modalidade":"combo","inclui":["classico_ou_sol","jato"]}'
  ),
  (
    'potencia_premium_jato',
    'Potencia Bronze',
    'Potencia Bronze Premium + Jato',
    'Dois bronzes em uma unica sessao, combinando Premium com Jato.',
    'sessao',
    229.99,
    'Ideal para quem busca mais intensidade e praticidade em uma unica sessao.',
    '{"modalidade":"combo","inclui":["premium","jato"]}'
  ),
  (
    'potencia_comfort_jato',
    'Potencia Bronze',
    'Potencia Bronze Comfort + Jato',
    'Dois bronzes em uma unica sessao, combinando Comfort com Jato.',
    'sessao',
    259.99,
    'Ideal para quem busca mais intensidade e praticidade em uma unica sessao.',
    '{"modalidade":"combo","inclui":["comfort","jato"]}'
  ),
  (
    'banho_lua_classico',
    'Banhos de Lua',
    'Banho de Lua Classico',
    'Produto nao antialergico. Descolore os pelos, realca o bronzeado e deixa a pele mais iluminada.',
    'sessao',
    19.99,
    null,
    '{"antialergico":false}'
  ),
  (
    'banho_lua_premium',
    'Banhos de Lua',
    'Banho de Lua Premium',
    'Produto antialergico. Descolore os pelos e oferece mais conforto para peles sensiveis.',
    'sessao',
    34.99,
    null,
    '{"antialergico":true}'
  ),
  (
    'banho_lua_comfort',
    'Banhos de Lua',
    'Banho de Lua Comfort',
    'Produto antialergico. Descolore os pelos, hidrata, esfolia e pode ser realizado em pe ou deitada.',
    'sessao',
    69.99,
    'Tratamento completo para a pele.',
    '{"antialergico":true,"inclui":["hidratacao","esfoliacao"]}'
  ),
  (
    'detox_corporal_mousse_clareador',
    'Estetica e Cuidados',
    'Detox Corporal / Mousse Clareador',
    'Clareia a pele, hidrata e esfolia. Nao descolore os pelos.',
    'sessao',
    49.99,
    'Indicado para quem possui poucos pelos e tem dificuldade para bronzear. Prepara a pele para bronzeado mais uniforme.',
    '{"descolore_pelos":false}'
  ),
  (
    'tatuagem_solar_temporaria',
    'Adicionais',
    'Tatuagem Solar Temporaria',
    'Adicional temporario para marcar desenho durante o bronze.',
    'adicional',
    5.00,
    null,
    '{}'
  )
) as item(external_id, category, name, description, billing_unit, price, notes, metadata);

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
),
prompt_ref as (
  select $prompt$
Voce faz parte da equipe de atendimento da Clinica da Nubia - Estetica e Bronzeamento.
Fale no feminino, com tom acolhedor, elegante, charmoso e direto, como uma atendente experiente.

PERSONALIDADE E FORMATO
- Nunca diga que e inteligencia artificial ou assistente virtual.
- Responda em portugues do Brasil, com acentos corretos.
- Use mensagens curtas, normalmente 1 a 3 frases.
- Nao use Markdown nem tabelas.
- Use emoji apenas na primeira resposta e depois no maximo a cada 3 mensagens, sem repetir emoji em respostas seguidas.
- Em reclamacao, pagamento, sinal ou atendimento humano, nao use emoji.
- Nao repita saudacao no meio da conversa. Se a conversa ja comecou, responda direto.

FONTE DE VERDADE
- Servicos, valores, descricoes e observacoes comerciais devem vir do catalogo do banco.
- Nunca invente preco, duracao, beneficio, desconto, tecnologia ou disponibilidade.
- Se o catalogo trouxer informacao do servico perguntado, responda com base nele.
- Se a cliente pedir todos os servicos, liste de forma compacta usando o catalogo.

REGRAS IMPORTANTES DA CLINICA
- O bronze e um processo gradativo. Nao prometa resultado definitivo em uma unica sessao.
- Para melhor preparo: chegar 15 minutos antes, ja de banho tomado e sem oleo, creme ou hidratante no corpo.
- Nao se depilar no dia do bronze; se for depilar, fazer com pelo menos 2 dias de antecedencia.
- Proibido levar criancas, acompanhantes ou bicicletas.
- Tolerancia de atraso: 5 minutos. Depois disso, a vaga pode ser cancelada.
- Pagamento em dinheiro deve ser levado trocado.
- Atendimentos apos 17h, domingos e feriados possuem acrescimo de R$ 10,00.
- Menor de idade so pode realizar atendimento com responsavel.

O QUE LEVAR
Fone de ouvido sem fio, cabelo preso, toalha preferencialmente escura, sabonete, protetor solar para o rosto, oculos de sol e roupa confortavel.

PAGAMENTO DO SINAL
- O agendamento so e confirmado mediante pagamento de 50% do valor antecipado.
- O sinal nao e reembolsavel em caso de cancelamento.
- Remarcacoes devem ser solicitadas com no minimo 24h de antecedencia, ou excepcionalmente ate 8h antes.
- Cancelamentos fora do prazo, faltas ou atrasos acima de 5 minutos resultam na perda do sinal.
- Se a cliente pedir Pix ou dados de pagamento, envie:
Pix: 21966353026
Nome: Yhago Goncalves
Instituicao: Mercado Pago
- Quando a cliente enviar SINAL PAGO ou equivalente de pagamento realizado, o workflow enviara apenas a confirmacao curta de recebimento, movera para Verificar Sinal e silenciara a IA.
- A confirmacao final da reserva e regras de cancelamento/remarcacao so deve ser enviada quando o operador clicar em Confirmar no Kanban.

AGENDAMENTO
- Quando houver intencao de marcar, conduza o pre-agendamento ate registrar no sistema.
- Nao chame humano apenas para agendar.
- Colete aos poucos: nome da pessoa atendida, servico escolhido, data especifica e horario especifico.
- Se faltar algum dado, pergunte somente o proximo dado faltante.
- Se a cliente enviar varios dados juntos, aproveite todos.
- Quando nome, servico, data e horario estiverem claros, registre o pre-agendamento e diga que ele fica pendente do pagamento do sinal.
- Ao registrar, inclua no final somente esta tag interna:
[ACAO: CRIAR_AGENDAMENTO|nome=NOME|servico=SERVICO|data=AAAA-MM-DD|hora=HH:mm|duracao=120|status=pending_payment]
- A data da tag deve estar em AAAA-MM-DD e a hora em HH:mm.
- A tag interna nunca deve ser explicada para a cliente.

RECLAMACOES E HUMANO
- Reclamacao real envolve procedimento, resultado, pagamento, cobranca, cancelamento, atendimento ou experiencia na clinica.
- Em reclamacao real, acolha de forma curta e inclua [ACAO: RECLAMACAO].
- Se a cliente pedir explicitamente atendimento humano, inclua [HUMANO_SOLICITADO].
- Nao use [HUMANO_SOLICITADO] para agendamento comum antes de SINAL PAGO.
$prompt$ as system_prompt
)
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
      'bronzeamento em maquina',
      'bronzeamento solar',
      'bronze a jato',
      'potencia bronze',
      'banhos de lua',
      'detox corporal',
      'adicionais'
    ),
    'handoff_rules', jsonb_build_array(
      'cliente enviar exatamente SINAL PAGO',
      'cliente pedir atendente humano',
      'reclamacao real sobre procedimento, resultado, pagamento ou atendimento',
      'alteracao de horario',
      'cancelamento'
    ),
    'system_prompt', p.system_prompt
  )
from tenant_row t
cross join prompt_ref p
on conflict (tenant_id) do update
set
  timezone = excluded.timezone,
  business_hours = excluded.business_hours,
  fallback_message = excluded.fallback_message,
  handoff_message = excluded.handoff_message,
  settings = coalesce(public.tenant_settings.settings, '{}'::jsonb) || excluded.settings,
  updated_at = now();

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
)
update public.ai_agents a
set
  provider = 'gemini',
  model = 'gemini-2.5-flash-lite',
  temperature = 0.5,
  max_tokens = 700,
  settings = coalesce(a.settings, '{}'::jsonb) || jsonb_build_object(
    'purpose', 'atendimento comercial, pre-agendamento e sinal de pagamento',
    'channel', 'telegram'
  ),
  updated_at = now()
from tenant_row t
where a.tenant_id = t.id
  and a.name = 'Atendente Clinica da Nubia';

with tenant_row as (
  select id
  from public.tenants
  where slug = 'clinica_nubia'
)
update public.ai_prompt_versions pv
set
  prompt = ts.settings->>'system_prompt',
  guardrails = jsonb_build_array(
    'nao_inventar_precos',
    'usar_catalogo_como_fonte_de_verdade',
    'nao_confirmar_sem_sinal',
    'sinal_pago_silencia_ia',
    'nao_expor_tags_internas'
  ),
  tools = jsonb_build_array(
    'catalog_lookup',
    'appointments',
    'payment_signal_handoff',
    'kanban_stage_update'
  ),
  active = true
from tenant_row t
join public.tenant_settings ts on ts.tenant_id = t.id
where pv.tenant_id = t.id
  and pv.active = true;

with board_row as (
  select b.id, b.tenant_id
  from public.kanban_boards b
  join public.tenants t on t.id = b.tenant_id
  where t.slug = 'clinica_nubia'
    and b.is_default = true
  order by b.created_at desc
  limit 1
),
desired_columns as (
  select *
  from (values
    ('Conversas IA', 1, 'conversas_ia'),
    ('Aguardando humano', 2, 'aguardando_humano'),
    ('Verificar Sinal', 3, 'verificar_sinal'),
    ('Com humano', 4, 'com_humano'),
    ('Finalizadas', 5, 'finalizadas'),
    ('Agendamentos', 6, 'agendamentos'),
    ('Conversas abandonadas', 7, 'conversas_abandonadas')
  ) as col(name, position, automation_key)
),
updated_columns as (
  update public.kanban_columns kc
  set
    name = dc.name,
    position = dc.position
  from board_row b
  join desired_columns dc on true
  where kc.board_id = b.id
    and kc.automation_key = dc.automation_key
  returning kc.automation_key
)
insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
select
  b.tenant_id,
  b.id,
  dc.name,
  dc.position,
  dc.automation_key
from board_row b
cross join desired_columns dc
where not exists (
  select 1
  from updated_columns uc
  where uc.automation_key = dc.automation_key
);

commit;

-- Validacao rapida:
-- select count(*) from public.tenant_service_catalog c join public.tenants t on t.id = c.tenant_id where t.slug = 'clinica_nubia';
-- select settings->'payment', settings->>'appointment_payment_trigger', settings->>'default_ai_appointment_status' from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id where t.slug = 'clinica_nubia';
