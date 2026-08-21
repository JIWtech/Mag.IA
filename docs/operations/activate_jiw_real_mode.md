# Ativar modo real da JIW

## Objetivo

Trocar o bot JIW do modo MOCK simples para modo REAL com persistencia inicial em Supabase.

## Estado seguro atual

Workflow ativo:

```text
jiwTelegramMock01
Mag.ia/JIW - Telegram Atendimento MOCK
Webhook: /webhook/telegram-jiw
```

Workflow real preparado, mas inativo:

```text
jiwTelegramReal01
Mag.IA/JIW - Telegram Atendimento REAL
Webhook: /webhook/telegram-jiw-real
```

## 1. Executar migrations no Supabase

No Supabase SQL Editor, executar nesta ordem:

```text
magia/supabase/migrations/001_core_multi_tenant.sql
magia/supabase/migrations/002_production_hardening.sql
magia/supabase/migrations/003_channel_events.sql
magia/supabase/seeds/jiw_seed.sql
```

## 2. Testar workflow real sem trocar Telegram

Com o n8n local ativo:

```powershell
docker exec n8n n8n publish:workflow --id=jiwTelegramReal01
docker compose restart n8n
```

Testar localmente:

```powershell
Invoke-RestMethod -Uri "http://localhost:5678/webhook/telegram-jiw-real" `
  -Method Post `
  -ContentType "application/json" `
  -InFile "telegram-jiw-test-payload.json"
```

Conferir no Supabase:

```sql
select *
from channel_events
where tenant_slug = 'jiw'
order by created_at desc
limit 20;
```

## 3. Trocar webhook real do Telegram

Quando o workflow real estiver salvando corretamente:

```text
URL_PUBLICA/webhook/telegram-jiw-real
```

Executar `setWebhook` no Telegram apontando para o caminho real.

## 4. Rollback

Se algo falhar:

```text
URL_PUBLICA/webhook/telegram-jiw
```

Voltar o Telegram para o webhook MOCK.

## 5. Proxima evolucao

Depois do `channel_events` funcionando:

1. Materializar eventos em `contacts`.
2. Materializar eventos em `conversations`.
3. Materializar mensagens em `messages`.
4. Atualizar kanban/funil real.
5. Ativar IA paga com budget por tenant.
> Documento legado do piloto JIW. Nao usar como runbook de producao.
> O fluxo oficial atual e `magia_telegram_multitenant.json` em
> `/webhook/telegram?tenant_slug=slug_do_cliente`.
