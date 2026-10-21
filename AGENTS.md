# AGENTS.md — NORIA / Mag.IA

SaaS B2B multi-tenant de atendimento multicanal (WhatsApp oficial, Telegram), qualificação de leads, CRM Kanban, agendamento e roteamento IA ↔ operador humano. Responder e comentar em português do Brasil.

## Estrutura
- `app/` — SPA React 18 + Vite, CSS modular em `src/styles/` (sem Tailwind), Supabase Realtime. Testes: Vitest (`npm test` dentro de `app/`).
- `supabase/` — PostgreSQL, migrações, isolamento por `tenant_id` / `tenant_slug`.
- `n8n/` — workflows. **NORIA CORE** (motor compartilhado) + **NORIA EXT** (política comercial por cliente: Gênesis, Núbia, etc.). Fontes canônicas em `n8n/sources/`, geradas por `scripts/build_noria_workflows.cjs`: nunca editar só os JSONs gerados.
- `clients/`, `docs/` (índice em `docs/INDEX.md`), `scripts/`.

## Regras inegociáveis
1. **Regra de negócio > IA.** O LLM nunca sobrepõe retorno estruturado do EXT nem regras determinísticas do cliente. Sem overrides incondicionais no CORE.
2. **CORE genérico, EXT é a autoridade comercial.** Nada específico de tenant no CORE (nem `if (tenantSlug === ...)`). Supabase é a fonte de verdade comercial.
3. **Sem hardcode conversacional**: nada de respostas comerciais prontas, regex/palavras-chave como autoridade de intenção, nem preços/veículos fixos no código. Regex só para parsing técnico (CPF, placa, data, valores). Detalhes e checklist: `.agents/rules/anti-hardcode-core-ext.md`.
4. **Multi-tenant rígido**: toda query e evento filtra por `tenant_id` / `tenant_slug`; nenhum dado vaza entre tenants.
5. **Sem segredos no código ou no Git**; use `.env`. Valide entradas nas fronteiras; queries parametrizadas.
6. Preserve o que funciona; não refatore módulos estáveis fora do escopo.

## Fluxo de trabalho
- **Bug**: reproduza com teste que falha → corrija → teste passa (Prove-It). Feature: spec/plano curto → TDD incremental.
- Rode `npm test` em `app/` após mexer em frontend ou serviços. Um commit por incremento lógico; não misture formatação com mudança de comportamento.
- Antes de commitar: testes passam, sem lint, sem segredos no diff, autorrevisão (corretude, legibilidade, arquitetura, segurança, performance).
- Nunca: remover teste que falha para passar o CI, force-push em branch compartilhada.
- Pergunte antes de: mudar schema, adicionar dependência, decisão arquitetural.
- Git: `dev-testes` (experimentos) → `dev` (consolidado) → `prod` (estável); promova só com suíte completa verde.

## Mais contexto (ler só quando a tarefa pedir)
Índice completo em `.agents/README.md`: regras anti-hardcode, guia de landing page, correções CORE×EXT em andamento. Personas de revisão (code-reviewer, security-auditor, test-engineer, web-performance-auditor) em `.github/agents/`.
