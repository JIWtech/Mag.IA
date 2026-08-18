# Catalogo de servicos JIW via planilha

## Objetivo

Usar a planilha de custos da JIW como base consultavel pelo workflow, sem inserir todos os servicos no prompt fixo da IA.

Esse mesmo padrao sera usado para bases por cliente, como estoque de veiculos da Avvento.

## Fontes

- Google Sheet: https://docs.google.com/spreadsheets/d/1zRCmrFVhX8es_XNuvxbvMyeLuvFnbjhL-1WRsu5UoPc/edit?usp=sharing
- Arquivo local: `magia/clients/jiw/planilha_custos_servicos_ti.xlsx`

## O que foi gerado

- Migration:
  - `magia/supabase/migrations/005_tenant_service_catalog.sql`
- Seed:
  - `magia/supabase/seeds/jiw_service_catalog_seed.sql`
- Script gerador:
  - `magia/scripts/generate_jiw_service_catalog_seed.js`

## Tabela

```text
tenant_service_catalog
```

Campos principais:

```text
tenant_id
external_source
external_id
category
name
description
billing_unit
price
estimated_hours
notes
metadata
active
```

## Busca

Funcao RPC:

```sql
search_tenant_service_catalog(
  p_tenant_slug text,
  p_query text,
  p_limit integer default 5
)
```

O workflow chama essa funcao via Supabase REST antes de chamar o Gemini.

## Variaveis n8n

```text
TENANT_CATALOG_ENABLED=false
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Para ativar:

```text
TENANT_CATALOG_ENABLED=true
```

## Ordem para ativar

1. Rodar no Supabase o SQL copiado:
   - `004_ai_usage_channel_events.sql`
   - `005_tenant_service_catalog.sql`
   - `jiw_service_catalog_seed.sql`
2. Preencher `SUPABASE_URL`.
3. Preencher `SUPABASE_SERVICE_ROLE_KEY`.
4. Trocar `TENANT_CATALOG_ENABLED=true`.
5. Reiniciar n8n.
6. Testar uma pergunta de preco no Telegram.

## Validacao Supabase

```sql
select
  category,
  name,
  billing_unit,
  price,
  estimated_hours,
  notes
from tenant_service_catalog c
join tenants t on t.id = c.tenant_id
where t.slug = 'jiw'
order by category, name
limit 20;
```

```sql
select *
from search_tenant_service_catalog('jiw', 'formatacao notebook', 5);
```

## Prompt

O prompt fixo nao contem a planilha completa.

O Gemini recebe apenas:

- contexto institucional da JIW;
- regras de atendimento;
- mensagem do usuario;
- classificacao previa;
- ate 5 itens relevantes retornados pela base.

Isso reduz custo e evita resposta com dados obsoletos.
