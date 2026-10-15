# Avaliação real do Gemini — Gênesis

Harness local para exercitar o caminho real do CORE da Gênesis com o Gemini configurado em `tenant_settings`, mantendo os demais efeitos externos simulados.

O executor carrega o prompt e o modelo por leitura REST somente leitura, usa `n8n/code/whatsapp_conversation_core.generated.js`, o driver de integração de `scripts/tests/test_whatsapp_sales.cjs` e fixtures locais de inventário. Evolution API, persistência de leads, eventos, follow-ups e mensagens são mocks em memória. Nenhuma conversa ou dado pessoal de produção é usado.

## Execução

Smoke test:

```powershell
$env:NORIA_GEMINI_EVAL_MAX_CALLS='8'
node audits/genesis-gemini-real-evaluation/run-real-evaluation.cjs --smoke
```

Bateria limitada a 40 chamadas físicas, incluindo retries e chamadas internas de composição/auditoria:

```powershell
$env:NORIA_GEMINI_EVAL_MAX_CALLS='40'
node audits/genesis-gemini-real-evaluation/run-real-evaluation.cjs
```

Opcionalmente, `NORIA_GEMINI_EVAL_CASE_LIMIT` limita a quantidade de cenários tentados. A chave é lida do `.env`, nunca copiada para artefatos ou logs.

## Auditoria offline (sem chamadas ao Gemini)

Para revisar o histórico já coletado sem consumir tokens, enviar mensagens ou alterar produção:

```powershell
node audits/genesis-gemini-real-evaluation/audit-results.cjs
node --test audits/genesis-gemini-real-evaluation/test-audit-results.cjs
```

O script mantém `evaluation-results.json` e `metrics.json` originais e gera
`evaluation-audited-results.json`, `metrics-audited.json`, `evaluation-report.md`
e `failures.md`. Os resultados antigos não verificavam falhas de execução e
podiam marcar cenários com `ok:false` como `PASS`; agora esses casos são `ERROR`,
e sua segurança é inconclusiva. Futuras execuções da bateria também geram os
artefatos auditados automaticamente. O driver conserva a política
`sales.collect_documents` real do tenant, evitando o erro introduzido pela
sobrescrita do valor no harness anterior. A execução anterior **não** foi
repetida após essa correção e seus resultados não devem ser tratados como
validação da configuração corrigida.

## Limites de equivalência

- Gemini e o prompt/schema do CORE são reais.
- `tenant_settings` é lido do Supabase em modo somente leitura.
- Inventário é fixture local compatível com o contrato da EXT, não leitura do estoque de produção.
- Escritas do Supabase, Evolution API, WhatsApp, atribuições e follow-ups são simulados.
- O harness não representa execução dentro do n8n nem autoriza deploy.
