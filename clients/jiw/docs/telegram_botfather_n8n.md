# Guia JIW - Bot Telegram + n8n

Atualizado em: 2026-07-28

## Objetivo

Criar o primeiro bot funcional da plataforma Mag.ia para o cliente:

```text
JIW - Solucoes tecnologicas
Canal inicial: Telegram
Tenant slug: jiw
Webhook n8n: /webhook/telegram-jiw
```

O bot deve atender empresas interessadas em:

- desenvolvimento de sistemas;
- sites e landing pages;
- automacoes;
- suporte de TI;
- infraestrutura;
- trafego pago;
- social media;
- consultoria digital.

## 1. Criar o bot no BotFather

No Telegram, abra:

```text
@BotFather
```

Execute:

```text
/newbot
```

Sugestao de nome:

```text
JIW Solucoes Tecnologicas
```

Sugestao de username:

```text
jiw_solucoes_bot
```

Observacao:

- o username precisa terminar com `bot`;
- se esse nome ja estiver em uso, testar variacoes como:
  - `jiw_tecnologia_bot`
  - `jiw_solucoes_digitais_bot`
  - `jiw_atendimento_bot`

Ao final, o BotFather entregara um token no formato:

```text
1234567890:AA...
```

Esse token nao deve ser colocado em arquivo versionado.

## 2. Onde guardar o token em desenvolvimento

Para teste local com n8n Docker, a forma mais simples e adicionar no `.env` do projeto:

```env
JIW_TELEGRAM_BOT_TOKEN=COLE_O_TOKEN_AQUI
```

Depois reiniciar o n8n:

```powershell
docker compose restart n8n
```

O workflow `Mag.ia/JIW - Telegram Atendimento MOCK` foi preparado para ler:

```text
$env.JIW_TELEGRAM_BOT_TOKEN
```

## 3. URL publica temporaria para testar local

O Telegram precisa chamar uma URL publica HTTPS.

Como ainda nao vamos hospedar, usar tunel temporario.

Exemplo com ngrok:

```powershell
ngrok http 5678
```

Exemplo de URL gerada:

```text
https://abc123.ngrok-free.app
```

Webhook final:

```text
https://abc123.ngrok-free.app/webhook/telegram-jiw
```

## 4. Configurar webhook no Telegram

Substitua:

- `TOKEN_DO_BOT`
- `URL_PUBLICA`

Comando:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/botTOKEN_DO_BOT/setWebhook" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"URL_PUBLICA/webhook/telegram-jiw"}'
```

Exemplo:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/bot123456:ABC/setWebhook" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"https://abc123.ngrok-free.app/webhook/telegram-jiw"}'
```

Conferir webhook:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/botTOKEN_DO_BOT/getWebhookInfo"
```

## 5. Testes iniciais

Enviar mensagens para o bot:

```text
Oi
```

Resposta esperada:

```text
Ola! Sou o assistente da JIW - Solucoes tecnologicas...
```

Teste de software:

```text
Preciso criar um sistema para minha empresa
```

Teste de suporte:

```text
Meu computador esta sem internet e preciso de suporte urgente
```

Teste de marketing:

```text
Quero trafego pago e social media para minha loja
```

Teste de orcamento:

```text
Quanto custa para fazer uma landing page?
```

Teste fora de contexto:

```text
Me passa uma receita de bolo
```

## 6. Estado atual do workflow

Workflow preparado:

```text
Mag.ia/JIW - Telegram Atendimento MOCK
Arquivo: workflow-jiw-telegram-mock.json
Webhook: telegram-jiw
```

Comportamento:

- recebe updates do Telegram;
- ignora mensagens sem texto;
- normaliza contato, chat e mensagem;
- classifica assunto por regras simples;
- responde pelo proprio webhook do Telegram com `method: sendMessage`;
- nao usa IA paga;
- nao depende de OpenAI/Gemini;
- ainda nao grava em Supabase nesta primeira versao.

## 7. Proxima evolucao

Depois do primeiro teste real:

1. Gravar contato/conversa/mensagem no Supabase.
2. Aplicar automacoes reais do tenant JIW.
3. Exibir conversas JIW na interface Mag.ia.
4. Adicionar Gemini/OpenAI quando houver credito.
5. Criar handoff humano.
6. Criar painel para editar prompt JIW.

## Fontes oficiais

- BotFather e criacao de bots: https://core.telegram.org/bots/features#botfather
- Telegram Bot API `setWebhook`: https://core.telegram.org/bots/api#setwebhook
