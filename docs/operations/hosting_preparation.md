# Preparacao Para Hospedagem

Objetivo: deixar a JIW operando como piloto real, sem depender do computador
local ou de tunel temporario.

## Arquitetura minima do piloto

```text
app.magia.com.br       -> frontend estatico
n8n.magia.com.br       -> n8n self-hosted
Supabase               -> banco multi-tenant
Telegram Bot API       -> canal JIW
Instagram Graph API    -> DM Instagram JIW
Gemini API             -> IA, quando ativada
Evolution API          -> preparado para WhatsApp futuro
```

## Decisao de VPS

Decisao registrada: usaremos uma VPS Hetzner Cloud como primeira infraestrutura
publica fixa da Mag.IA.

Plano inicial recomendado:

```text
Fornecedor: Hetzner Cloud
Plano: CX23
Recursos: 2 vCPU, 4 GB RAM, 40 GB SSD
Uso: n8n publico, webhooks, Redis e Postgres operacional do n8n
Escopo: JIW piloto + proximos clientes iniciais de baixo/medio volume
```

Nao criaremos uma VPS por cliente nesta fase. A VPS sera compartilhada pela
operacao Mag.IA, com separacao por tenant no Supabase e nos workflows.

Gatilhos para upgrade:

```text
RAM acima de 75% com frequencia
n8n lento ou filas acumulando
mais de 5 clientes ativos com volume real
mais de 2.000 a 5.000 mensagens/dia
uso relevante de WhatsApp/Evolution por varios clientes
```

Quando isso acontecer, o upgrade natural e CX33 ou separacao de Evolution em
outra VPS.

## Ordem recomendada

1. Contratar VPS pequena para n8n.
2. Apontar dominio/subdominio para a VPS.
3. Subir Docker na VPS.
4. Copiar pasta `magia` para a VPS.
5. Criar `.env` de producao baseado em `.env.example`.
6. Configurar `WEBHOOK_URL=https://n8n.seudominio.com/`.
7. Subir n8n com `docker compose up -d`.
8. Importar/publicar workflows oficiais.
9. Configurar webhook do Telegram para a URL fixa.
10. Hospedar frontend estatico.
11. Configurar variaveis do frontend hospedado.
12. Ativar Gemini com limite diario baixo.
13. Fazer teste final com conversa real.

## Variaveis criticas no n8n hospedado

```text
N8N_PROTOCOL=https
N8N_HOST=n8n.seudominio.com
N8N_EDITOR_BASE_URL=https://n8n.seudominio.com/
WEBHOOK_URL=https://n8n.seudominio.com/
N8N_ENCRYPTION_KEY=valor-fixo-e-guardado
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=anon-key
SUPABASE_SERVICE_ROLE_KEY=service-role-key
TELEGRAM_BOT_TOKEN_{TENANT_SLUG_EM_CAIXA_ALTA}=token-do-bot
GEMINI_ENABLED=false
GEMINI_API_KEY=
```

Quando ativar IA:

```text
GEMINI_ENABLED=true
GEMINI_DAILY_LIMIT=20
GEMINI_MAX_OUTPUT_TOKENS=220
```

## Variaveis criticas no frontend hospedado

```text
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=anon-key
VITE_N8N_BASE_URL=https://n8n.seudominio.com
VITE_TENANT_SLUG=jiw
```

## Build do frontend

```powershell
cd app
npm install
npm run build
```

Publicar a pasta:

```text
app/dist
```

## Checklist de go-live

- [ ] Supabase com migrations 001 a 007 aplicadas.
- [ ] Seeds da JIW aplicados.
- [ ] n8n com dominio HTTPS fixo.
- [ ] `WEBHOOK_URL` definitivo configurado.
- [ ] Workflows `magia_telegram_multitenant` e `magia_command_router` importados, publicados e ativos.
- [ ] Telegram apontando para `/webhook/telegram?tenant_slug=slug_do_cliente`.
- [ ] Instagram/Meta ainda nao publicado como canal principal ate existir adapter multi-tenant oficial.
- [ ] Interface hospedada apontando para Supabase e n8n corretos.
- [ ] Resposta manual pela interface testada.
- [ ] Gemini ativado com limite baixo ou mantido desligado.
- [ ] Backup do volume n8n/Postgres definido.
- [ ] Monitoramento basico de uptime ativo.

## Observacao de custo

Para os 10 primeiros clientes, manter:

- um Supabase compartilhado multi-tenant;
- um n8n self-hosted;
- um frontend estatico;
- IA com limites por tenant;
- sem audio, imagem ou embeddings no MVP.

Isso reduz custo fixo e evita complexidade operacional precoce.
