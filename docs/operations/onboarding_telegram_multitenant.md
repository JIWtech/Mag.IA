# Onboarding Telegram Multi-tenant

Objetivo: cadastrar um novo cliente na Mag.IA usando a mesma interface, o mesmo
n8n e o mesmo Supabase, isolando tudo por `tenant_slug`.

Este e o fluxo oficial para os primeiros clientes em teste.

## Estado atual da arquitetura

```text
Interface: uma aplicacao React/Vite para todos os clientes
Banco: Supabase compartilhado multi-tenant
n8n: workflow unico para Telegram
IA: Gemini por tenant, com limite diario por ambiente
Canal inicial: Telegram
Isolamento: tenant_slug nas mensagens + tenant_members para usuarios
```

Endpoint n8n padrao para Telegram:

```text
POST /webhook/telegram?tenant_slug=slug_do_cliente
```

Exemplo local:

```text
http://localhost:5678/webhook/telegram?tenant_slug=jiw
```

Exemplo hospedado:

```text
https://n8n.seudominio.com/webhook/telegram?tenant_slug=jiw
```

## 1. Coletar dados do cliente

Antes de configurar:

```text
Nome oficial da empresa:
Slug do tenant:
Segmento:
Servicos/produtos principais:
Horario de atendimento:
Tom de voz:
Quando chamar humano:
Nome do responsavel:
Email do responsavel:
Nome do bot Telegram:
Username do bot Telegram:
```

Padrao do slug:

```text
somente minusculas
sem espaco
sem acento
preferir letras, numeros, _ ou -
```

Exemplos:

```text
jiw
clinica_santos
studio_ana
acme_ti
```

## 2. Criar o bot no BotFather

No Telegram, abrir:

```text
@BotFather
```

Criar:

```text
/newbot
```

Guardar o token com nome de ambiente padronizado:

```text
TELEGRAM_BOT_TOKEN_SLUG_EM_CAIXA_ALTA
```

Exemplos:

```text
TELEGRAM_BOT_TOKEN_JIW
TELEGRAM_BOT_TOKEN_CLINICA_SANTOS
TELEGRAM_BOT_TOKEN_STUDIO_ANA
TELEGRAM_BOT_TOKEN_BRONZEAMENTO_DOM_IAN
```

Nunca colocar token no frontend, em documento publico ou em print de
apresentacao.

## 3. Criar tenant no Supabase

Rodar as migrations oficiais antes do onboarding:

```text
supabase/migrations/001_core_multi_tenant.sql
supabase/migrations/002_production_hardening.sql
supabase/migrations/003_channel_events.sql
supabase/migrations/004_ai_usage_channel_events.sql
supabase/migrations/005_tenant_service_catalog.sql
supabase/migrations/006_frontend_read_policies_jiw.sql
supabase/migrations/007_realtime_manual_replies.sql
supabase/migrations/008_auth_multi_tenant_policies.sql
```

Para um novo cliente, adaptar e executar:

Arquivo pronto para usar como base:

```text
supabase/seeds/new_tenant_telegram_template.sql
```

```sql
with tenant_upsert as (
  insert into tenants (slug, name, industry, plan, status)
  values (
    'slug_do_cliente',
    'Nome do Cliente',
    'Segmento do Cliente',
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
  select id from tenants where slug = 'slug_do_cliente'
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
  'Nao consegui relacionar sua mensagem ao atendimento da empresa. Pode reformular dentro do contexto dos servicos oferecidos?',
  'Vou encaminhar seu atendimento para uma pessoa da equipe continuar com voce.',
  '{
    "language": "pt-BR",
    "tone": "consultivo, objetivo e profissional",
    "primary_channel": "telegram",
    "service_categories": ["atendimento", "vendas", "suporte", "agendamento"]
  }'::jsonb
from tenant_ref
where not exists (
  select 1
  from tenant_settings s
  where s.tenant_id = tenant_ref.id
);
```

## 4. Cadastrar o canal Telegram

Adaptar `slug_do_cliente` e `username_do_bot`:

```sql
insert into channels (tenant_id, type, name, external_id, status, config)
select
  id,
  'telegram',
  'Telegram',
  'username_do_bot',
  'active',
  jsonb_build_object(
    'webhook_path', '/webhook/telegram?tenant_slug=slug_do_cliente',
    'token_env', 'TELEGRAM_BOT_TOKEN_SLUG_EM_CAIXA_ALTA'
  )
from tenants
where slug = 'slug_do_cliente'
on conflict (tenant_id, type, external_id) do update
  set status = excluded.status,
      config = excluded.config,
      updated_at = now();
```

## 5. Configurar prompt e agente IA

O prompt deve ficar no Supabase, nao fixo no node do n8n.

```sql
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
from tenants
where slug = 'slug_do_cliente'
  and not exists (
    select 1
    from ai_agents existing
    where existing.tenant_id = tenants.id
      and existing.name = 'Atendente principal'
  );

insert into ai_prompt_versions (
  tenant_id,
  ai_agent_id,
  version,
  active,
  prompt
)
select
  t.id,
  a.id,
  1,
  true,
  'Voce e o assistente virtual da Nome do Cliente. Atenda em portugues do Brasil, entenda a necessidade do contato, responda de forma natural e objetiva, faca no maximo 2 ou 3 perguntas por mensagem e solicite atendimento humano quando houver pedido de orcamento, urgencia, reclamacao ou duvida que exija decisao comercial. Nao invente precos, prazos, garantias ou disponibilidade.'
from tenants t
join ai_agents a on a.tenant_id = t.id and a.name = 'Atendente principal'
where t.slug = 'slug_do_cliente'
on conflict (ai_agent_id, version) do update
  set prompt = excluded.prompt,
      active = excluded.active,
      created_at = now();
```

## 6. Criar usuario de acesso

Criar o usuario no Supabase Auth e depois vincular ao tenant:

```sql
insert into tenant_members (tenant_id, user_id, role, status)
select
  t.id,
  'UUID_DO_USUARIO_AUTH',
  'owner',
  'active'
from tenants t
where t.slug = 'slug_do_cliente'
on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      updated_at = now();
```

Valores validos:

```text
tenant_members.role: owner, admin, manager, agent, operator, viewer
tenant_members.status: invited, active, suspended, removed
```

## 7. Configurar variaveis do n8n

No `.env` do ambiente do n8n:

```text
GEMINI_ENABLED=true
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_DAILY_LIMIT=5
GEMINI_MAX_OUTPUT_TOKENS=300
GEMINI_API_KEY=...

TELEGRAM_BOT_TOKEN_SLUG_EM_CAIXA_ALTA=...
```

Depois reiniciar o n8n:

```powershell
docker compose -p setup-avvento-local --env-file .env -f docker-compose.yml restart n8n
```

## 8. Importar/publicar workflows oficiais

Gerar workflow Telegram:

```powershell
node scripts\build_telegram_multitenant_workflow.js
```

Importar no n8n local:

```powershell
docker cp n8n\workflows\magia_telegram_multitenant.json n8n:/tmp/magia_telegram_multitenant.json
docker exec n8n n8n import:workflow --input=/tmp/magia_telegram_multitenant.json
docker exec n8n n8n publish:workflow --id=magiaTelegramMultiTenant01
```

Importar Command Router:

```powershell
docker cp n8n\workflows\magia_command_router.json n8n:/tmp/magia_command_router.json
docker exec n8n n8n import:workflow --input=/tmp/magia_command_router.json
docker exec n8n n8n publish:workflow --id=magiaCommandRouter01
```

Reiniciar:

```powershell
docker compose -p setup-avvento-local --env-file .env -f docker-compose.yml restart n8n
```

Validar webhooks:

```sql
select "webhookPath", method, node, "workflowId"
from webhook_entity
where "workflowId" in ('magiaTelegramMultiTenant01', 'magiaCommandRouter01');
```

Resultado esperado:

```text
telegram       POST  magiaTelegramMultiTenant01
magia-command  POST  magiaCommandRouter01
```

## 9. Apontar webhook no Telegram

Com URL publica HTTPS do n8n:

```text
https://api.telegram.org/botTOKEN_DO_BOT/setWebhook?url=https://n8n.seudominio.com/webhook/telegram?tenant_slug=slug_do_cliente
```

Validar:

```text
https://api.telegram.org/botTOKEN_DO_BOT/getWebhookInfo
```

O `url` retornado precisa apontar para o tenant correto.

## 10. Configurar interface

Local sem login:

```text
VITE_REQUIRE_AUTH=false
VITE_TENANT_SLUG=slug_do_cliente
VITE_N8N_BASE_URL=http://localhost:5678
```

Local com seletor por URL:

```text
http://localhost:5174/?tenant=slug_do_cliente
```

Producao com login:

```text
VITE_REQUIRE_AUTH=true
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_N8N_BASE_URL=https://n8n.seudominio.com
```

## 11. Teste ponta a ponta

Enviar mensagem pelo Telegram do cliente:

```text
Oi, quero entender como funciona o atendimento
```

Validar:

```text
1. Bot respondeu no Telegram.
2. Mensagem apareceu na aba Conversas.
3. Card/conversa ficou no tenant correto.
4. Envio manual pela interface funcionou.
5. Registro apareceu em channel_events com tenant_slug correto.
6. ai_provider ficou gemini, fallback_daily_limit ou fallback_gemini_error.
```

Se `ai_provider = fallback_gemini_error` e o erro citar quota, o problema esta
no limite da API Gemini, nao no n8n.

## 12. Criterio de pronto para teste do cliente

O cliente pode testar quando:

```text
tenant criado
bot Telegram criado
token no .env do n8n
workflow Telegram publicado
Command Router publicado
webhook do Telegram apontado para URL publica
usuario do cliente criado no Supabase Auth
tenant_members com status active
interface hospedada com VITE_REQUIRE_AUTH=true
mensagem real validada de ponta a ponta
```
