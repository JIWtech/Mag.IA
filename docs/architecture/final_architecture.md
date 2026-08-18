# Arquitetura final Mag.IA

Atualizado em: 2026-07-28

## Decisao principal

A Mag.IA sera uma plataforma SaaS multi-tenant. O codigo da plataforma sera unico; cada cliente sera configuracao.

```text
Cliente novo = tenant + canais + prompts + automacoes + funil + permissoes
```

Nao criaremos uma aplicacao separada por cliente. Tambem nao usaremos copia manual de workflow como arquitetura final.

## Stack inicial para os 10 primeiros clientes

```text
Frontend
React/Vite estatico

Banco e auth
Supabase/Postgres compartilhado multi-tenant

Automacoes
n8n self-hosted

Fila/cache
Redis local/gerenciado

Canais
Telegram inicial
WhatsApp/Evolution depois
Instagram/WebChat futuros

IA
Gemini ou OpenAI por tenant quando houver credito
Mock/regras quando IA paga estiver desligada
```

## Por que multi-tenant compartilhado

Para os 10 primeiros clientes, o melhor custo/operacao e um unico banco Supabase com `tenant_id` em todas as tabelas.

Vantagens:

- menor custo por cliente;
- onboarding mais rapido;
- dashboard administrativo central;
- menos migrations repetidas;
- facilidade para comparar metricas;
- mesma interface para todos.

Riscos:

- queries sem `tenant_id`;
- policies RLS mal configuradas;
- vazamento de dados entre tenants;
- automacoes aplicadas no tenant errado.

Mitigacao:

- `tenant_id` obrigatorio nas tabelas operacionais;
- indices por `tenant_id`;
- RLS antes de liberar login real para clientes;
- logs/auditoria;
- testes de isolamento;
- nunca confiar apenas no frontend para filtrar tenant.

## Fluxo de mensagem

```text
Telegram/WhatsApp/etc
-> webhook publico
-> n8n
-> normalizar payload
-> identificar tenant pelo canal
-> salvar contato/conversa/mensagem
-> carregar configuracoes do tenant
-> aplicar automacoes
-> chamar IA ou regras MOCK
-> responder no canal correto
-> salvar resposta/eventos
-> atualizar kanban/funil
```

## Interface por cliente

A interface sera a mesma aplicacao para todos.

Cada cliente acessara apenas seus dados:

```text
/dashboard
/conversas
/kanban
/funil
/automacoes
/ia
/configuracoes
```

A customizacao sera por:

- tenant;
- canais conectados;
- funil;
- etapas de kanban;
- prompt;
- automacoes;
- usuarios/permissoes.

## Papel do n8n

No MVP final, o n8n ainda sera o motor principal.

Responsabilidades:

- receber eventos de canal;
- normalizar payload;
- executar automacoes;
- chamar IA;
- gravar dados;
- responder ao canal;
- integrar servicos externos.

Quando o produto escalar, criaremos uma API propria antes do n8n.

```text
Fase atual:
Canal -> n8n -> Supabase/IA/Canal

Fase posterior:
Canal -> API Mag.IA -> fila -> worker/n8n -> Supabase/IA/Canal
```

## Politica de IA

Configuracao por tenant:

```text
ai_provider
ai_model
prompt_version
max_tokens
temperature
daily_limit
monthly_budget
fallback_mode
```

Para custo minimo:

- texto primeiro;
- sem audio/imagem no MVP;
- sem embeddings no inicio;
- prompt curto;
- memoria resumida;
- IA apenas quando regra simples nao resolver;
- handoff humano em casos caros/complexos.

## JIW como piloto

JIW comeca com:

- Telegram;
- workflow n8n;
- regras MOCK;
- depois Supabase real;
- depois IA paga.

Isso valida:

- multi-tenant;
- canal Telegram;
- funil/kanban generalista;
- automacoes por regra;
- estrutura de atendimento real.
