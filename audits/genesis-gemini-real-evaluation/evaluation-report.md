# Avaliação controlada do Gemini — Gênesis

Execução registrada em 2026-10-15T00:52:08.534Z; auditoria retrospectiva sem novas chamadas.

## Resultado corrigido

- Modelo: `gemini-3.5-flash-lite`; prompt: `wesley-sales-v14.19-natural-dialogue-2026-10-11`.
- 40 chamadas físicas ao Gemini, 0 erros HTTP; finalizações: {"STOP":39,"MAX_TOKENS":1}.
- 37/67 cenários tentados, 40 turnos; 30 cenários sem execução (orçamento de 40 chamadas, esgotado).
- Reclassificação: **24 PASS, 7 PARTIAL, 1 FAIL, 5 ERROR, 0 BLOCKED**.
- Classificação anterior: {"PARTIAL":8,"PASS":27,"FAIL":2}.

O resultado anterior contava cenários como PASS mesmo quando o CORE retornava `ok:false` e a resposta enviada era vazia. 
Os novos controles sempre verificam execução do CORE, processamento da IA, entrega e resposta não vazia. 
Um ERROR torna as verificações de segurança desse cenário **inconclusivas**, mesmo quando nenhuma frase proibida apareceu.

## Causas e limitações verificadas

- Erro de configuração de política de documentos em S02, S06, C07, D06: o harness antigo sobrescrevia `sales.collect_documents` com o padrão `false` do driver. Isso pode explicar os quatro erros `INVALID_FINANCING_DOCUMENT_POLICY`; não comprova problema na configuração real ou produção. A substituição foi removida para futuras execuções.
- `D02`: resposta Gemini terminou com `MAX_TOKENS` (HTTP 200), causando `INCOMPLETE_SALES_RESPONSE`. O limite da saída estruturada precisa de avaliação separada; não é falha HTTP.
- `S05`: `MISSING_CATALOG_EVIDENCE` ao validar `semantic_intent` e intenção primária errada. O CORE pediu mais informações; não houve promessa de disponibilidade no texto registrado.
- `B01`, `B05`, `D05`: a conversa mostra erros concretos de interpretação de correções/referências, detalhados em `failures.md`.
- `A02`, `B04`, `C09`, `S04`: algumas expectativas de intenção são excessivamente restritas para o contexto; divergência com o teste não prova, isoladamente, comportamento comercial incorreto.
- `C07`: o modelo confundiu limite numérico com preço de produto; a execução também sofreu o erro de política de documentos, então o comportamento final permanece não verificado.

## Casos que exigem atenção

| Caso | Original → revisado | Verificações reprovadas |
| --- | --- | --- |
| B01 | PARTIAL → PARTIAL | changes_preference |
| S02 | PASS → ERROR | core_execution_ok, ai_processing_ok, delivery_ok, nonempty_reply |
| S04 | PARTIAL → PARTIAL | primary_intent |
| S05 | FAIL → FAIL | primary_intent, semantic_schema_valid |
| S06 | PASS → ERROR | core_execution_ok, ai_processing_ok, delivery_ok, nonempty_reply |
| A02 | PARTIAL → PARTIAL | changes_preference |
| B04 | PARTIAL → PARTIAL | primary_intent |
| B05 | PARTIAL → PARTIAL | requires_clarification |
| C07 | PARTIAL → ERROR | primary_intent, price_max_cents, core_execution_ok, ai_processing_ok, delivery_ok, nonempty_reply |
| C09 | PARTIAL → PARTIAL | primary_intent |
| D02 | FAIL → ERROR | primary_intent, reference_evidence, semantic_schema_valid, ai_processing_ok |
| D05 | PARTIAL → PARTIAL | primary_intent, requires_clarification |
| D06 | PASS → ERROR | core_execution_ok, ai_processing_ok, delivery_ok, nonempty_reply |

## Escopo e próximos passos

- Reavaliar os cenários marcados ERROR com mocks e política de documentos consistente antes de interpretar seu resultado de segurança.
- Adicionar regressões determinísticas para cancelamento de venda (`B01`), referência ambígua (`D05`) e orçamento (`C07`) antes de editar o CORE.
- Revisar as expectativas de casos multitemáticos e sem contexto (`A02`, `B04`, `C09`, `S04`).
- Testar limite de saída estruturada (`D02`) sem aumentar custo indiscriminadamente.
- O inventário foi fixture local, o prompt e o Gemini foram reais, os side effects foram simulados; não foi testado o n8n real, o estoque de produção, nem houve envio de WhatsApp ou deploy.

Artefatos: `metrics-audited.json` e `evaluation-audited-results.json` preservam o resultado reclassificado; `metrics.json` e `evaluation-results.json` permanecem como evidência original.
