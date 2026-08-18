# Disparos e Agendamentos

Este documento descreve as duas funcionalidades globais adicionadas ao produto
Mag.IA.

Elas sao multi-tenant. Ou seja, os dados sao sempre vinculados ao tenant ativo
no painel e nao a um cliente fixo.

## Disparos

A aba `Disparos` permite preparar uma mensagem e enviar para multiplos contatos
selecionados.

No MVP, o envio real usa o mesmo `Command Router` do n8n ja usado pela aba
Conversas. Portanto, para Telegram, cada destinatario precisa ter:

```text
channel_type = telegram
external_conversation_id = chat_id do Telegram
```

Importante: o Telegram nao permite que um bot envie mensagem para uma pessoa que
nunca iniciou conversa com ele. Entao a lista precisa conter contatos que ja
falaram com o bot ou `chat_id` validos de conversas existentes.

### Fontes de contatos

A aba aceita tres caminhos:

1. Importar planilha `.xlsx`, `.csv` ou `.txt`.
2. Adicionar contatos recentes da aba Conversas.
3. Adicionar contatos de uma etapa/quadro do Kanban.

Para planilhas, use colunas como:

```text
nome
chat_id
telegram_id
external_conversation_id
canal
telefone
email
```

Campos minimos:

```text
nome, chat_id
```

Arquivos `.xls` antigos devem ser salvos como `.xlsx` ou CSV antes da
importacao.

### Persistencia

Os contatos importados ficam em:

```text
broadcast_contacts
```

Cada envio cria:

```text
broadcast_campaigns
broadcast_campaign_recipients
```

Cada mensagem enviada tambem continua gerando evento em:

```text
channel_events
```

Isso mantem a conversa visivel na aba Conversas.

### Adaptacao futura para WhatsApp

A estrutura ja possui `channel_type`.

Para WhatsApp, o caminho correto sera:

```text
channel_type = whatsapp
external_conversation_id = numero/remoteJid usado pelo provedor
```

O envio deve ser roteado pelo n8n para Evolution API ou WhatsApp Cloud API,
sem mudar o desenho da interface.

## Agendamentos

A aba `Agendamentos` permite inserir agendamentos manualmente.

Campos principais:

```text
titulo
contato
conversa vinculada opcional
inicio
fim opcional
observacoes
```

Nao ha bloqueio de conflito de horario no MVP. O usuario pode criar varios
agendamentos no mesmo dia e horario.

### Persistencia

Os agendamentos ficam em:

```text
appointments
```

Cada agendamento tambem aparece automaticamente no Kanban, na coluna:

```text
Agendamentos
```

A ordenacao do card segue:

```text
mais proximo -> mais distante
```

## Migration obrigatoria

Antes de usar essas abas com Supabase real, execute:

```text
supabase/migrations/010_broadcasts_and_appointments.sql
```

Essa migration cria as tabelas de disparo, expande `appointments`, adiciona
indices, realtime e policies RLS para usuarios membros do tenant.
