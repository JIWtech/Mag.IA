# Checklist de Producao Mag.IA

Use este checklist antes de publicar ou atualizar a versao em producao.

## Supabase

1. Rodar todas as migrations de `001` a `013`.
2. Confirmar que `tenant_members` e a tabela oficial de vinculo usuario/tenant.
3. Confirmar que cada usuario do painel tem uma linha ativa em `tenant_members`.
4. Confirmar que `channel_events` esta na publication `supabase_realtime`.
5. Confirmar que policies antigas `jiw_*` foram removidas pela migration `013`.

## n8n

Importar e ativar somente estes workflows principais:

```text
n8n/workflows/magia_telegram_multitenant.json
n8n/workflows/magia_command_router.json
```

Nao usar `jiw_*.json` como fluxo principal. Eles ficam apenas como historico do
piloto.

Variaveis obrigatorias no n8n:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_ENABLED
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_DAILY_LIMIT
GEMINI_MAX_OUTPUT_TOKENS
GEMINI_TIMEOUT_MS
TELEGRAM_BOT_TOKEN_{TENANT_SLUG_EM_CAIXA_ALTA}
TELEGRAM_MEDIA_BUCKET=channel-media
TELEGRAM_MEDIA_MAX_BYTES=10485760
```

Exemplo para `bronzeamento_dom_ian`:

```text
TELEGRAM_BOT_TOKEN_BRONZEAMENTO_DOM_IAN
```

## Interface

Variaveis obrigatorias no deploy da interface:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_N8N_BASE_URL
VITE_REQUIRE_AUTH=true
```

Nao publicar a interface com `VITE_REQUIRE_AUTH=false`.

## Telegram

Para cada bot de cliente, configurar webhook apontando para o fluxo multi-tenant:

```text
https://SEU_N8N/webhook/telegram?tenant_slug=slug_do_cliente
```

O token do bot fica somente no n8n, na variavel:

```text
TELEGRAM_BOT_TOKEN_SLUG_DO_CLIENTE_EM_CAIXA_ALTA
```

## Validacao Final

1. Entrar na interface com um usuario real do Supabase Auth.
2. Confirmar que ele enxerga apenas os tenants vinculados.
3. Enviar mensagem para o bot Telegram do tenant.
4. Confirmar que a conversa aparece sem atualizar a pagina.
5. Responder manualmente pela interface.
6. Confirmar que a resposta chega no Telegram e salva em `channel_events`.
7. Confirmar que o prompt usado vem do Supabase, nao hardcoded no workflow.
8. Enviar uma imagem pequena; confirmar `raw_payload.media.status = stored` e que o objeto foi criado no bucket privado `channel-media`.
