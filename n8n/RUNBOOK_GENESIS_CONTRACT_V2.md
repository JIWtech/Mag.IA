# Gênesis — publicação coordenada do contrato CORE ↔ EXT v2.0, recuperação durante o cutover e rollback

Status: **preparado, não publicado**. Nenhum workflow foi publicado, ativado ou executado, e nenhum SQL de escrita foi aplicado.
Este runbook só pode ser executado com autorização explícita do responsável pela operação.

## 0. O que foi e o que não foi verificado

| Item | Situação |
|---|---|
| Definições das RPCs da fila (`magia_claim_turn`, `commit`, `begin`, `confirm`, `finish`, `fail`, `resolve_turn_review`) | **Lidas no Supabase de produção (somente leitura)** em 2026-10-20 e comparadas com `turn_queue_lifecycle_v1.sql`: coincidem nas funções comparadas |
| n8n ao vivo | **Não verificado nesta sessão.** Não há MCP, API ou credencial de leitura do n8n disponível; o `.env` do repositório só descreve o n8n local e não foi usado |
| Último export do n8n disponível | `scratch/publication-review-20261019/CORE.published.json` e `EXT.published.json`, de **2026-10-19 22:35** (sha256 `bb98d4ed…` e `30c01dd2…`, os mesmos do `rollback-manifest.json`). É um retrato de ontem, não o estado atual |
| Estado do recuperador periódico no servidor | **Desconhecido.** Ver seção 3 |
| Comportamento de `continueRegularOutput` no Execute Workflow | **Não verificável offline.** Ver seção 4.2 |

O que o export de 19/10 mostra (a confirmar ao vivo antes de publicar):

| | Ao vivo em 19/10 | Local (este repositório) |
|---|---|---|
| CORE `3N5oN6sxtir9lFrA` | `active: true`, versionId `c31d431c-…`, decisão `decide_v3`, roteador envia `1.0`, **sem** classificação de cutover | roteador `2.0` para a Gênesis, decisão `decide_v4`, com classificação de cutover |
| EXT Gênesis `fXGorIlPbyf9Qtsp` | `active: true`, versionId `42b1b356-…`, identidade aceita `1.0`, decisão `decide_v3` | identidade aceita `2.0`, decisão `decide_v4`, política de follow-up |
| Gatilho `Recuperar Fila WhatsApp` | `scheduleTrigger` de 10 s, nó não desabilitado | igual |
| Execute `CORE \| Executar EXT Gênesis` (bootstrap) | sem `onError` (para a execução) | igual |
| Execute `… por turno` e `… comercial` | `onError: continueRegularOutput` | igual |
| Nós diferentes (código) | `Motor conversacional único`, `Resolver extensão do tenant`, `Preparar resposta`, `Finalizar resposta`, `Processar Follow-ups`, `Ler Fila WhatsApp`, `Registrar Mensagem na Fila`, `Preparar Contexto JIW`, `Preparar Resposta JIW` | — |
| Nós só de um lado | só ao vivo: `CORE - Bloquear destino não configurado`; só local: `CORE - Roteador Dinâmico SaaS` | — |

**Estas diferenças são esperadas e não são defeito:** o CORE e a EXT novos ainda não foram publicados, e o local também carrega
mudanças de outras frentes (roteador dinâmico SaaS, fila, mídia). Cada diferença é apenas um item a conferir na publicação.
**Antes de publicar, exportar o estado ao vivo de novo e refazer esta tabela**: o rollback depende desse export.

## 1. O que muda neste contrato

| Ponto | Antes (contrato 1.0) | Agora (contrato 2.0) |
|---|---|---|
| Versão enviada à EXT pelo nó `CORE - Resolver extensão do tenant` | `1.0` para todos os tenants legados | `2.0` para `wesley_automoveis`; Núbia continua `1.0` |
| Versão enviada pelo CORE à EXT na decisão comercial | `1.0` | `2.0` (somente `wesley_automoveis`) |
| Identidade do nó EXT (`genesis_tenant_identity.js`) | aceita `1.0`; erro único `NORIA_EXTENSAO_TENANT_INCORRETO` | aceita `2.0`; versão diferente → `NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH` |
| Decisão comercial da EXT (`provenance`) | `..._decide_v3` | `..._decide_v4` com `noria_contract_version: '2.0'` |
| Verificação no CORE | provenance `v3` | provenance `v4` **e** versão `2.0` |
| Falha por versão incompatível no CORE, depois do claim | falha permanente → `review` | falha **pré-envio e retentável** dentro do orçamento da fila |
| Disposição do cliente | CORE cancelava follow-ups diretamente | CORE só cancela quando a EXT, com base na configuração do tenant, autoriza (seção 6). Sem configuração: nenhum cancelamento |

O nó de roteamento do workflow CORE enviava `1.0` à EXT para todos os tenants legados. Sem a correção, a identidade 2.0 recusaria
todo turno da Gênesis. O executor de homologação passou a rodar o próprio nó do JSON, e a verificação `P1-04w` falha se a versão divergir.

## 2. Pré-condições (todas obrigatórias)

1. Auditoria independente aprovada sobre o diff.
2. `node scripts/homolog/p1_behavioural_checks.cjs` → 8/8. `node scripts/homolog/genesis_executor.cjs --mode=fixtures` → 7/7.
3. `node scripts/test_noria_primary_dialogue.cjs`: 11 aprovados e os mesmos 4 reprovados de antes. Nenhum novo.
4. `n8n/build_manifest.json` com `production_approved: false` até a publicação, e hash do EXT no workflow igual ao do fonte.
5. **Export somente leitura do estado ao vivo** de CORE e EXT (e comparação com a seção 0), guardado como artefato de rollback.
6. **Confirmação, no n8n, de que o recuperador está ativo** (seção 3) e de quais execuções estão em andamento.
7. Fila do chat Gênesis sem turnos em `processing` ou `sending`. Turnos em `review` e `uncertain` (42 e 4 na leitura de 2026-10-20, todos os tenants) são anteriores a esta publicação e não são tocados por ela.
8. Decisão de política de follow-up registrada (seção 6).
9. Janela de baixo tráfego.

## 3. Recuperador periódico (`Recuperar Fila WhatsApp`)

Dentro do workflow CORE: `scheduleTrigger` a cada 10 s → `Ler Fila WhatsApp` (`whatsapp_recover_core.js`) → roteador →
EXT bootstrap → `Preparar dispatch Genesis` (aqui ocorre o `magia_claim_turn`).

O código verifica `magia_turn_lifecycle_status` e seleciona, em `conversation_turn_queue`, até 30 linhas com:
`phase in (ready, processing, sending)`, `quiet_until <= agora`, `next_attempt_at` nulo ou vencido, mensagens em `pending` ou `claimed`,
e `token` nulo ou `lease_until` vencido. Linhas em `review` e `uncertain` **nunca** são selecionadas.

- Estado local: ativo (`active: true`, gatilho não desabilitado).
- Estado ao vivo: não verificado. Não presumir que está ativo. Se estiver inativo, mensagens pendentes só avançam com nova mensagem do cliente.
- Repetição na lacuna de publicação: enquanto a EXT recusar a identidade, o recuperador volta a selecionar a mesma linha a cada ciclo de 10 s, sem backoff. A causa é estrutural: o claim ainda não ocorreu, portanto não há token e `magia_fail_turn` (única origem de `next_attempt_at`) não pode ser chamada, e a linha continua elegível. Verificado no executor: seis recusas seguidas deixam a fila byte a byte idêntica, `attempt_count` em 0, zero RPCs, zero envios. O custo é só de execuções com erro, e a linha não consome o orçamento de tentativas.
  - **Transitório (esperado):** a lacuna entre as duas publicações. Dura o tempo da janela (seção 5).
  - **Persistente (defeito operacional):** um lado publicado e o outro não. A repetição continua indefinidamente, sem perda de mensagem. Resolve-se completando a publicação ou fazendo o rollback conjunto, não por código.
  - Não foi acrescentado backoff ou política de retry no CORE nem no recuperador: exigiria estado novo, e o contrato publicado da fila já cobre o que importa (mensagem preservada, nada reenviado, `review` e `uncertain` intocados).
  - **Risco não verificável offline:** o Execute de bootstrap não tem `onError`; se uma falha nele interromper a execução inteira do recuperador, itens de outros tenants do mesmo ciclo podem ser adiados enquanto durar a lacuna. A seleção é de 30 linhas por `updated_at`, de modo que linhas Gênesis presas ficam à frente. Mitigação: janela curta, e durante a publicação conferir no n8n que as execuções da Núbia continuam concluindo. Se isso ocorrer, a causa é a lacuna, e a ação é completá-la.

## 4. Caminhos reais de uma incompatibilidade de versão

### 4.1 No bootstrap, antes de `magia_claim_turn`
O primeiro Execute (`CORE | Executar EXT Gênesis`) não tem `onError`: a execução para na identidade da EXT.
Nenhum claim ocorre, nenhuma RPC é chamada, a linha da fila fica intacta (verificado: sem escrita, fila idêntica).
**A mensagem continua pendente** e o recuperador a retoma a cada 10 s quando as versões coincidirem.

### 4.2 Depois do claim e antes do envio
Os Executes seguintes (`… por turno` e `… comercial`) usam `continueRegularOutput`. O formato do item de erro não foi verificado:
- **Se o item mantiver o contexto do turno:** o CORE classifica a recusa como cutover retentável e chama `magia_fail_turn(…, p_retryable => true)`.
  Sem tentativa de entrega, a fila volta a `ready`, preserva `claimed`, `pending`, token e lote, e define `next_attempt_at` (política publicada: 3 tentativas, base 30 s, teto 900 s). O recuperador reivindica o mesmo lote depois. Verificado no executor: 1 envio, 1 evento de saída, fila limpa, sem perda nem duplicação.
- **Se o item vier só com o erro:** o CORE lança "contexto ausente" antes de ter o turno e não chama `magia_fail_turn`. O turno fica `processing`; ao vencer o lease (180 s), a próxima chamada de `magia_claim_turn` o devolve a `ready` via `magia_fail_turn('lease_expired', true)`. Mesmo destino, mais lento. Não simulado de ponta a ponta.

Em ambos, o orçamento de 3 tentativas pode ser consumido se a lacuna durar: a fila vai para `review` com `retry_budget_exhausted`, sem envio.

### 4.3 `review`
Recuperação somente por procedimento autorizado, seção 7.2.

### 4.4 `uncertain`
Existe tentativa de entrega registrada. **Nunca reenviar automaticamente nem manualmente por SQL.** O contrato publicado já garante:
`magia_fail_turn` com tentativa → `uncertain` (mesmo com `p_retryable = true`); `magia_claim_turn` não reivindica `uncertain`;
`magia_finish_turn(…, 'done')` com tentativa aberta lança `DELIVERY_RECONCILIATION_REQUIRED`.

## 5. Ordem segura de publicação e de rollback

Regra: **o CORE novo é quem deve estar ativo durante qualquer lacuna.**

Lacuna com CORE novo + EXT antiga: todo bootstrap novo é recusado antes do claim (4.1). Turnos que o CORE antigo já executava
terminam contra a EXT antiga, que ainda aceita `1.0`. Quase nada fica reivindicado.
Lacuna com CORE antigo + EXT nova: o bootstrap novo também é recusado, mas um turno **já reivindicado pelo CORE antigo** encontra a EXT nova na
etapa comercial, e o CORE antigo, sem a classificação de cutover, trata como falha permanente → `review`.

**Publicação:**
1. Publicar o workflow **CORE**.
2. Imediatamente depois, publicar o workflow **EXT Gênesis**.
3. Antes de liberar tráfego: um turno de teste sem envio real; `noria_contract_version` `2.0` no intermediário; provenance v4 na decisão.
4. Conferir que o recuperador segue ativo e que não há novas execuções com erro de versão.

**Rollback (conjunto, pelo mesmo princípio):**
1. Republicar a **EXT** exportada no passo 2.5 (identidade aceita `1.0`).
2. Depois republicar o **CORE** exportado.
3. Verificar um turno de teste sem envio.

Sem migração de banco: a publicação e o rollback são só de workflows. Não publicar um lado sozinho e deixá-lo.

## 6. Follow-ups: política de disposição (decisão pendente)

Autoridade: o **Gemini** identifica a disposição; a **EXT Gênesis** decide a ação (`follow_up_policy` na decisão: `cancel`, `keep` ou `undecided`);
o **CORE** executa apenas `cancel`. Sem política na decisão, o CORE não cancela (verificado).

Configuração por tenant: `settings.sales_follow_up.disposition_actions`, valores `cancel` ou `keep`. Outro valor é ignorado.
Estado lido em 2026-10-21 (somente leitura): `sales_follow_up` da Gênesis tem `enabled`, `messages` e `revision`; **`disposition_actions` não existe**.

| Disposição | Proposta (pendente de aprovação) | Sem configuração, a EXT devolve |
|---|---|---|
| `declined` | `cancel` | `undecided`: nada é cancelado |
| `closed_by_customer` | `cancel` | `undecided`: nada é cancelado |
| `deferred_by_customer` | **sem chave**, até decisão explícita | `undecided`: nada é cancelado nem reagendado, nenhum follow-up novo |

A EXT **não tem ação embutida** para nenhuma disposição; só a configuração do tenant autoriza `cancel` ou `keep`.
Nenhuma configuração foi aplicada: a escolha entre `cancel` e `keep` está pendente de aprovação comercial.
Cancelamentos operacionais (handoff, exclusão de contato, número comercial, encerramento) não passam por esta política e continuam como estavam (verificado: o handoff cancela o job pendente sem política configurada).

Arquivos de proposta, **não aplicados** (aguardam aprovação comercial):
- `supabase/migrations_pending_review/20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.sql`
- `supabase/migrations_pending_review/20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.rollback.sql`

Para aprovar o adiamento, acrescentar `deferred_by_customer` com `cancel` ou `keep` na proposta antes de aplicar.
A proposta grava também o marcador `sales_follow_up.disposition_actions_proposal`. O rollback só age se o marcador existir, remove apenas
`declined` e `closed_by_customer` que ainda sejam exatamente `cancel`, preserva qualquer outra chave e valor posterior, e só remove
`disposition_actions` se ficar vazio. Toda aprovação posterior que altere `disposition_actions` deve remover o marcador; sem marcador o rollback
não altera nada e a restauração é manual, a partir do export de `tenant_settings` feito antes da aplicação (comparar chave a chave).
Só afeta `wesley_automoveis`. A lógica do rollback foi conferida com `SELECT` sobre documentos literais (cinco estados), sem escrita.
O CORE não tem padrão comercial próprio e a Núbia não é afetada.

## 7. Recuperação operacional

### 7.1 Verificação (somente leitura)

```sql
select q.chat_id, q.phase, q.last_error_code, q.attempt_count,
       (select count(*) from public.conversation_turn_delivery_attempts a
         where a.tenant_id = q.tenant_id and a.chat_id = q.chat_id and a.turn_token = q.token) as attempts_for_token
from public.conversation_turn_queue q
where q.tenant_id = '<tenant_id_genesis>' and q.phase = 'review'
  and q.last_error_code in ('COMMERCIAL_CONTRACT_VERSION_MISMATCH', 'COMMERCIAL_DECISION_PROVENANCE_INVALID',
                            'NORIA_EXT_DISPATCH_UNAVAILABLE:CONTRACT_VERSION', 'NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH',
                            'NORIA_EXTENSAO_TENANT_INCORRETO', 'retry_budget_exhausted');
```

### 7.2 Retomada autorizada de `review`
A única ação permitida é a que já existe: `magia_resolve_turn_review(p_tenant, p_ticket, p_expected_revision, 'resume_unattempted', p_note)`.
Condições (verificadas pela própria função publicada): `phase = 'review'` com `token` e `retry_batch_id`; `current_delivery_id` nulo e **nenhuma**
tentativa de entrega para o token nem para qualquer `event_id` do lote; operador em `conversation_turn_review_operators`; ticket em aberto
com `revision` igual à esperada e snapshot da fila idêntico; nota obrigatória. Só retomar linhas com `attempts_for_token = 0`, motivo de versão e publicação concluída.

Proibido: SQL de escrita na fila, reiniciar turno com tentativa de envio, reenviar `uncertain`, resolver ticket em lote ou sem prova, tocar em outros tenants.

## 8. Proteção de destino não configurado (equivalência)

O nó `CORE - Bloquear destino não configurado` do export de 19/10 não desapareceu: `scripts/patch_noria_core_dynamic.cjs` o renomeou para
`CORE - Roteador Dinâmico SaaS`, ocupando a mesma posição (saída "não é Gênesis" de `CORE - É Gênesis?`). A garantia foi preservada e estendida:

| Camada | Garantia |
|---|---|
| `CORE - Resolver extensão do tenant` | só encaminha Núbia e Gênesis; para outro tenant exige `noria_client_policy` em `tenant_settings` (busca por `tenant_id`), senão `NORIA_SEM_EXTENSAO_CONFIGURADA` |
| `CORE - Roteador Dinâmico SaaS` (antigo bloqueio) | passa só com `noria_client_policy` e `noria_extension: saas_dynamic`; caso contrário lança `NORIA_CORE: extensao nao habilitada` (mesma mensagem do bloqueio antigo) |
| `loadTenantContext` (CORE, antes de qualquer ação sensível) | o tenant do slug deve estar ativo e ter o mesmo `id` do ingresso; `whatsapp_processing_mode = conversation_core_v1`; o canal `whatsapp` ativo deve ter o `external_id` igual à instância (`Instance does not belong to tenant`) |
| `validateTenantPolicyContract` | `tenant_id` e `tenant_slug` da política devem coincidir com o turno |
| `sendChannelMessage` | credenciais Evolution do sufixo do tenant e instância configurada igual à do turno; senão não envia |

Mudança de comportamento (intencional, de outra frente): antes, qualquer tenant fora de Núbia e Gênesis era bloqueado; agora um tenant com
política dinâmica configurada é aceito. Tenant sem política continua bloqueado (`test_noria_dynamic_routing.cjs`: 4/4, incluindo "unknown tenant fails closed").
O nó antigo não foi recriado.

## 9. Itens que este runbook não cobre
- Estado vivo do n8n (seção 0) e o formato do item de erro do Execute Workflow.
- O simulador não reproduz bloqueio de linha, tabela de recibos terminais, gatilho de tickets nem `magia_turn_terminal_evidence` (sem autoridade de supressão, um `finish` sem entrega é encaminhado a `magia_fail_turn`, como a função publicada faz sem prova). `magia_claim_turn` é simulado sem busca de fronteira, tenant inativo e janela de silêncio.
