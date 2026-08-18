# Instagram DM JIW

Objetivo: conectar o Instagram da JIW na Mag.IA usando o mesmo contrato de dados
ja usado pelo Telegram.

## Decisao tecnica

Nao usaremos login e senha do Instagram dentro do n8n, frontend ou arquivos do
projeto. Para operacao real, o canal deve usar a API oficial da Meta:

```text
Instagram Professional Account
Facebook Page vinculada
Meta App
Webhook Messenger/Instagram
Page Access Token
```

O login da conta serve apenas para administracao manual no Instagram/Meta.
Credenciais reais devem ficar em cofre/variaveis de ambiente.

## Workflow oficial

```text
Arquivo: n8n/workflows/jiw_instagram_real_supabase.json
Workflow: Mag.IA/JIW - Instagram Atendimento REAL
ID: jiwInstagramReal01
GET/POST: /webhook/instagram-jiw
```

O fluxo:

```text
Instagram DM
-> Webhook Meta
-> n8n
-> normaliza evento
-> salva em channel_events
-> responde DM por Graph API se houver token
-> interface atualiza a aba Conversas
```

## Variaveis necessarias no n8n

```text
INSTAGRAM_VERIFY_TOKEN_JIW=token-de-verificacao-criado-por-nos
INSTAGRAM_PAGE_ACCESS_TOKEN_JIW=[TOKEN_DA_META]
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
```

## Variaveis da interface

Nao muda nada para Instagram. A interface ja le `channel_events` por tenant:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_N8N_BASE_URL=
VITE_TENANT_SLUG=jiw
```

## Configuracao na Meta

Quando o n8n estiver em URL publica fixa:

```text
Callback URL: https://n8n.seudominio.com/webhook/instagram-jiw
Verify Token: mesmo valor de INSTAGRAM_VERIFY_TOKEN_JIW
```

Eventos iniciais:

```text
messages
messaging_postbacks
```

Para o MVP, priorizar mensagens de texto. Audio, imagem e video serao
registrados como evento recebido, mas nao serao processados por IA nesta etapa.

## Resposta manual pela interface

A aba Conversas envia:

```json
{
  "command": "manual_reply",
  "tenant_slug": "jiw",
  "payload": {
    "channel_type": "instagram",
    "external_conversation_id": "PSID_DO_CONTATO",
    "message_text": "Mensagem do operador"
  }
}
```

O Command Router usa `INSTAGRAM_PAGE_ACCESS_TOKEN_JIW` para enviar a DM e salva
um evento `direction = outbound` em `channel_events`.

## Estado atual

- Workflow antigo de Instagram preservado em `archive/legacy-instagram`.
- Workflow oficial Mag.IA criado sem OpenAI, embeddings ou vector store.
- Interface preparada para exibir Telegram e Instagram na mesma aba.
- Pendente obter/configurar token oficial da Meta.
