# Mag.IA

Plataforma multi-tenant de atendimento, automacao e IA para empresas.

Esta e a pasta oficial do projeto. Todo arquivo necessario para desenvolvimento,
operacao local, workflows n8n, Supabase, cliente piloto e preparacao de hospedagem
deve ficar aqui.

## Estado Atual

Estado operacional atual:

```text
Modelo: SaaS multi-tenant
Canais ativos no core: Telegram e envio manual pela interface
IA: Gemini por tenant via configuracao no Supabase
Interface local: http://localhost:5174
n8n local: http://localhost:5678
Supabase: remoto, multi-tenant
```

O que ja esta funcional localmente:

- interface React/Vite da Mag.IA;
- leitura real de conversas via Supabase;
- atualizacao da aba Conversas via Realtime com polling de apoio;
- envio manual pela interface para Telegram;
- workflow n8n multi-tenant para receber mensagens Telegram;
- workflow n8n generico `Mag.IA/Core - Command Router` para comandos da interface;
- prompts, configuracoes de IA e dados por cliente via Supabase;
- tabela `channel_events` recebendo mensagens de entrada e saida.

Em producao, use os workflows oficiais:

```text
n8n/workflows/magia_telegram_multitenant.json
n8n/workflows/magia_command_router.json
```

Os arquivos `jiw_*.json` sao legado/historico do piloto e nao devem ser
importados como fluxo principal de producao.

## Estrutura Oficial

```text
magia/
  app/                    Interface web Mag.IA
  clients/jiw/            Artefatos e documentacao do cliente piloto
  docs/                   Documentacao oficial do produto
  infra/                  Infra local e arquivos de hospedagem
  n8n/workflows/          Workflows oficiais exportados
  scripts/                Scripts de apoio operacional
  supabase/               Migrations e seeds
  archive/                Historico e material legado preservado
```

## Inicio Rapido Local

1. Configure os arquivos de ambiente:

```powershell
copy .env.example .env
copy app\.env.example app\.env.local
```

2. Preencha as variaveis obrigatorias em `.env` e `app/.env.local`.

3. Suba a stack local:

```powershell
docker compose up -d
```

4. Suba a interface:

```powershell
cd app
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

5. Acesse:

```text
Interface: http://localhost:5174
n8n:       http://localhost:5678
```

Para o passo a passo completo, use:

```text
docs/operations/local_runbook.md
```

## Documentos Principais

- `docs/INDEX.md`
- `docs/status/current_project_state.md`
- `docs/operations/versioning_workflow.md`
- `docs/operations/local_runbook.md`
- `docs/operations/hosting_preparation.md`
- `docs/operations/production_deploy_checklist.md`
- `docs/operations/realtime_conversations_manual_replies.md`
- `docs/operations/broadcasts_and_appointments.md`
- `docs/operations/gemini_jiw_setup.md`
- `docs/operations/instagram_jiw_setup.md`
- `docs/architecture/final_architecture.md`
- `supabase/README.md`

## Segredos e Credenciais

Segredos reais nao devem ser salvos em documentacao:

- token do bot Telegram;
- token do Instagram/Meta;
- `SUPABASE_SERVICE_ROLE_KEY`;
- API key Gemini;
- chaves Evolution;
- `N8N_ENCRYPTION_KEY`.

Use `.env` local ou o gerenciador de variaveis do host de producao.
