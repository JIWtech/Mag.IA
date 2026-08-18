# Runbook Local

Este documento descreve como rodar a Mag.IA localmente no estado atual.

## Pre-requisitos

- Docker Desktop aberto.
- Node.js instalado.
- Acesso ao projeto Supabase.
- Token do bot Telegram da JIW.
- Chaves do Supabase:
  - anon key para a interface;
  - service role key apenas para o n8n.

## 1. Entrar na pasta oficial

```powershell
cd C:\Users\wever\Downloads\Setup-Avvento-Local\magia
```

## 2. Configurar variaveis da stack

Se ainda nao existir `.env`:

```powershell
copy .env.example .env
```

Preencher no `.env`:

```text
POSTGRES_PASSWORD
REDIS_PASSWORD
N8N_ENCRYPTION_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN_JIW
EVOLUTION_POSTGRES_PASSWORD
EVOLUTION_API_KEY
```

Para controlar custo, manter:

```text
GEMINI_ENABLED=false
```

Quando for testar IA:

```text
GEMINI_ENABLED=true
GEMINI_API_KEY=sua-chave
GEMINI_DAILY_LIMIT=20
GEMINI_MAX_OUTPUT_TOKENS=220
```

## 3. Configurar variaveis da interface

```powershell
cd app
copy .env.example .env.local
```

Preencher:

```text
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
VITE_N8N_BASE_URL=http://localhost:5678
VITE_TENANT_SLUG=jiw
```

Voltar para a raiz:

```powershell
cd ..
```

## 4. Subir Docker

```powershell
docker compose up -d
```

Validar:

```powershell
docker ps
```

Containers esperados:

```text
n8n
n8n_postgres
n8n_redis
evolution_api
evolution_postgres
```

## 5. Importar workflows no n8n

Com o container `n8n` ligado:

```powershell
docker cp n8n\workflows\jiw_telegram_real_supabase.json n8n:/tmp/jiw_telegram_real_supabase.json
docker cp n8n\workflows\magia_command_router.json n8n:/tmp/magia_command_router.json

docker exec n8n n8n import:workflow --input=/tmp/jiw_telegram_real_supabase.json
docker exec n8n n8n import:workflow --input=/tmp/magia_command_router.json

docker exec n8n n8n publish:workflow --id=jiwTelegramReal01
docker exec n8n n8n publish:workflow --id=magiaCommandRouter01
```

Ativar pelo editor do n8n ou via banco local:

```powershell
@'
update workflow_entity
set active = true
where id in ('jiwTelegramReal01','magiaCommandRouter01');
'@ | docker exec -i n8n_postgres psql -U n8n -d n8n
```

Reiniciar n8n depois de importar/publicar:

```powershell
docker restart n8n
```

## 6. Rodar migrations no Supabase

No SQL Editor do Supabase, executar nesta ordem:

```text
supabase/migrations/001_core_multi_tenant.sql
supabase/migrations/002_production_hardening.sql
supabase/migrations/003_channel_events.sql
supabase/migrations/004_ai_usage_channel_events.sql
supabase/migrations/005_tenant_service_catalog.sql
supabase/migrations/006_frontend_read_policies_jiw.sql
supabase/migrations/007_realtime_manual_replies.sql
supabase/seeds/jiw_seed.sql
supabase/seeds/jiw_service_catalog_seed.sql
```

Validar catalogo JIW:

```sql
select count(*)
from tenant_service_catalog c
join tenants t on t.id = c.tenant_id
where t.slug = 'jiw';
```

Esperado no estado atual: `56`.

## 7. Subir interface

```powershell
cd app
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Acessar:

```text
http://localhost:5174
```

## 8. Configurar Telegram local

Para ambiente local, o Telegram precisa alcancar seu n8n. Use uma URL publica
temporaria apontando para `localhost:5678`, por exemplo localhost.run.

Depois configure o webhook do Telegram para:

```text
https://URL-DO-TUNEL/webhook/telegram-jiw-real
```

Validar webhook:

```powershell
$token = "TOKEN_DO_BOT"
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
```

O resultado ideal:

```text
pending_update_count = 0
last_error_message = null
```

## 9. Teste ponta a ponta

1. Enviar mensagem para o bot da JIW no Telegram.
2. Conferir se o bot responde.
3. Abrir `http://localhost:5174`.
4. Ir em Conversas.
5. Selecionar a conversa.
6. Enviar resposta manual pela interface.
7. Confirmar que a mensagem chegou no Telegram.
8. Confirmar que apareceu no Supabase como `direction = outbound`.

Consulta de validacao:

```sql
select direction, sender_type, channel_type, external_conversation_id, message_text, delivery_status, created_at
from channel_events
where tenant_slug = 'jiw'
order by created_at desc
limit 20;
```

## 10. Teste local do Instagram sem token Meta

O workflow de Instagram pode ser validado localmente com payload simulado. Esse
teste grava no Supabase e aparece na interface, mas nao envia DM real enquanto
`INSTAGRAM_PAGE_ACCESS_TOKEN_JIW` nao estiver configurado.

Webhook local:

```text
POST http://localhost:5678/webhook/instagram-jiw
```

Payload minimo:

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "jiwtech",
      "messaging": [
        {
          "sender": { "id": "ig_test_user_001" },
          "recipient": { "id": "jiwtech" },
          "message": {
            "mid": "ig_mid_test_001",
            "text": "Oi, preciso de suporte para minha empresa"
          }
        }
      ]
    }
  ]
}
```

Resultado esperado:

```text
channel_type = instagram
direction = inbound
service = suporte_ti
stage = Suporte tecnico
```

## 11. Checagem automatica local

Na raiz `magia`:

```powershell
.\scripts\check_local_status.ps1
```
