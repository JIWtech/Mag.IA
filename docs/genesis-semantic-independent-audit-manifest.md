# NORIA — pacote para auditoria independente da evolução semântica da Gênesis

Gerado em 14/10/2026 a partir do estado local de `C:\Noria_Plataform`.

Este pacote preserva a estrutura relativa do repositório e reúne as fontes solicitadas, seus builders e testes diretamente relacionados. Os workflows e o JavaScript gerado estão presentes apenas para comparação; as fontes e builders continuam autoritativos.

Não foram incluídos arquivos `.env`, credenciais, dumps, dados de produção ou dependências instaladas. Nenhum deploy, envio de WhatsApp, escrita no Supabase ou migration foi executado para gerar este pacote.

## Arquivos principais solicitados

- `scripts/build/n8n/whatsapp_semantic_intent.cjs`
- `clients/wesley_automoveis/genesisCommercialEngine.cjs`
- `scripts/build/n8n/whatsapp_commercial_regressions.cjs`

## Builders incluídos

- `scripts/build/n8n/build_whatsapp_core.cjs`
- `scripts/build/n8n/build_whatsapp_core_workflow.cjs`
- `scripts/build/n8n/build_genesis_extension.cjs`

## Testes incluídos

- `scripts/tests/test_whatsapp_sales.cjs`
- `scripts/tests/test_whatsapp_core.cjs`
- `scripts/tests/test_gemini_failure_resilience.cjs`
- `scripts/tests/test_genesis_turn_dispatch_contract.cjs`
- `clients/wesley_automoveis/test_genesis_engine.cjs`

## Artefatos derivados e relatório

- `n8n/code/whatsapp_conversation_core.generated.js`
- `n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json`
- `n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2.json`
- `docs/genesis-semantic-evolution-audit.md`

## SHA-256 dos arquivos

```text
94A31B2062AB225AA1D542A0BE95A270F8533B5114EFA707EF70970A77A91521  scripts/build/n8n/whatsapp_semantic_intent.cjs
635E20B34F40E46A489BCFC00C7AB226801B31838CC83350721E657F7D2024EE  clients/wesley_automoveis/genesisCommercialEngine.cjs
A2E809517094208044041F1C6D8C17148DD40124F9FC00D2A1382BAA1AD09F02  scripts/build/n8n/whatsapp_commercial_regressions.cjs
CC7BE16E5DEC3CE061B1096A9245EB4C566CFA3FF653F0B841081C8A4E8E57E0  scripts/build/n8n/build_whatsapp_core.cjs
83D15D68F695039E3FDA1CBF60BD372E721B16546AE94F901E123F8AE9D1B0AA  scripts/build/n8n/build_whatsapp_core_workflow.cjs
49617513A511C6A54DBDAE9230997FD292F45EA5610C9630C291A1C8033C7BDC  scripts/build/n8n/build_genesis_extension.cjs
12107847197C37833DA30DF5455645D12AE390E5764854C23389C60F938D8A1D  scripts/tests/test_whatsapp_sales.cjs
C2BE49A3081B5F06C39E8513890433EA56DC80E28BDF0B15A8B3C8AEB7BC971C  scripts/tests/test_whatsapp_core.cjs
75E0502DC800E1CFA8406E7EB0058908CA17F340679BAA2B8231219C21776A39  scripts/tests/test_gemini_failure_resilience.cjs
1DFD32E03BB667540E9AFB609D37D0C76E44CF7D715FE3A3CEF01CE163304362  scripts/tests/test_genesis_turn_dispatch_contract.cjs
9491FD0C4F02FC679544FFCDBB91B8EB997DBE06FB5EF63C4FC61F6D71D24ECB  clients/wesley_automoveis/test_genesis_engine.cjs
C5D34F06D5627A6AB355772633F3C64383AF51443A1191930670C1FF4D5DCB2F  n8n/code/whatsapp_conversation_core.generated.js
19C4BF7D77D632E271E6B62EA3736CA03B87B0400924EC595B9424CA551A51D4  n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json
B324B2EA54839E04665F7E54BACF5B6068B79181BEA6C4C77CDAD2A74CAF1BED  n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2.json
13F24196A5CED24BB6D645153D59C643F2B0CC49AF8A7442ABAF7E7CA6036DBA  docs/genesis-semantic-evolution-audit.md
```

## Orientação ao auditor

Faça a avaliação pelo código real. Use o relatório como índice de alegações, não como prova. Confira especialmente a precedência do `semantic_intent`, validação de `null`, evidências limitadas à sessão, isolamento por tenant, aplicação do orçamento ao inventário e ausência de uma segunda inferência Gemini.
