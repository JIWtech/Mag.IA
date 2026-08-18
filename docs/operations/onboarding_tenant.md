# Onboarding de cliente Mag.IA

## Checklist

1. Criar tenant no Supabase.
2. Configurar `tenant_settings`.
3. Criar canal inicial em `channels`.
4. Criar funil padrao.
5. Criar kanban padrao.
6. Criar automacoes iniciais.
7. Criar agente IA ou modo MOCK.
8. Criar workflow/roteamento n8n.
9. Configurar webhook do canal.
10. Testar mensagens reais.
11. Validar interface.
12. Ativar monitoramento.

## Dados minimos do cliente

```text
Nome da empresa
Slug
Segmento
Canais desejados
Horario de atendimento
Servicos/produtos
Critérios de handoff
Equipe responsavel
Tom de voz
Perguntas obrigatorias
Regras de fora de contexto
```

## Padrao de tenant

```text
slug: nome-curto-sem-espaco
timezone: America/Sao_Paulo
status: active
plan: Piloto | Starter | Pro | Enterprise
```

## Padrao de canal Telegram

```text
type: telegram
external_id: username do bot sem @
webhook_path: /webhook/telegram?tenant_slug={tenant_slug}
```

## Padrao de workflow n8n

```text
Mag.IA/Core - Telegram Multi-tenant
```

Workflow oficial:

```text
magiaTelegramMultiTenant01
POST /webhook/telegram?tenant_slug=slug_do_cliente
```
