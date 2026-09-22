-- Seed complementar do tenant Universo Prata.
-- Objetivo:
-- 1. Ajustar tom/prompt comercial humanizado.
-- 2. Cadastrar catalogo inicial de imagens por categoria.
-- 3. Padronizar etapas comerciais do Kanban.
-- 4. Configurar gatilho de sinal de pagamento.
--
-- Antes de rodar:
-- - O tenant universo_prata deve existir.
-- - O owner deve estar vinculado em tenant_members.
-- - O WhatsApp deve estar cadastrado em channels.
-- - As variaveis da Evolution devem existir no n8n/EasyPanel:
--   EVOLUTION_API_URL_UNIVERSO_PRATA
--   EVOLUTION_API_KEY_UNIVERSO_PRATA
--   EVOLUTION_INSTANCE_UNIVERSO_PRATA

begin;

insert into public.tenants (slug, name, industry, plan, status)
values (
  'universo_prata',
  'Universo Prata',
  'Joias, prata e varejo',
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
    'start', '09:00',
    'end', '18:00'
  ),
  'Desculpa, nao consegui entender direitinho. Voce pode me dizer se procura aneis, pulseiras, cordoes ou pedras?',
  'Vou chamar uma pessoa da equipe para continuar com voce por aqui.',
  '{}'::jsonb
from public.tenants t
where t.slug = 'universo_prata'
on conflict (tenant_id) do update
set
  timezone = excluded.timezone,
  business_hours = excluded.business_hours,
  fallback_message = excluded.fallback_message,
  handoff_message = excluded.handoff_message,
  updated_at = now();

update public.tenant_settings s
set
  settings = coalesce(s.settings, '{}'::jsonb) || jsonb_build_object(
    'language', 'pt-BR',
    'tone', 'feminino, acolhedor, elegante, simpatico, comercial e direto',
    'ai_provider', 'gemini',
    'ai_model', 'gemini-2.5-flash-lite',
    'ai_enabled', true,
    'commerce_mode', true,
    'gemini_daily_limit', 80,
    'payment_signal_enabled', true,
    'payment_signal_trigger', 'SINAL PAGO',
    'appointment_payment_trigger', 'SINAL PAGO',
    'payment_signal_stage', 'Verificar Sinal',
    'payment_signal_ack_message', 'Ta bom! Vou confirmar aqui, um momento.',
    'payment_signal_confirmation_message', 'Reserva confirmada! Recebemos a confirmacao do sinal. A equipe vai conferir o pagamento e seguir com a finalizacao do seu atendimento por aqui.',
    'payment', jsonb_build_object(
      'enabled', true,
      'signal_trigger', 'SINAL PAGO',
      'ack_message', 'Ta bom! Vou confirmar aqui, um momento.',
      'confirmation_message', 'Reserva confirmada! Recebemos a confirmacao do sinal. A equipe vai conferir o pagamento e seguir com a finalizacao do seu atendimento por aqui.',
      'pix_key', 'pixdauniversoprata@gmail.com',
      'pix_holder', 'Andre Menezes',
      'pix_institution', 'Mercado Pago'
    ),
    'service_categories', jsonb_build_array('aneis', 'pulseiras', 'cordoes', 'pedras'),
    'product_media_catalog', jsonb_build_array(
      jsonb_build_object(
        'category_key', 'aneis',
        'label', 'Aneis',
        'aliases', jsonb_build_array('anel', 'aneis', 'aneis de prata', 'anel de prata', 'solitario'),
        'items', jsonb_build_array(
          jsonb_build_object(
            'title', 'Anel de prata - exemplo 1',
            'caption', 'Algumas opcoes de aneis em prata para voce conhecer.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20ring%20with%20chalcedony%20and%20peaches%20by%20ASQ.jpg',
            'file_name', 'universo-prata-anel-1.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Anel de prata - exemplo 2',
            'caption', 'Modelo delicado em prata.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20ring%20and%20scorzoneras%20by%20ASQ.jpg',
            'file_name', 'universo-prata-anel-2.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Anel de prata - exemplo 3',
            'caption', 'Outra referencia de anel para escolha de estilo.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20finger%20ring%20with%20Pentagram%20symbol.jpg',
            'file_name', 'universo-prata-anel-3.jpg',
            'source', 'Wikimedia Commons'
          )
        )
      ),
      jsonb_build_object(
        'category_key', 'pulseiras',
        'label', 'Pulseiras',
        'aliases', jsonb_build_array('pulseira', 'pulseiras', 'bracelete', 'braceletes', 'pulseira de prata'),
        'items', jsonb_build_array(
          jsonb_build_object(
            'title', 'Pulseira de prata - exemplo 1',
            'caption', 'Separei algumas opcoes de pulseiras para voce ver.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20bracelet%20MET%20DP114296.jpg',
            'file_name', 'universo-prata-pulseira-1.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Pulseira de prata - exemplo 2',
            'caption', 'Referencia de pulseira em prata.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20bracelet%20and%20cherries%20by%20ASQ.jpg',
            'file_name', 'universo-prata-pulseira-2.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Pulseira de prata - exemplo 3',
            'caption', 'Outro exemplo para comparar o estilo.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20and%20gold%20bracelet%20on%20lemon%20by%20ASQ.jpg',
            'file_name', 'universo-prata-pulseira-3.jpg',
            'source', 'Wikimedia Commons'
          )
        )
      ),
      jsonb_build_object(
        'category_key', 'cordoes',
        'label', 'Cordoes',
        'aliases', jsonb_build_array('cordao', 'cordoes', 'corrente', 'correntes', 'colar', 'colares', 'cordao de prata'),
        'items', jsonb_build_array(
          jsonb_build_object(
            'title', 'Cordao de prata - exemplo 1',
            'caption', 'Separei algumas opcoes de cordoes/correntes para voce.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20Jewellery%20Chain.jpg',
            'file_name', 'universo-prata-cordao-1.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Cordao de prata - exemplo 2',
            'caption', 'Referencia de cordao em prata.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Silver%20necklace%20with%20redcurrants%20by%20ASQ.jpg',
            'file_name', 'universo-prata-cordao-2.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Cordao de prata - exemplo 3',
            'caption', 'Outro exemplo para comparar tamanho e estilo.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Magpie%27s%20Nest%20-%20silver%20necklace%20side%20view.jpg',
            'file_name', 'universo-prata-cordao-3.jpg',
            'source', 'Wikimedia Commons'
          )
        )
      ),
      jsonb_build_object(
        'category_key', 'pedras',
        'label', 'Pedras',
        'aliases', jsonb_build_array('pedra', 'pedras', 'gemas', 'gema', 'ametista', 'aquamarine', 'agua marinha'),
        'items', jsonb_build_array(
          jsonb_build_object(
            'title', 'Pedra ametista - exemplo 1',
            'caption', 'Algumas referencias de pedras para voce conhecer.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Two%20oval%20amethyst%20cabochons%202.jpg',
            'file_name', 'universo-prata-pedra-1.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Pedra aquamarine - exemplo 2',
            'caption', 'Referencia de pedra em tom claro.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Fancy%20cut%20aquamarine%202.jpg',
            'file_name', 'universo-prata-pedra-2.jpg',
            'source', 'Wikimedia Commons'
          ),
          jsonb_build_object(
            'title', 'Pedra ametista - exemplo 3',
            'caption', 'Outra opcao de pedra para comparar cor e acabamento.',
            'url', 'https://commons.wikimedia.org/wiki/Special:FilePath/Amethyst%20Gems.jpg',
            'file_name', 'universo-prata-pedra-3.jpg',
            'source', 'Wikimedia Commons'
          )
        )
      )
    ),
    'system_prompt', $prompt$
Voce e da equipe de atendimento da Universo Prata.
Atenda em portugues do Brasil, com tom feminino, acolhedor, elegante, simpatico, comercial e direto, como uma vendedora experiente conversando pelo WhatsApp.

REGRAS CRITICAS:
1. Nunca diga que e inteligencia artificial, robo, bot ou assistente virtual. Diga apenas que e da equipe da Universo Prata.
2. Nao envie textos longos sem necessidade. Responda em 1 a 3 frases na maioria dos casos.
3. Nao repita saudacoes no meio da conversa. Se a conversa ja comecou, responda direto ao que a cliente perguntou.
4. Nao invente estoque, preco, disponibilidade, prazo, garantia ou condicao de pagamento.
5. Quando a cliente pedir uma categoria, como aneis, pulseiras, cordoes ou pedras, responda de forma curta avisando que vai mandar algumas opcoes e pergunte o estilo, tamanho ou faixa de valor que ela prefere. O sistema enviara as fotos automaticamente.
6. Se a cliente escrever com erro, abreviacao ou mensagens picadas, interprete o contexto com naturalidade.
7. Se a cliente pedir "manda tudo", "manda as fotos", "manda de novo", "quero ver" ou demonstrar impaciencia, nao fique qualificando com varias perguntas. Responda de forma humana e curta, envie as opcoes e depois pergunte qual delas chamou mais atencao.
8. Nao repita a mesma estrutura de resposta em sequencia. Varie naturalmente e use frases mais humanas, como "claro", "te mando agora", "olha essas opcoes", sem exagerar.
9. Faca no maximo uma pergunta de refinamento antes de apresentar fotos. Se a cliente insistir nas fotos, priorize mostrar as pecas.

CATEGORIAS INICIAIS:
- Aneis.
- Pulseiras.
- Cordoes e correntes.
- Pedras.

FLUXO COMERCIAL:
- Ajude a cliente a escolher a categoria e entender o estilo desejado.
- Quando a categoria ja estiver clara, apresente as opcoes antes de continuar perguntando preferencias.
- Quando ela demonstrar interesse real em uma peca, colete aos poucos: nome, categoria/produto desejado e forma preferida de finalizar.
- Se precisar confirmar disponibilidade, diga que vai conferir com a equipe.
- Quando a cliente quiser reservar ou finalizar, explique que pode ser solicitado um sinal de pagamento para segurar a peca.
- Se a cliente pedir Pix ou dados de pagamento, envie os dados de pagamento cadastrados e peca para ela responder exatamente SINAL PAGO depois de pagar.
- Enquanto ela nao enviar SINAL PAGO, continue tirando duvidas normalmente.
- Quando ela enviar SINAL PAGO, o sistema respondera uma confirmacao curta, movera a conversa para Verificar Sinal e a equipe humana seguira a conferencia.

ATENDIMENTO HUMANO:
Se a cliente pedir atendente, reclamar, pedir negociacao especial, desconto fora do padrao, troca, problema com pedido ou comprovante, responda que vai chamar a equipe e use [HUMANO_SOLICITADO].

FORMATO:
- Nao use Markdown.
- Nao use tabelas.
- Use listas curtas apenas quando realmente ajudar.
- Faca uma pergunta por vez sempre que possivel.
$prompt$
  ),
  updated_at = now()
from public.tenants t
where t.id = s.tenant_id
  and t.slug = 'universo_prata';

update public.channels c
set
  name = 'WhatsApp - Universo Prata',
  status = 'active',
  credentials_ref = 'EVOLUTION_API_KEY_UNIVERSO_PRATA',
  config = coalesce(c.config, '{}'::jsonb) || jsonb_build_object(
    'instance_name', 'universo_prata',
    'webhook_path', '/webhook/magia-whatsapp',
    'api_url_env', 'EVOLUTION_API_URL_UNIVERSO_PRATA',
    'api_key_env', 'EVOLUTION_API_KEY_UNIVERSO_PRATA',
    'instance_env', 'EVOLUTION_INSTANCE_UNIVERSO_PRATA'
  ),
  updated_at = now()
from public.tenants t
where c.tenant_id = t.id
  and t.slug = 'universo_prata'
  and c.type = 'whatsapp';

with tenant_ref as (
  select id from public.tenants where slug = 'universo_prata'
),
board_upsert as (
  insert into public.kanban_boards (tenant_id, name, is_default)
  select id, 'Funil comercial Universo Prata', true
  from tenant_ref
  on conflict do nothing
  returning id, tenant_id
),
board_ref as (
  select id, tenant_id from board_upsert
  union
  select b.id, b.tenant_id
  from public.kanban_boards b
  join tenant_ref t on t.id = b.tenant_id
  where b.is_default = true
  limit 1
),
desired_columns as (
  select
    b.tenant_id,
    b.id as board_id,
    col.name,
    col.position,
    col.automation_key
  from board_ref b
  cross join (values
    ('Conversas IA', 1, 'conversas_ia'),
    ('Produtos apresentados', 2, 'produtos_apresentados'),
    ('Interesse de compra', 3, 'interesse_compra'),
    ('Aguardando finalizacao', 4, 'aguardando_finalizacao'),
    ('Verificar Sinal', 5, 'verificar_sinal'),
    ('Finalizadas', 6, 'finalizadas')
  ) as col(name, position, automation_key)
)
insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
select
  tenant_id,
  board_id,
  name,
  position,
  automation_key
from desired_columns
on conflict (tenant_id, board_id, name) do update
set
  position = excluded.position,
  automation_key = excluded.automation_key;

commit;
