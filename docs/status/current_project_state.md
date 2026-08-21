# Estado Atual do Projeto

Atualizado em: 2026-08-17

## Produto

A Mag.IA e uma plataforma SaaS generalista de atendimento, automacao, CRM,
funil, kanban e IA para multiplos nichos.

Modelo atual para os primeiros clientes:

```text
uma interface
um Supabase compartilhado multi-tenant
um n8n com workflows core reutilizaveis
configuracoes por tenant
canal inicial por cliente via Telegram
```

## Cliente piloto

```text
Cliente: JIW - Solucoes tecnologicas
Tenant: jiw
Canal ativo: Telegram
Bot: @jiwtech_bot
Instagram: preparado, mas fora da prioridade atual
WhatsApp/Evolution: preparado, mas fora da prioridade atual da JIW
IA: Gemini configuravel via env + prompt por tenant no Supabase
```

## O que funciona agora

- App Mag.IA em React/Vite.
- Dashboard, Conversas, Kanban, Funil, Automacoes e IA na interface.
- Aba Conversas lendo eventos reais do Supabase por `tenant_slug`.
- Atualizacao de conversas via Supabase Realtime com polling de apoio.
- Envio manual pela interface pelo `Mag.IA/Core - Command Router`.
- Workflow Telegram multi-tenant ativo no n8n.
- Registro de mensagens Telegram em `channel_events`.
- Resposta automatica via Gemini quando a quota/API permitir.
- Fallback automatico quando Gemini estiver sem quota ou indisponivel.
- Estrutura de login/multi-tenant preparada com `tenant_members`.
- Catalogo de servicos consultavel por tenant via Supabase.

## URLs locais

```text
Interface: http://localhost:5174
n8n:       http://localhost:5678
Evolution: http://localhost:8080
```

## Workflows oficiais

```text
magiaTelegramMultiTenant01
Mag.IA/Core - Telegram Multi-tenant
POST /webhook/telegram?tenant_slug=slug_do_cliente

magiaCommandRouter01
Mag.IA/Core - Command Router
POST /webhook/magia-command
```

Workflows legados mantidos para referencia/rollback:

```text
jiwTelegramReal01
Mag.IA/JIW - Telegram Atendimento REAL
POST /webhook/telegram-jiw-real

jiwTelegramMock01
Mag.ia/JIW - Telegram Atendimento MOCK
POST /webhook/telegram-jiw

jiwInstagramReal01
Mag.IA/JIW - Instagram Atendimento REAL
GET/POST /webhook/instagram-jiw
```

## Supabase

Migrations oficiais:

```text
001_core_multi_tenant.sql
002_production_hardening.sql
003_channel_events.sql
004_ai_usage_channel_events.sql
005_tenant_service_catalog.sql
006_frontend_read_policies_jiw.sql
007_realtime_manual_replies.sql
008_auth_multi_tenant_policies.sql
```

Seeds oficiais:

```text
jiw_seed.sql
jiw_service_catalog_seed.sql
```

## Estado validado localmente

Validado em 2026-08-17:

```text
n8n health: OK
Interface Vite: http://localhost:5174 OK
Webhook Telegram multi-tenant: registrado como POST /webhook/telegram
Command Router: registrado como POST /webhook/magia-command
Teste local Telegram JIW: respondeu e salvou evento no Supabase
Build da interface: npm run build OK
```

Observacao: no teste local, Gemini caiu em fallback por quota da API. Isso nao
impede o fluxo de funcionar, mas impede resposta real de IA ate a quota estar
disponivel.

## Pendencias antes de entregar clientes em teste

1. Hospedar n8n em URL publica fixa com HTTPS.
2. Configurar `WEBHOOK_URL` definitivo no n8n.
3. Migrar variaveis secretas para o host.
4. Rodar a migration `008_auth_multi_tenant_policies.sql` no Supabase oficial.
5. Criar usuario Supabase Auth para cada cliente.
6. Vincular usuario ao tenant em `tenant_members`.
7. Hospedar a interface com `VITE_REQUIRE_AUTH=true`.
8. Configurar token Telegram de cada cliente no n8n.
9. Apontar webhook de cada bot Telegram para `/webhook/telegram?tenant_slug=...`.
10. Validar Gemini sem erro de quota.
11. Testar mensagem real de cada cliente na interface.
12. Ativar rotina basica de backup e monitoramento.

## Documentos operacionais principais

```text
docs/operations/local_runbook.md
docs/operations/onboarding_telegram_multitenant.md
docs/operations/hosting_low_cost.md
docs/operations/hosting_preparation.md
docs/operations/realtime_conversations_manual_replies.md
docs/operations/gemini_jiw_setup.md
```
> Documento historico. Para deploy atual de producao, use
> `docs/operations/production_deploy_checklist.md` e os workflows
> `magia_telegram_multitenant.json` + `magia_command_router.json`.

