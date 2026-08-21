# Onboarding de Novo Cliente para Apresentacao

Objetivo: configurar rapidamente um novo cliente da Mag.IA para demonstracao
real usando:

```text
Canal: Telegram
IA: Gemini real
Banco: Supabase multi-tenant
Interface: mesma interface Mag.IA filtrada pelo tenant
n8n: workflow copiado/adaptado por cliente nesta fase
```

## Visao geral

O produto ja segue o modelo multi-tenant no Supabase e na interface:

```text
tenant_slug = cliente
channel_events filtrado por tenant_slug
interface usando VITE_TENANT_SLUG
```

Estado atual importante:

- a interface ja troca de cliente por `VITE_TENANT_SLUG`;
- o Supabase ja aceita varios tenants;
- o Command Router ja e o ponto de comando da interface;
- os workflows de canal ainda precisam ser copiados/adaptados por cliente;
- no futuro, o workflow sera mais generico e resolvera tenant/canal por tabela.

Para apresentacao, o caminho mais seguro e copiar o workflow da JIW e trocar os
dados do novo cliente.

## Dados que precisamos antes de configurar

Preencher:

```text
Nome da empresa:
Slug do tenant:
Segmento:
Servicos/produtos principais:
Tom de voz:
Horario de atendimento:
Quando chamar humano:
Nome do bot Telegram:
Username do bot Telegram:
API key Gemini:
Limite diario de testes:
```

Padrao recomendado para slug:

```text
letras minusculas
sem espaco
sem acento
sem caracteres especiais
```

Exemplos:

```text
acme
clinica_nova
studio_ana
loja_delta
```

## 1. Criar o bot no Telegram

No Telegram, abrir o BotFather:

```text
@BotFather
```

Executar:

```text
/newbot
```

Informar:

```text
Nome visivel: Nome do Cliente - Mag.IA
Username: nomecliente_magiabot
```

Guardar:

```text
TELEGRAM_BOT_TOKEN_CLIENTE
```

Nunca colocar esse token em frontend, documento publico ou print de
apresentacao.

## 2. Criar tenant no Supabase

No SQL Editor do Supabase, executar o bloco abaixo adaptando os campos.

Exemplo usando slug `cliente_demo`:

```sql
with tenant_upsert as (
  insert into tenants (slug, name, industry, plan, status)
  values (
    'cliente_demo',
    'Cliente Demo',
    'Segmento do cliente',
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
  select id from tenants where slug = 'cliente_demo'
  limit 1
)
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
  'Nao consegui relacionar sua mensagem ao atendimento desta empresa. Pode reformular seu pedido dentro do contexto dos servicos oferecidos?',
  'Vou encaminhar seu atendimento para um especialista continuar com voce.',
  '{
    "language": "pt-BR",
    "tone": "consultivo, objetivo e profissional",
    "primary_channel": "telegram"
  }'::jsonb
from tenant_ref
on conflict do nothing;
```

## 3. Cadastrar o canal Telegram no Supabase

Ainda no SQL Editor:

```sql
with tenant_ref as (
  select id from tenants where slug = 'cliente_demo' limit 1
)
insert into channels (tenant_id, type, name, external_id, status, credentials_ref, config)
select
  id,
  'telegram',
  'Bot Telegram Cliente Demo',
  'username_do_bot_sem_arroba',
  'connected',
  'TELEGRAM_BOT_TOKEN_CLIENTE_DEMO',
  '{
    "webhook_path": "telegram-cliente-demo",
    "bot_username": "@username_do_bot",
    "botfather_pending": false
  }'::jsonb
from tenant_ref
on conflict (tenant_id, type, external_id) do update
  set name = excluded.name,
      status = excluded.status,
      credentials_ref = excluded.credentials_ref,
      config = excluded.config,
      updated_at = now();
```

## 4. Criar IA e prompt do cliente

O prompt deve ser especifico do cliente, mas curto para economizar tokens.

Exemplo base:

```sql
with tenant_ref as (
  select id from tenants where slug = 'cliente_demo' limit 1
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
    'Assistente Cliente Demo',
    'gemini',
    'gemini-2.5-flash-lite',
    0.35,
    220,
    1,
    '{
      "handoff_keywords": ["humano", "atendente", "orcamento", "proposta", "contrato", "reuniao"],
      "lead_fields": ["nome", "empresa", "servico_interesse", "urgencia", "contato"]
    }'::jsonb
  from tenant_ref
  returning id, tenant_id
),
agent_ref as (
  select id, tenant_id from agent_upsert
  union
  select a.id, a.tenant_id
  from ai_agents a
  join tenant_ref t on t.id = a.tenant_id
  where a.name = 'Assistente Cliente Demo'
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
  'Voce e o assistente da Cliente Demo. A empresa atende [DESCREVER SERVICOS]. Seu papel e entender a necessidade do contato, qualificar o interesse, coletar nome/empresa/contato e encaminhar para humano quando houver pedido de orcamento, proposta, contrato, urgencia ou assunto sensivel. Responda em portugues do Brasil, de forma objetiva, profissional e consultiva. Nao invente valores, prazos fechados ou garantias. Se a mensagem fugir do contexto da empresa, informe que nao compete ao atendimento e peca para reformular dentro dos servicos oferecidos.',
  '[
    "Nao inventar preco, prazo ou garantia.",
    "Encaminhar para humano em orcamento, contrato, proposta ou urgencia.",
    "Coletar dados minimos antes de encaminhar.",
    "Manter foco no contexto da empresa."
  ]'::jsonb,
  '[
    "classificar_servico",
    "solicitar_humano",
    "mover_kanban",
    "criar_oportunidade"
  ]'::jsonb,
  true
from agent_ref
on conflict (ai_agent_id, version) do update
  set prompt = excluded.prompt,
      guardrails = excluded.guardrails,
      tools = excluded.tools,
      active = excluded.active;
```

## 5. Criar Kanban e Funil padrao

Para apresentacao, basta o padrao abaixo.

```sql
with tenant_ref as (
  select id from tenants where slug = 'cliente_demo' limit 1
),
board_upsert as (
  insert into kanban_boards (tenant_id, name, is_default)
  select id, 'Atendimento Cliente Demo', true from tenant_ref
  returning id, tenant_id
),
board_ref as (
  select id, tenant_id from board_upsert
  union
  select b.id, b.tenant_id
  from kanban_boards b
  join tenant_ref t on t.id = b.tenant_id
  where b.name = 'Atendimento Cliente Demo'
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
    ('Atendimento humano', 5, 'humano'),
    ('Fechado', 6, 'fechado')
) as columns(name, position, automation_key);

with tenant_ref as (
  select id from tenants where slug = 'cliente_demo' limit 1
),
funnel_upsert as (
  insert into funnels (tenant_id, name, currency, is_default)
  select id, 'Funil Comercial Cliente Demo', 'BRL', true from tenant_ref
  returning id, tenant_id
),
funnel_ref as (
  select id, tenant_id from funnel_upsert
  union
  select f.id, f.tenant_id
  from funnels f
  join tenant_ref t on t.id = f.tenant_id
  where f.name = 'Funil Comercial Cliente Demo'
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
```

## 6. Preparar workflow Telegram no n8n

Nesta fase, copiar o workflow da JIW:

```text
Base: n8n/workflows/jiw_telegram_real_supabase.json
Novo arquivo: n8n/workflows/cliente_demo_telegram_real_supabase.json
```

Trocar:

```text
id: clienteDemoTelegramReal01
name: Mag.IA/Cliente Demo - Telegram Atendimento REAL
webhook path: telegram-cliente-demo
tenant_slug: cliente_demo
nomes/textos da empresa
static data key: gemini_cliente_demo_YYYY-MM-DD
catalog/search tenant: cliente_demo
```

Pontos que precisam ser substituidos no Code node:

```text
'jiw' -> 'cliente_demo'
'JIW - Solucoes tecnologicas' -> 'Cliente Demo'
'Assistente JIW' -> 'Assistente Cliente Demo'
'Equipe JIW' -> 'Equipe Cliente Demo'
```

Importante:

- manter apenas texto;
- nao ativar audio;
- nao ativar imagem;
- nao usar embeddings/vector store;
- manter fallback por regras caso Gemini falhe;
- manter limite diario baixo para apresentacao.

## 7. Configurar variaveis do n8n

No `.env` local ou no ambiente hospedado:

```text
GEMINI_ENABLED=true
GEMINI_API_KEY=[SUA_KEY_GEMINI]
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_DAILY_LIMIT=20
GEMINI_MAX_OUTPUT_TOKENS=220

SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]

TELEGRAM_BOT_TOKEN_CLIENTE_DEMO=[TOKEN_DO_BOT]
```

Para uma apresentacao curta, recomendado:

```text
GEMINI_DAILY_LIMIT=10
GEMINI_MAX_OUTPUT_TOKENS=180
```

Depois reiniciar:

```powershell
docker compose restart n8n
```

## 8. Ajustar Command Router para resposta manual

O Command Router precisa saber qual token usar para o novo tenant.

No workflow:

```text
n8n/workflows/magia_command_router.json
```

Adicionar no `tokenFor`:

```js
if (channelType === 'telegram' && tenantSlug === 'cliente_demo') {
  return env('TELEGRAM_BOT_TOKEN_CLIENTE_DEMO');
}
```

Reimportar/publicar:

```powershell
docker cp n8n\workflows\magia_command_router.json n8n:/tmp/magia_command_router.json
docker exec n8n n8n import:workflow --input=/tmp/magia_command_router.json
docker exec n8n n8n publish:workflow --id=magiaCommandRouter01
docker restart n8n
```

## 9. Importar workflow do cliente

Exemplo:

```powershell
docker cp n8n\workflows\cliente_demo_telegram_real_supabase.json n8n:/tmp/cliente_demo_telegram_real_supabase.json
docker exec n8n n8n import:workflow --input=/tmp/cliente_demo_telegram_real_supabase.json
docker exec n8n n8n publish:workflow --id=clienteDemoTelegramReal01
```

Ativar:

```powershell
@'
update workflow_entity
set active = true
where id in ('clienteDemoTelegramReal01','magiaCommandRouter01');
'@ | docker exec -i n8n_postgres psql -U n8n -d n8n
```

Reiniciar:

```powershell
docker restart n8n
```

Validar:

```sql
select id, active, name
from workflow_entity
where id in ('clienteDemoTelegramReal01','magiaCommandRouter01');
```

## 10. Apontar webhook do Telegram

Para localhost, usar tunel temporario apontando para `localhost:5678`.

URL final do webhook:

```text
https://URL-DO-TUNEL/webhook/telegram-cliente-demo
```

Configurar:

```powershell
$token = "TOKEN_DO_BOT"
$url = "https://URL-DO-TUNEL/webhook/telegram-cliente-demo"
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" -Method Post -Body @{ url = $url }
```

Validar:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
```

Esperado:

```text
url = https://URL-DO-TUNEL/webhook/telegram-cliente-demo
pending_update_count = 0
last_error_message = null
```

## 11. Configurar interface para o tenant

Para a apresentacao local, editar:

```text
app/.env.local
```

Trocar:

```text
VITE_TENANT_SLUG=cliente_demo
VITE_N8N_BASE_URL=http://localhost:5678
```

Subir/reiniciar interface:

```powershell
cd app
npm run dev -- --host 0.0.0.0 --port 5174
```

Acessar:

```text
http://localhost:5174
```

Observacao: no modelo atual, a interface local mostra um tenant por vez via
`VITE_TENANT_SLUG`. Para produto hospedado com login, isso sera resolvido por
usuario/permissao, nao por variavel local.

## 12. Teste antes da apresentacao

Enviar mensagens reais no Telegram:

```text
Oi
Quero saber mais sobre os servicos de voces
Quanto custa?
Preciso falar com um humano
Isso tem relacao com [tema fora de contexto]
```

Validar no Supabase:

```sql
select
  created_at,
  tenant_slug,
  channel_type,
  direction,
  message_text,
  response_text,
  service,
  stage,
  handoff,
  ai_provider,
  ai_model,
  ai_error,
  gemini_daily_limit,
  gemini_used_today_before_request
from channel_events
where tenant_slug = 'cliente_demo'
order by created_at desc
limit 20;
```

Esperado:

```text
tenant_slug = cliente_demo
channel_type = telegram
ai_provider = gemini ou fallback_gemini_error
ai_error vazio quando Gemini funcionar
```

## 13. Roteiro recomendado para apresentacao

1. Abrir interface em `http://localhost:5174`.
2. Mostrar Dashboard vazio ou com primeiros eventos.
3. Enviar mensagem para o bot Telegram.
4. Mostrar a conversa aparecendo na aba Conversas.
5. Mostrar resposta da IA.
6. Enviar pergunta de orcamento.
7. Mostrar que a conversa muda para handoff/atendimento humano.
8. Responder manualmente pela interface.
9. Mostrar Kanban/Funil atualizando.
10. Explicar que o mesmo padrao suporta WhatsApp, Instagram e outros canais.

## 14. Controle de custo durante apresentacao

Configurar limites antes:

```text
GEMINI_ENABLED=true
GEMINI_DAILY_LIMIT=10
GEMINI_MAX_OUTPUT_TOKENS=180
```

Durante a demo:

- evitar audio;
- evitar imagem;
- evitar testes repetidos sem necessidade;
- usar perguntas curtas;
- nao ativar embeddings;
- manter fallback ativo.

Para desligar ao fim:

```text
GEMINI_ENABLED=false
```

Depois:

```powershell
docker compose restart n8n
```

## 15. Checklist final

- [ ] Tenant criado no Supabase.
- [ ] Canal Telegram criado em `channels`.
- [ ] Prompt Gemini criado em `ai_prompt_versions`.
- [ ] Kanban/funil padrao criado.
- [ ] Bot criado no BotFather.
- [ ] Token salvo apenas no n8n/env.
- [ ] Workflow copiado e adaptado.
- [ ] Command Router adaptado para o token do tenant.
- [ ] Workflow importado/publicado/ativo.
- [ ] Webhook Telegram apontado para a URL correta.
- [ ] Interface com `VITE_TENANT_SLUG` do novo cliente.
- [ ] Gemini ligado com limite baixo.
- [ ] Teste ponta a ponta feito antes da reuniao.
> Documento de demo antigo. Para onboarding atual, use
> `docs/operations/onboarding_telegram_multitenant.md` e
> `docs/operations/production_deploy_checklist.md`.
