# .agents — índice para agentes de IA

`AGENTS.md` (raiz) é o arquivo curto lido em toda sessão por Codex, Claude Code (via `CLAUDE.md`) e outros. Tudo que é detalhe fica aqui e só é lido quando a tarefa pede.

| Arquivo | Ler quando | Carga |
| :--- | :--- | :---: |
| `rules/anti-hardcode-core-ext.md` | Mexer em `n8n/sources/`, prompts do Gemini, fallbacks ou políticas de tenant | sob demanda |
| `context/landing-page.md` | Trabalhar na homepage / páginas comerciais | manual |
| `context/correcao-final-core-ext-2026-10-18.md` | Retomar as correções CORE × EXT Gênesis da auditoria de 18/10/2026 | manual |
| `context/correcao-ext-supabase.md` | Retomar a correção de regras comerciais Supabase × EXT (tarefa pontual: **não** rodar testes) | manual |

Personas de revisão (formato GitHub/Copilot, mantidas em `.github/` por exigência da ferramenta):

- `.github/agents/`: `code-reviewer`, `security-auditor`, `test-engineer`, `web-performance-auditor`
- `.github/skills/`: TDD, code review, debugging, git workflow, security

Docs de produto e operação: `docs/INDEX.md`.
