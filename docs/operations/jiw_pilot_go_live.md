# Go-live piloto JIW

## Estado atual

- Cliente piloto: JIW - Solucoes Tecnologicas.
- Canal inicial: Telegram.
- Bot: @jiwtech_bot.
- Interface oficial: `magia/app`.
- Workflow mock: ativo como rollback.
- Workflow principal real: ativo.
- Webhook Telegram atual: apontado para `/webhook/telegram-jiw-real`.
- IA paga: ainda nao configurada no fluxo principal.
- Persistencia Supabase: schema e seed preparados no repositorio, pendente confirmar execucao completa no projeto Supabase final.

## Interface

Pasta:

```text
magia/app
```

Comandos locais:

```powershell
cd magia/app
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Build de producao:

```powershell
cd magia/app
npm run build
```

Variaveis para ambiente hospedado:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Supabase

Executar no SQL Editor do projeto Supabase final:

```text
magia/supabase/migrations/001_core_multi_tenant.sql
magia/supabase/migrations/002_production_hardening.sql
magia/supabase/migrations/003_channel_events.sql
magia/supabase/seeds/jiw_seed.sql
```

Depois validar:

```sql
select *
from channel_events
where tenant_slug = 'jiw'
order by created_at desc
limit 20;
```

## n8n

Workflow principal:

```text
jiwTelegramReal01
Mag.IA/JIW - Telegram Atendimento REAL
POST /webhook/telegram-jiw-real
```

Para producao, o n8n precisa de URL publica fixa. Evitar localtunnel para cliente real.

Variaveis importantes no host definitivo:

```text
N8N_HOST=n8n.seudominio.com
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.seudominio.com/
N8N_ENCRYPTION_KEY=valor-fixo-seguro
```

## IA

Recomendacao inicial:

- Gemini como provedor principal.
- Modelo economico para atendimento texto.
- Prompt por tenant salvo no Supabase em `prompt_versions`.
- Chaves de API como credenciais/env vars do n8n, nunca no frontend.
- Limite mensal por cliente antes de ativar uso comercial.

Etapas:

1. Criar API key no Google AI Studio ou Google Cloud.
2. Salvar a credencial no n8n.
3. Adicionar node Gemini entre classificacao e resposta.
4. Passar contexto do tenant, prompt ativo e historico resumido.
5. Registrar tokens/custo estimado por mensagem.
6. Manter fallback deterministico para erro/limite de IA.

## Hospedagem minima para piloto

1. Frontend estatico em Render, Vercel, Netlify ou Cloudflare Pages.
2. Supabase compartilhado multi-tenant.
3. n8n self-hosted em VPS com Docker.
4. Dominio com subdominios:
   - `app.seudominio.com`
   - `n8n.seudominio.com`
5. HTTPS via proxy reverso.
6. Backups do Postgres/n8n.
7. Monitoramento basico de uptime.

## Ordem correta para atender a JIW

1. Confirmar Supabase final e executar migrations/seeds.
2. Configurar variaveis da interface hospedada.
3. Subir n8n em URL publica fixa.
4. Configurar `WEBHOOK_URL` no n8n.
5. Migrar credenciais para o n8n hospedado.
6. Importar/publicar workflow `jiwTelegramReal01`.
7. Configurar webhook do Telegram para a URL definitiva.
8. Ativar Gemini no workflow.
9. Testar conversas reais da JIW.
10. Entregar acesso da interface ao cliente.

## Fontes de custo

- Supabase: https://supabase.com/pricing
- Render Static Sites: https://render.com/pricing
- Gemini API: https://ai.google.dev/gemini-api/docs/pricing
- n8n webhook URL: https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-webhook-urls-with-reverse-proxy
> Documento legado do piloto JIW. Nao usar como runbook de producao.
> O fluxo oficial atual e `magia_telegram_multitenant.json` em
> `/webhook/telegram?tenant_slug=slug_do_cliente`.
