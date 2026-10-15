# NORIA — Pacote de auditoria da evolução semântica da EXT Gênesis

Data da validação local: 14/10/2026  
Repositório: `C:\Noria_Plataform`  
Tenant: `wesley_automoveis`  
Capacidade: `sales_v1`

## Instruções para o auditor

Faça uma auditoria independente desta implementação. Não presuma que o relatório ou o código estejam corretos.

Compare as afirmações abaixo com os arquivos-fonte, builders, artefatos gerados e testes. Diferencie:

- defeitos comprovados;
- riscos plausíveis ainda não reproduzidos;
- decisões arquiteturais aceitáveis;
- problemas de testes que mascaram comportamento real;
- limitações conhecidas já declaradas.

Não proponha uma função SQL ou uma reescrita ampla sem demonstrar primeiro, no código atual, por que ela é necessária. Não execute deploy, migrations, escritas em produção ou mensagens WhatsApp.

Perguntas principais:

1. O `semantic_intent` válido realmente prevalece sobre heurísticas linguísticas na Gênesis?
2. O tratamento de `null`, campos ausentes, tipos inválidos e contradições está correto?
3. As evidências de categoria e referências estão corretamente limitadas à sessão?
4. O filtro de orçamento impede, em todos os caminhos, a oferta de veículos fora da faixa?
5. Preferências subjetivas deixam de produzir atributos inventados?
6. Existe alguma segunda chamada Gemini que reinterprete o mesmo turno?
7. O executor pós-Gemini está suficientemente isolado por tenant/capacidade?
8. Núbia e Royal permanecem sem regressões?
9. Há caminhos em que regex ainda sobrepõe um plano semântico válido?
10. O fallback malformado falha de forma segura e auditável?

## Diagnóstico anterior

A implementação já estava parcialmente iniciada. Existiam:

- dispatch da EXT Gênesis após o claim do turno;
- leitura tenant-scoped do inventário no Supabase;
- emissão de `dialogue_plan` e `semantic_intent` na resposta principal do Gemini;
- executor comercial parcialmente desacoplado;
- builders e testes iniciais.

Foram confirmados estes problemas:

1. `salesValidateSemanticIntent()` usava `null` tanto para representar valor opcional válido quanto erro de validação. Por isso, `price_min_cents: null`, `price_max_cents: null` e `selected_ordinal: null` invalidavam o objeto.
2. `salesSemanticPlanFromPrimary()` podia copiar `catalog_audience` para a memória sem `catalog_audience_evidence_ids`, contrariando `mergeMemory()`.
3. `price_min_cents`, `price_max_cents`, `preferences` e `exclusions` não eram aplicados ao catálogo.
4. Seleção de produto e financiamento ainda podiam retornar a regex mesmo com um plano semântico válido.
5. O builder semântico não reconhecia corretamente um workflow já parcialmente transformado.

Linha de base observada antes das correções finais: 180 de 181 testes de vendas passavam. O único teste novo falhava por causa do tratamento incorreto de `null`.

## Arquitetura resultante

Fluxo implementado:

1. O CORE valida identidade, tenant, canal, sessão e ownership.
2. A EXT Gênesis, após o claim, consulta o snapshot tenant-scoped de `public.genesis_inventory_vehicles`.
3. O CORE entrega ao Gemini principal apenas o contexto e o inventário autorizados.
4. A resposta estruturada principal inclui `dialogue_plan` e `semantic_intent`.
5. O CORE valida localmente o contrato semântico.
6. Um executor determinístico pós-Gemini, restrito à Gênesis, aplica categoria, orçamento e restrições ao snapshot autorizado.
7. O CORE persiste estado/evidências e envia a resposta.

Não foi adicionada uma chamada Gemini específica para reinterpretar o turno. O teste semântico end-to-end verifica uma única chamada ao endpoint Gemini no cenário de catálogo.

## Contrato semântico

Fonte principal:

- `scripts/build/n8n/whatsapp_semantic_intent.cjs`

O contrato contém:

- `primary_intent`;
- `secondary_intents`;
- `topics`;
- `catalog.requested`;
- `catalog.category`;
- `catalog.price_min_cents`;
- `catalog.price_max_cents`;
- `catalog.preferences`;
- `catalog.exclusions`;
- `catalog.evidence_ids`;
- `references.previous_catalog`;
- `references.selected_ordinal`;
- `references.mentioned_product_ids`;
- `references.evidence_ids`;
- informações de continuidade, mudança de preferência, ambiguidade e confiança.

O validador agora diferencia, por códigos próprios:

- objeto ausente ou inválido;
- campo obrigatório ausente;
- tipo inválido;
- `null` permitido;
- inteiro não negativo válido;
- faixa de preço contraditória;
- ordinal inválido;
- evidência ausente;
- evidência fora da sessão;
- produto inexistente no inventário autorizado;
- enum ou confiança inválida.

Retornos inválidos recebem `valid: false` e `validation_errors`. Esses erros são incluídos no fallback auditável persistido no evento.

## Memória e evidências

Uma categoria semântica só pode ser persistida em `dialogue_memory` quando:

- a categoria é válida;
- existem `catalog.evidence_ids`;
- todos os IDs pertencem à sessão corrente;
- `salesNaturalDialogue.mergeMemory()` aceita a atualização.

O código não fabrica IDs de evidência. Referências ordinais ou por produto também exigem IDs de evidência da sessão.

O estado comercial atual pode substituir uma intenção antiga quando `semantic_intent` informa a intenção nova. Há teste de uma conversa antes orientada a venda que muda para compra sem depender das palavras canônicas antigas.

Limitação conhecida: categoria é persistida de forma estruturada, mas orçamento, preferências e exclusões ainda não possuem persistência durável própria em `dialogue_memory`. Eles são aplicados ao turno atual e permanecem visíveis ao Gemini pelo histórico.

## Executor comercial

Fonte principal:

- `clients/wesley_automoveis/genesisCommercialEngine.cjs`

`filterCatalogBySemantic()`:

- começa somente com veículos ofertáveis;
- aplica categoria;
- aplica preço mínimo e máximo;
- rejeita produtos vendidos/indisponíveis da oferta;
- aceita restrições verificáveis no formato `field=value`;
- suporta `brand`, `model`, `color`, `fuel`, `year_min`, `year_max` e `product_id`;
- marca texto subjetivo como `unsupported`;
- retorna `requires_clarification` quando não há coluna autorizada para confirmar a preferência.

Exemplo esperado:

- categoria: carros;
- teto: R$ 45.000;
- preferência: “confortável para família”.

O executor pode filtrar carros até R$ 45.000, mas não pode afirmar que são confortáveis ou adequados para família se esse atributo não existe no inventário. Nesse caso, pede um critério objetivo.

## Autoridade semântica e regex

Quando `semantic_intent.valid === true`:

- intenção comercial não é escolhida por `salesIntentEvidence()`;
- solicitação e categoria do catálogo vêm do plano semântico;
- orçamento vem do plano semântico;
- ordinal/produto vêm das referências semânticas validadas;
- ausência de referência semântica não autoriza `salesCatalogChoice()` a interpretar texto livre;
- financiamento não depende de `isFinancingQuestion()`;
- ambiguidade não depende de `salesIntentAmbiguity()`;
- pergunta sobre detalhes não depende da lista de palavras `km`, `cor`, `ano` etc.

Regex continuam permitidas para:

- UUIDs, IDs e formatos;
- moeda e números;
- comandos estruturais;
- validação de contratos;
- regras de segurança;
- fallback degradado quando o Gemini retorna contrato ausente ou inválido;
- referências estruturadas vindas do catálogo/referral do WhatsApp.

Limitação conhecida: leilão e parte da lógica de troca ainda usam classificadores linguísticos legados. Eles foram preservados para não remover políticas comerciais já testadas antes da expansão do contrato semântico desses domínios.

## Supabase e isolamento

A EXT consulta `genesis_inventory_vehicles` com:

- `tenant_id` obrigatório;
- projeção explícita das colunas comerciais;
- somente leitura;
- limite de registros;
- normalização e validação local do snapshot.

O executor rejeita operações quando `tenant_slug !== 'wesley_automoveis'`.

O código diferencia:

- item anunciado;
- disponibilidade confirmada;
- preço conhecido;
- origem do preço;
- produto vendido ou não ofertável.

Não foram executadas migrations, alterações de dados ou consultas reais ao Supabase de produção nesta validação.

## Arquivos relevantes

Fontes e builders:

- `scripts/build/n8n/whatsapp_semantic_intent.cjs`
- `scripts/build/n8n/build_whatsapp_core.cjs`
- `scripts/build/n8n/whatsapp_commercial_regressions.cjs`
- `scripts/build/n8n/build_genesis_extension.cjs`
- `clients/wesley_automoveis/genesisCommercialEngine.cjs`

Testes:

- `scripts/tests/test_whatsapp_sales.cjs`
- `scripts/tests/test_whatsapp_core.cjs`
- `scripts/tests/test_gemini_failure_resilience.cjs`
- `scripts/tests/test_genesis_turn_dispatch_contract.cjs`
- `clients/wesley_automoveis/test_genesis_engine.cjs`

Artefatos derivados:

- `n8n/code/whatsapp_conversation_core.generated.js`
- `n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json`
- `n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2.json`

## Testes executados

Resultados finais:

- `node --test scripts/tests/test_whatsapp_sales.cjs`: 187/187.
- `node --test scripts/tests/test_gemini_failure_resilience.cjs`: 42/42.
- CORE, dispatch Gênesis e engine em execução conjunta: 83/83.
- Total: 312/312.
- `node --check` nos arquivos alterados: aprovado.
- `git diff --check`: sem erros; somente avisos de LF/CRLF.

Cobertura observada inclui:

- catálogo de carros;
- mudança de motos para carros;
- pedido indireto por veículo familiar;
- teto de orçamento;
- entrada e financiamento;
- mudança de venda para compra;
- múltiplos objetivos;
- produtos vendidos;
- referências ordinais;
- produto marcado;
- referência sem evidência;
- retorno semântico inválido;
- `null` opcional;
- preferência subjetiva sem dados autorizados;
- tentativa cross-tenant;
- handoff humano;
- regressões Núbia;
- isolamento Royal;
- geração dos workflows;
- limite de chamadas Gemini.

## Regeneração

Comandos usados:

```text
node scripts/build/n8n/build_whatsapp_core_workflow.cjs
node scripts/build/n8n/build_genesis_extension.cjs
```

Uma execução consecutiva final manteve os hashes:

- CORE gerado: `C5D34F06D5627A6AB355772633F3C64383AF51443A1191930670C1FF4D5DCB2F`
- Workflow CORE: `19C4BF7D77D632E271E6B62EA3736CA03B87B0400924EC595B9424CA551A51D4`
- Workflow EXT Gênesis: `B324B2EA54839E04665F7E54BACF5B6068B79181BEA6C4C77CDAD2A74CAF1BED`

## Estado declarado

### Implementado e validado localmente

- correção do tratamento de `null`;
- evidências de categoria e referência;
- orçamento aplicado ao catálogo;
- preferências objetivas estruturadas;
- esclarecimento para preferências subjetivas;
- autoridade semântica sobre intenção, catálogo, seleção, detalhes, ambiguidade e financiamento;
- uma única interpretação Gemini do turno;
- regeneração idempotente;
- regressões Núbia e Royal aprovadas.

### Implementado, mas não validado em produção

- aderência do Gemini real ao novo schema;
- qualidade semântica em conversas reais;
- leitura do snapshot real do Supabase no workflow publicado;
- comportamento com configurações e inventário atuais de produção.

### Pendente

- contrato semântico específico para leilão;
- retirada adicional da autoridade linguística legada em troca/entrada;
- persistência estruturada de orçamento, preferências e exclusões entre turnos;
- corpus de avaliação com chamadas reais ou respostas gravadas do Gemini.

### Não executado

- deploy;
- ativação de workflow;
- migration;
- escrita no Supabase;
- mensagem WhatsApp real;
- alteração da Evolution API;
- commit.

## Solicitação de parecer

Ao concluir a auditoria, entregue:

1. achados ordenados por severidade;
2. arquivo e linha aproximada de cada achado;
3. evidência concreta ou teste de reprodução;
4. impacto comercial e multitenant;
5. correção mínima sugerida;
6. testes adicionais necessários;
7. avaliação explícita de cada limitação declarada;
8. conclusão separando aprovado, parcialmente aprovado e bloqueado.

