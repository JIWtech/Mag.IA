# Conversas em tempo real e respostas manuais

## Objetivo

Tornar a aba Conversas operacional para qualquer tenant/canal suportado pela Mag.IA.

A JIW usa Telegram como piloto, mas o contrato de dados e comandos e generico:

```text
tenant_slug
channel_type
external_conversation_id
message_text
```

## Frontend

Arquivo principal:

```text
magia/app/src/main.jsx
```

Capacidades:

- assina eventos Supabase Realtime em `channel_events`;
- recarrega dados com debounce curto;
- permite resposta manual pela conversa selecionada;
- envia comando generico para o n8n via `/webhook/magia-command`.

## Backend n8n

Workflow:

```text
magiaCommandRouter01
Mag.IA/Core - Command Router
POST /webhook/magia-command
```

Comando inicial:

```json
{
  "tenant_slug": "jiw",
  "command": "manual_reply",
  "payload": {
    "channel_type": "telegram",
    "external_conversation_id": "CHAT_ID",
    "message_text": "Mensagem manual",
    "sent_by_user": "Operador Mag.IA"
  }
}
```

## Supabase

Rodar:

```text
magia/supabase/migrations/007_realtime_manual_replies.sql
```

Essa migration:

- adiciona metadados de envio manual em `channel_events`;
- habilita publicação Realtime da tabela;
- cria índice por conversa;
- cria idempotência por `command_id`.

## Variáveis do n8n

Arquivo:

```text
.env
```

Obrigatórias para resposta manual:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=SUA_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN_{TENANT_SLUG_EM_CAIXA_ALTA}=TOKEN_DO_BOT
EVOLUTION_API_URL_{TENANT_SLUG_EM_CAIXA_ALTA}=https://SEU-DOMINIO-EVOLUTION
EVOLUTION_API_KEY_{TENANT_SLUG_EM_CAIXA_ALTA}=CHAVE_DA_EVOLUTION
EVOLUTION_INSTANCE_{TENANT_SLUG_EM_CAIXA_ALTA}=NOME_DA_INSTANCIA
```

Importante:

- `SUPABASE_SERVICE_ROLE_KEY` fica apenas no n8n.
- `TELEGRAM_BOT_TOKEN_{TENANT}` fica apenas no n8n.
- `EVOLUTION_API_KEY` fica apenas no n8n.
- Nunca usar essas chaves na interface.

Depois de editar:

```powershell
docker compose restart n8n
```

## Teste

1. Abrir `http://localhost:5174`.
2. Ir em Conversas.
3. Selecionar uma conversa Telegram real.
4. Enviar resposta manual.
5. Confirmar que:
   - a mensagem chegou no Telegram;
   - um evento `direction = outbound` foi salvo em `channel_events`;
   - a interface atualizou sem refresh manual.

## Proximos canais

Para novos canais, o fluxo permanece o mesmo. O Command Router deve ganhar apenas um handler por `channel_type`:

- `telegram`
- `whatsapp`
- `instagram`
- `webchat`
