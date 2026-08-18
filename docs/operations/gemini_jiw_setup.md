# Gemini no workflow JIW

## Estado

- Workflow: `jiwTelegramReal01`
- Canal: Telegram
- IA: instalada no workflow, desligada por padrao
- Fallback: regras locais continuam respondendo se Gemini estiver desligado, sem key, com erro ou acima do limite diario

## Controle de custo

Variaveis no `.env`:

```text
GEMINI_ENABLED=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_DAILY_LIMIT=20
GEMINI_MAX_OUTPUT_TOKENS=220
```

Para teste inicial economico:

```text
GEMINI_ENABLED=true
GEMINI_DAILY_LIMIT=5
GEMINI_MAX_OUTPUT_TOKENS=180
```

## Como ativar localmente

1. Editar `.env`.
2. Preencher `GEMINI_API_KEY`.
3. Trocar `GEMINI_ENABLED=false` para `GEMINI_ENABLED=true`.
4. Reduzir `GEMINI_DAILY_LIMIT` para `5` no primeiro teste.
5. Reiniciar n8n:

```powershell
docker compose restart n8n
```

6. Testar no Telegram com poucas mensagens.

## Como desligar imediatamente

Editar `.env`:

```text
GEMINI_ENABLED=false
```

Reiniciar:

```powershell
docker compose restart n8n
```

## Supabase

Antes de testar com IA, executar:

```text
magia/supabase/migrations/004_ai_usage_channel_events.sql
```

Validar eventos:

```sql
select
  created_at,
  tenant_slug,
  message_text,
  response_text,
  ai_provider,
  ai_model,
  ai_error,
  ai_usage,
  gemini_daily_limit,
  gemini_used_today_before_request
from channel_events
where tenant_slug = 'jiw'
order by created_at desc
limit 20;
```

## Observacoes

- Nao usar imagem, audio, embeddings ou busca Google no teste inicial.
- O prompt e curto para reduzir tokens.
- O output fica limitado por `GEMINI_MAX_OUTPUT_TOKENS`.
- O contador diario e controlado por static data do workflow no n8n local.

Fontes:

- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/pricing
- https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/task-runners
