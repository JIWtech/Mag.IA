# Supabase Mag.IA

Banco compartilhado multi-tenant para os primeiros clientes da Mag.IA.

## Ordem de execucao

Execute no SQL Editor do Supabase, nesta ordem:

```text
migrations/001_core_multi_tenant.sql
migrations/002_production_hardening.sql
migrations/003_channel_events.sql
migrations/004_ai_usage_channel_events.sql
migrations/005_tenant_service_catalog.sql
migrations/006_frontend_read_policies_jiw.sql
migrations/007_realtime_manual_replies.sql
seeds/jiw_seed.sql
seeds/jiw_service_catalog_seed.sql
```

## Modelo

Primeiros 10 clientes:

- banco compartilhado;
- `tenant_id` nas tabelas principais;
- `tenant_slug` em `channel_events` para ingestao rapida dos canais;
- RLS habilitado;
- n8n usando service role;
- frontend usando anon key;
- isolamento por tenant nas policies e nas consultas.

## Tabela operacional atual

```text
channel_events
```

Ela captura eventos reais dos canais antes da materializacao completa em tabelas
mais especificas.

Campos essenciais:

```text
tenant_slug
channel_type
external_conversation_id
external_message_id
direction
sender_type
contact_name
message_text
response_text
delivery_status
command_id
created_at
```

## Validacoes uteis

Ver ultimas mensagens da JIW:

```sql
select direction, sender_type, channel_type, external_conversation_id, message_text, delivery_status, created_at
from channel_events
where tenant_slug = 'jiw'
order by created_at desc
limit 20;
```

Ver catalogo da JIW:

```sql
select count(*)
from tenant_service_catalog c
join tenants t on t.id = c.tenant_id
where t.slug = 'jiw';
```

Buscar servicos:

```sql
select *
from search_tenant_service_catalog('jiw', 'formatacao notebook', 5);
```

## Realtime

A migration `007_realtime_manual_replies.sql` adiciona a tabela
`channel_events` na publicacao `supabase_realtime`.

A interface usa isso para atualizar a aba Conversas com delay minimo.
