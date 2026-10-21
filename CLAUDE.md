@AGENTS.md

## Claude Code
- Saídas grandes (logs, testes, `git log`, JSON de workflow n8n): filtre (`| tail`, `grep`) ou use as ferramentas do context-mode; não despeje no contexto.
- Em `n8n/`, os JSONs gerados são grandes: leia `n8n/sources/` e use busca por trecho, não o arquivo inteiro.
- Para buscas amplas no repositório, use um subagente Explore em vez de ler vários arquivos.
