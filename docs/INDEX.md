# Documentacao Oficial Mag.IA

Este indice aponta apenas para documentos uteis para operar, continuar o
desenvolvimento e preparar hospedagem.

## Leitura obrigatoria

- `status/current_project_state.md`  
  Estado exato do projeto, o que funciona e o que ainda falta.

- `operations/local_runbook.md`  
  Passo a passo para rodar localmente como estamos rodando agora.

- `operations/versioning_workflow.md`  
  Padrao oficial de Git: desenvolver em `dev`, testar e promover para `prod`.

- `operations/hosting_preparation.md`  
  Checklist para sair do ambiente local e hospedar o piloto JIW.

- `architecture/final_architecture.md`  
  Decisoes de arquitetura SaaS multi-tenant.

## Operacao

- `operations/realtime_conversations_manual_replies.md`  
  Como funciona a aba Conversas em tempo quase real e envio manual.

- `operations/broadcasts_and_appointments.md`  
  Como funcionam as abas Disparos e Agendamentos.

- `operations/versioning_workflow.md`  
  Como versionar, testar e liberar alteracoes nas branches `dev` e `prod`.

- `operations/gemini_jiw_setup.md`  
  Como ativar Gemini com controle de custo.

- `operations/instagram_jiw_setup.md`  
  Como conectar Instagram DM da JIW pelo padrao oficial da Meta.

- `operations/jiw_service_catalog_sheet.md`  
  Como a planilha de servicos da JIW vira base consultavel.

- `operations/onboarding_tenant.md`  
  Como cadastrar novos clientes no modelo multi-tenant.

- `operations/onboarding_telegram_multitenant.md`  
  Procedimento oficial para cadastrar novos clientes Telegram no workflow unico multi-tenant.

- `operations/onboarding_telegram_gemini_demo.md`  
  Passo a passo para configurar um novo cliente de apresentacao com Telegram e Gemini real.

## Supabase

- `../supabase/README.md`
- `../supabase/migrations/`
- `../supabase/seeds/`
- `../supabase/seeds/new_tenant_telegram_template.sql`

## n8n

- `../n8n/workflows/jiw_telegram_real_supabase.json`
- `../n8n/workflows/magia_telegram_multitenant.json`
- `../n8n/workflows/jiw_instagram_real_supabase.json`
- `../n8n/workflows/magia_command_router.json`
- `../n8n/workflows/jiw_telegram_mock.json`

## Cliente piloto

- `../clients/jiw/docs/status_interface.md`
- `../clients/jiw/docs/telegram_botfather_n8n.md`
- `../clients/jiw/planilha_custos_servicos_ti.xlsx`
