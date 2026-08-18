# Interface JIW - go-live operacional

## Estado

- App oficial: `magia/app`
- Localhost: `http://localhost:5174`
- Build de producao validado com `npm run build`
- Fonte real prevista: Supabase `channel_events`
- Canal operacional: Telegram
- Tenant: `jiw`

## O que esta funcional

- Dashboard:
  - total de conversas reais;
  - conversas com bot;
  - fila humana;
  - valor estimado em funil;
  - status Telegram/n8n/Supabase/IA.
- Conversas:
  - lista de conversas Telegram;
  - busca;
  - filtros IA/humanas/nao lidas;
  - historico usuario + bot;
  - detalhes do contato.
- Kanban:
  - colunas derivadas da etapa do atendimento;
  - cards por conversa;
  - estados vazios por coluna.
- Funil:
  - etapas comerciais derivadas dos eventos;
  - contagem, valor estimado e conversao.

## Variaveis da interface

Arquivo local:

```text
magia/app/.env.local
```

Conteudo:

```text
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_ANON_KEY
VITE_N8N_BASE_URL=http://localhost:5678
VITE_TENANT_SLUG=jiw
```

Use anon key no frontend. Nunca use service role na interface.

## Supabase

Rodar:

```text
magia/supabase/migrations/006_frontend_read_policies_jiw.sql
```

Validar:

```sql
select count(*)
from channel_events
where tenant_slug = 'jiw';
```

## Teste

1. Enviar mensagem ao bot Telegram da JIW.
2. Conferir `channel_events` no Supabase.
3. Atualizar a interface.
4. Validar Dashboard, Conversas, Kanban e Funil.

## Limites atuais

- Resposta manual pela interface ainda nao envia mensagem para o Telegram.
- Drag and drop do Kanban ainda nao persiste alteracao.
- Funil ainda e derivado automaticamente dos eventos, nao de oportunidades manuais.

Esses limites nao bloqueiam o piloto Telegram + IA; eles sao a proxima etapa de CRM operacional completo.
