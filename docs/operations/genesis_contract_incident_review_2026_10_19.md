# Revisão P0 — identidade de produto, contaminação de contexto e disponibilidade (CORE `0b39a9c6…` → `d548f4ae…`)

Observado com CORE `0b39a9c6…0f0e` + EXT `36904449…031e`: 16 respostas, 9 aceitas, 7 rejeitadas. Gemini e auditor semântico funcionam; as rejeições vinham de contratos/estado inconsistentes entre fases.

## Causas provadas

| Grupo | Causa | Prova |
|---|---|---|
| Identidade (397776, 397856, 397884) | A escolha por ordinal ("E a 3?", "esse 3", "esse 1") só era resolvida na **finalização**, depois do EXT. O EXT autoriza e ecoa o produto que recebe (`authorized_product = payload.product`) e a finalização sobrescreve `generated.product` com esse eco (`generated.product = decisionData.authorized_product`). A resposta era sobre o produto escolhido; o produto autorizado era o anterior ⇒ `productId !== execution.product.id` para todas as claims. Passaram os turnos em que o Gemini já havia gravado o `state.product_id` correto. | Execução 397776 (saída de "Executar EXT Genesis comercial"): claims `official.inventory.3.{id,km,advertised_price_cents,observations}` com `source_product_id=yamaha\|crosser\|2023\|`, mas `commercial_decision.authorized_product.id=honda\|cb 600rr\|2007\|` (produto do turno anterior). Os fact_ids coincidem com as issues do evento. Reprodução controlada reproduz as posições 3/6/2 de produção e as mesmas issues. |
| Contaminação (397906, 397939, 397957) | (a) Em sessão nova o lead herda o nome do contato com `name_evidence=''`; `salesValidate` exigia evidência **na sessão corrente** para qualquer nome, apagava o nome só nesta fase, o EXT via `customer_name` ausente (`missing_fields`/`next_field=customer_name`) e a persistência final o restaurava ⇒ estado contraditório. (b) O plano aceitava `topic` como texto livre ("product_details", "price_question", "installment_value") enquanto os consumidores usam vocabulário fixo; um tópico fora do vocabulário não contava como mudança de assunto (`MISSING_COLLECTION_QUESTION`) nem como pedido de dados. | `sales_leads.state` do chat: `customer_name="João Victor"`, `name_evidence=""`, `financing_missing_fields=[customer_name,…]`, `requests[0].topic="product_details"`. Tópicos livres persistidos em dezenas de leads. |
| Disponibilidade (397754) | `availability_asserted` era booleano sem definição; respostas que dizem que a disponibilidade **não** foi confirmada podiam marcá-lo `true` e cair em `UNVERIFIED_PRODUCT_AVAILABILITY`. O auditor está correto; a falha é de contrato de geração. | **Não provado** diretamente: o rascunho rejeitado não era persistido. Hipótese sustentada pelo contrato sem descrição. A partir desta versão o evento guarda `dialogue_audit.contract` (tópicos, `availability_asserted`, produto autorizado, produtos citados). |

## Decisões
1. Resolver a referência do cliente **antes** do EXT (`salesTurnCatalogChoice` + `salesApplyCatalogChoice`, mesma regra pura usada de novo na finalização). O EXT continua dono da elegibilidade/política; o CORE só entrega o produto certo.
2. Nome já aceito no lead (inclusive herdado) permanece válido; só nome **novo** exige evidência. Nome novo sem evidência restaura o aceito em vez de apagá-lo.
3. Vocabulário de tópicos único (`salesDialogueTopics`, + `availability`): enum no schema do Gemini e validação em `validatePlan` (falha explícita em vez de bypass silencioso).
4. `availability_asserted` definido no schema; auditor e validações inalterados.

Nada foi relaxado: auditor, ledger, `FACT_PRODUCT_IDENTITY_MISMATCH`, `UNVERIFIED_PRODUCT_AVAILABILITY` e isolamento de tenant permanecem. EXT Gênesis não foi alterado.

## Arquivos
`n8n/sources/noria_core.js` (+ regenerados `n8n/code/whatsapp_conversation_core.generated.js`, `whatsapp_sales.js`, `build_manifest.json`, JSON do CORE: apenas os nós `CORE | Motor conversacional único`, `Preparar resposta`, `Finalizar resposta`; ids e conexões inalterados).

## Reproduções pontuais (`scratch/p0-contract-20261020/`)
- `probe_identity_real.cjs`: estoque real da Gênesis; ANTES (EXT autoriza o produto anterior) → `FACT_PRODUCT_IDENTITY_MISMATCH:official.inventory.{3,6,2}.{id,advertised_price_cents,observations}`; DEPOIS (referência resolvida no prepare) → sem issues nos três casos.
- `probe_name_topics.cjs`: nome herdado preservado; nome novo sem evidência não sobrescreve; nome inventado sem lead continua vazio; tópicos fora do vocabulário rejeitados; descrição de `availability_asserted` presente.
- Regressões: `probe_audit_397517_regress.cjs` (A–E inalterados) e `probe_skip.cjs` (skip de prepare roteado a Finalizar).

## Hashes
- CORE normalizado: `d548f4aef88a1eeaf04477736fd9e7d08a7a6f43dff35f8360cd8bf563ee7482`
- JSON CORE: `7bfa497b79dd59ed6491e5c76f92aeae68737a0aee8f6c015d3ffae1b53c1f7d`
- EXT Gênesis (inalterado): `36904449f32a890a387961d0036a5e22d7b24d59e3ec6cc316aeca516a68031e`; JSON `cc77bf7fc1f63d28e202577a8fcc46b4922f3955c3defc5cc813800e4d7b5c77`

Não publicado. Nenhum SQL, serviço, webhook ou mensagem real tocados.

---

# Gênesis — confronto dos incidentes e correções estruturais locais

## Erro NORIA_EXTENSAO_TENANT_INCORRETO (execução EXT 397660) — 20/10/2026, 00h BRT

- **Causa-raiz**: na fase `prepare`, os retornos de "turno pulado" (contact_excluded, superseded,
  commercial_number, owner_saved_contact, closed_before_processing, turno não reivindicado) saíam
  como `{ok, skipped, reason}` sem tenant/extensão. O roteador "Turno terminal Genesis após prepare?"
  exige `tenant_slug`+`noria_extension`, não reconhecia o item como terminal e o enviava de novo à EXT
  ("Executar EXT Genesis comercial"), cujo guarda de identidade corretamente recusou (entrada real:
  `{ok:true, skipped:true, reason:"contact_excluded"}`). O turno já estava concluído; o efeito era
  execução com erro, sem resposta ao cliente (o contato é excluído de propósito).
- **Correção**: no ponto central de saída do CORE, skip da fase `prepare` vira terminal e mantém
  `tenant_id`, `tenant_slug`, `instance`, `remoteJid`, `noria_extension` (mesma regra já usada no
  caminho de skip do sales). Vai direto a Finalizar. EXT e guarda não foram alterados.
- Reprodução (`probe_skip.cjs`): antes → "EXT again (erro)"; depois → "Finalizar".
- Diff `skip_fix.diff`. CORE normalizado `0b39a9c6…0f0e`; JSON CORE
  `a5f5386ace6c45fb20e9d4db764bfb4ab99555fe6181e99bf43a1422d6dc19ef`; EXT inalterada.

## P0 auditoria indisponível (execução 397517) — 20/10/2026, 00h BRT

- **Causa-raiz**: o auditor semântico passava `requireDistributedRateControl: true` fixo, exigindo o
  controlador global (`GEMINI_RATE_SCOPE`/limites) mesmo com `GEMINI_RATE_CONTROL_REQUIRED` ausente.
  Em produção o escopo não existe (reservas com `scope = NULL`), então a chamada era recusada
  antes do HTTP (`distributed_controller_not_configured`, `duration_ms` 0–2) depois da geração
  primária (21.416 tokens) já ter sido feita. A migração `20261020010000` (aplicada, com a guarda de
  limites nulos) resolveu a dependência de RPC, não essa exigência.
- **Solução**: o auditor usa o mesmo `acquire` de toda chamada Gemini: reserva durável por tenant
  (`magia_gemini_reserve`), controlador global quando configurado, concorrência local no modo sem
  escopo, falha fechada em qualquer recusa (tenant esgotado, RPC indisponível). Exigir o controlador
  global passa a ser política do operador (`GEMINI_RATE_CONTROL_REQUIRED=true`), não regra exclusiva
  do auditor. Uma chamada, sem retry; validação de evidência inalterada. A evidência registra
  `rate_control_mode` (`supabase_atomic` ou `tenant_budget_local_concurrency`).
- **Reprodução** (`scratch/p0-rate-20261020/probe_audit_397517.cjs`, `salesAuditPrimaryDialogue` real, HTTP simulado):
  antes — produção sem escopo → `SEMANTIC_FACT_AUDIT_UNAVAILABLE` (`distributed_controller_not_configured`);
  depois — `accepted`, `reserve/tenant-only > AUDIT-HTTP`; tenant esgotado e RPC indisponível → revisão
  (sem HTTP); `REQUIRED=true` sem escopo → revisão; escopo global → `reserve+global > AUDIT-HTTP > release`.
- Diff: `scratch/p0-rate-20261020/audit_fix.diff`. CORE normalizado `8c2053da…7b26`;
  JSON CORE `fe3cc48f55f98663d240aac06fa20be0de7dcff2c466ff6ea5708491fbffc027`; EXT inalterada (`36904449…8031e`).
- Risco residual sem o controlador global: nada limita RPM/TPM/RPD agregados do projeto (só orçamento diário
  por tenant + concorrência por worker). Ativar `GEMINI_RATE_SCOPE`+limites quando houver acesso ao painel.

## Finalização do controle Gemini — 19/10/2026, 23h40 BRT — BLOQUEADO

Sem publicação, restart, webhook, WhatsApp, SQL em produção ou chamada Gemini real.

- **Quotas reais**: não comprovadas. Dependem do painel do Google (limites do projeto/modelo
  `gemini-3.5-flash-lite`) e das variáveis efetivas do n8n no EasyPanel. Evidência local de
  demanda (apenas respostas finais, exclui auditor/OCR/retries): máx. 357 respostas/dia e
  2,57 M tokens/dia (19/10); pico de 16 respostas e ~63 mil tokens em 1 minuto. 10 follow-ups
  da Núbia já falharam com HTTP 429 em 13–14/10 (a quota do Google já foi atingida).
- **Royal** (`ROYAL | Processar fila estoque IA`): usa `GEMINI_API_KEY_ROYAL_4X4` ou, na falta,
  `GEMINI_API_KEY` (a mesma do CORE → mesma quota). Agora reserva via `magia_gemini_reserve`
  antes do HTTP; negação/falha → classificador local já existente (sem bloquear a resposta).
  Chave dedicada só lê `GEMINI_RATE_SCOPE_ROYAL_4X4`/`GEMINI_MAX_*_ROYAL_4X4`.
- **JIW legado** (`Preparar Contexto JIW` / `Preparar Resposta JIW`, tenants `clinica_nubia` e
  `universo_prata`, sem tráfego desde 08/09 e 23/09): contador em staticData removido;
  reserva durável antes do agente; lease global liberado após a resposta (se o agente falhar,
  expira pelo TTL). Negação → caminho existente "Resposta sem Gemini". Usa credencial n8n
  `Google Gemini(PaLM) Api account` — **não é possível provar se é a mesma chave/projeto
  do GEMINI_API_KEY**; por segurança conta no mesmo escopo (superestima, nunca subestima).
- **Migração** `20261020010000` revisada: defeito comprovado e corrigido — `magia_gemini_acquire`
  trata limites NULL como "sem limite"; `p_scope` sem todos os limites agora retorna
  `invalid_configuration` (nada consumido). Atomicidade/idempotência/ordem de locks conferidas.
- **Follow-ups barrados por quota**: ficam `failed` (sem envio e sem retry automático) com
  `error` iniciando em `GEMINI_QUOTA_DEFERRED:` (controlador ausente/indisponível, limite do tenant,
  RPM/TPM/RPD). Listar: `select id,tenant_id,step_key,due_at,error from follow_up_jobs
  where status='failed' and error like 'GEMINI_QUOTA_DEFERRED:%';`
  Reenfileirar manualmente, só após quota normalizada e com revisão (o claim revalida
  conversa/agenda/exclusão antes do envio): `update follow_up_jobs set status='pending',
  error=null,locked_until=null,due_at=now() where id in (...) and status='failed' and
  error like 'GEMINI_QUOTA_DEFERRED:%';`. Itens antigos já podem estar obsoletos.
- Limite padrão 500 (CORE/Royal) e 700 (Wesley): cobre ~2,3–2,6 tentativas por resposta no pico
  observado; o dia é UTC (vira às 21h BRT). Acompanhar `gemini_tenant_daily_usage` e ajustar
  `settings.gemini_daily_limit` por tenant. JIW legado mantém o padrão histórico (100).
- Hashes: CORE normalizado `e0784c5c…330a`; JSON CORE `980de9461e24442fd41b6a089ebd74a4947b231fdf588904307c8a5910a0b728`;
  Royal `60b7d1061addc07a1ba6ca37c6b92c4184d9762c2312fa0019d4426c887dc71c`;
  EXT Gênesis `36904449…8031e` (JSON `cc77bf7f…5c77`, inalterado); migração `8bd0a916…113f5e`.
- Diffs: `scratch/p0-rate-20261020/legacy_paths.diff`; backups pré-alteração em `pre-legacy/`.

## Rate control Gemini — 19/10/2026, 22h55 BRT — BLOQUEADO

Rodada restrita aos dois bloqueadores de cota. Sem publicação, restart, webhook,
WhatsApp, chamada Gemini real ou SQL em produção. Fotos, mídia, fila, review/
uncertain, handoff, ordinal, EXT, Núbia e Royal não foram alterados.

### Causa-raiz
1. **Controle global**: `magia_gemini_acquire/release` (prod md5 6e6d48aa…/164236…)
   é atômico e compartilhado (advisory lock por escopo:modelo; RPM/TPM em janela de
   60 s, RPD em 24 h, leases de concorrência, circuito). Mas está **inativo**: os
   workers não têm `GEMINI_RATE_SCOPE`, `GEMINI_MAX_RPM/TPM/RPD`; tabelas com 0
   eventos. Sem quotas reais, o CORE caía no semáforo local por worker, e o auditor
   (`requireDistributedRateControl: true`) falharia fechado. O dispatcher de
   follow-ups ("Processar Follow-ups") chamava o Gemini **sem passar por nenhum
   controle** (Núbia: 329 follow-ups Gemini em 14 dias).
2. **Orçamento por tenant**: `gemini_daily_limit` contado em
   `$getWorkflowStaticData` (por worker, não durável, sem reserva prévia).

### Correção
- Nova RPC `magia_gemini_reserve` (migração pendente
  `supabase/migrations_pending_review/20261020010000_gemini_tenant_daily_budget.sql`):
  na mesma transação, trava a linha tenant/dia UTC, verifica o limite configurado,
  chama o `magia_gemini_acquire` existente (inalterado) quando há escopo global e
  só consome orçamento se o global permitir. Lease idempotente. Sem estorno em
  falha/timeout (a tentativa pode ter sido cobrada). Contrato do limite mantido
  (padrão 500, `<=0` ilimitado, unidade = tentativa HTTP, incluindo retries e auditor).
- CORE: `acquireGeminiConcurrencySlot` passa a reservar via essa RPC antes de toda
  tentativa HTTP; contador em staticData removido do caminho do CORE; falha/nulo/
  negação da RPC → nenhuma chamada HTTP. Auditor não reescrito: usa o mesmo acquire.
- "Processar Follow-ups": mesma reserva antes do Gemini; negação → job `failed`
  antes de qualquer envio (sem reenvio). Follow-ups de vendas (Gênesis) não usam Gemini.

### Verificações
- PostgreSQL 16 isolado, psql independentes: global RPM=3 com 10 chamadas → 3; limite
  do tenant exato sob concorrência; outro tenant isolado; negação global não consome
  tenant; lease duplicado idempotente; modo só-tenant; tenant inativo negado; 12
  chamadas paralelas multimodelo sem deadlock; limite 0 ilimitado; migração reaplicável.
- Runtime do CORE gerado com transporte simulado (10 cenários) e do dispatcher (4):
  ver `scratch/p0-rate-20261020/probe_rate.cjs` e `probe_followup.cjs`.
- Sintaxe, anti-hardcode, paridade fonte/gerado, IDs/conexões/credenciais iguais,
  só 4 nós com código alterado, `git diff --check` sem erros novos.
- Hashes: CORE normalizado `e0784c5c5a4d5a02eaa6c49fd5f9e60c78bb89fb061b141e9e9dca61baaf330a`
  (JSON em disco `41781517189b7a3173eaec649d4a9139d0083bd097ca7965333b18fc17fe2a76`);
  EXT `36904449f32a890a387961d0036a5e22d7b24d59e3ec6cc316aeca516a68031e` (inalterado).

### Ainda bloqueia
1. Quotas reais RPM/TPM/RPD do projeto/modelo Gemini não informadas; env globais não
   configuradas nos workers.
2. Migração `20261020010000` pendente de aprovação. O novo CORE **depende** dela:
   publicado sem ela, toda chamada Gemini falha fechada.
3. Caminhos Gemini fora do controlador, não alterados (Núbia legado/Royal):
   nó LangChain "Assistente JIW (Gemini)" com orçamento em staticData (tenants
   `clinica_nubia` e `universo_prata`, sem saídas em 14 dias) e
   "ROYAL | Processar fila estoque IA". Se usam a mesma chave/projeto, consomem a
   quota fora da contabilidade — decidir: chave separada, margem nas quotas, ou
   desativar/migrar esses caminhos.

## Desbloqueio solicitado — 19/10/2026, 22h40 BRT — BLOQUEADO

Esta seção atualiza a auditoria histórica abaixo. Foram feitas apenas as escritas
de produção expressamente autorizadas para imagens. Não houve publicação n8n,
restart, alteração de webhook, envio WhatsApp, nova chamada Gemini real, recuperação
de review/uncertain ou alteração de controle humano. Artefatos regenerados são um
**candidato consistente com o fonte, ainda não liberado para publicação**.

### Resolvido e comprovado

- Exports reais baixados do n8n com indicação Published, antes de qualquer alteração:
  `scratch/publication-review-20261019/CORE.published.json` e `EXT.published.json`.
  CORE: ID `3N5oN6sxtir9lFrA`, versionId `c31d431c-d0e7-4b84-972e-6ffa694dafe3`;
  SHA-256 do JSON exportado `bb98d4eda5b7e26fc13d311703fda8ee0b261056b2487c2137ea99689c7a25fd`.
  EXT: ID `fXGorIlPbyf9Qtsp`, versionId `42b1b356-f58a-4daf-9e6e-7b64349aff77`;
  SHA-256 do JSON exportado `30c01dd20ccd46e3434906c6e60dffde11ec411af44a5aec370dcf85a8016161`.
  Hash de export completo não é hash do fonte canônico. Cópias brutas preservadas,
  sem reserialização. Diretório scratch é ignorado pelo Git: preservar cópia privada
  deste diretório junto à operação antes da futura implantação.
- IDs dos 68 nós CORE e dos 3 nós EXT locais divergiam dos publicados, embora
  nomes/tipos fossem os mesmos. Alinhados aos exports sem substituir código ou
  parâmetros locais. IDs dos workflows, conexões, credenciais referenciadas,
  webhookIds e settings conferidos iguais aos publicados após o build.
- PostgreSQL 17.11 isolado, Docker `--network none`, sem portas expostas: seis casos
  passaram com processos psql independentes (PIDs distintos 243/242 na primeira
  disputa). RPCs begin/confirm/rate copiadas das definições publicadas e índice único
  real de channel_events. Uma reserva de texto e uma reserva de foto vencedoras;
  confirmação repetida idempotente; recibo uncertain impede nova reserva da mesma
  foto; texto confirmado e pending B preservados; isolamento de tenant e exclusão
  de workers no rate controller. Evidência: `concurrency-results.json` nesse diretório.
  A reserva de foto é o INSERT de recibo com a mesma chave única usada pelo CORE;
  não se inventou RPC de mídia. O teste não é um clone integral de produção:
  FKs/checks/triggers das tabelas de fila/eventos não foram copiados. Não houve
  chamada ao provedor; timeout é representado pelo recibo incerto. Os checks de
  runtime anteriores continuam sendo evidência separada, não teste de WhatsApp real.
- Migração de imagens aplicada duas vezes no PostgreSQL isolado: sintaxe,
  reaplicação, SELECT do membro ativo apenas no próprio tenant, não membro com
  zero linhas, anon sem acesso, authenticated sem escrita e caminho de outro
  tenant rejeitado. Depois aplicada **somente**
  `supabase/migrations_pending_review/20261017180000_genesis_inventory_vehicle_images.sql`
  em NORIA-prod; ferramenta retornou success=true. Nenhuma migração de fila/rate
  control foi aplicada. Grants/RLS publicados relidos: authenticated apenas SELECT,
  anon sem grant e uma policy SELECT de associação ativa; service_role escreve.
- Script existente executado primeiro em dry-run, depois com --apply e digest
  revisado `e2ae52586e29b59303509a51370e4e498bc467c25a8d5da97196f8aa093aff6c`.
  Onze arquivos inspecionados visualmente e confrontados com o mapeamento explícito
  e IDs/status do inventário; nenhuma associação inferida dinamicamente de pastas.
  GET dos bytes e releitura de cada vínculo confirmaram tenant/vehicle_id/URL/hash.
  Dez objetos preservados e apenas Montana nova: 11 vínculos para 12 veículos;
  PCX 2018 permanece sem imagem, sem herdar a da PCX 2023. Dois veículos sold
  podem ter registro histórico de imagem, mas continuam inelegíveis ao envio.
- Montana: vehicle_id `chevrolet|montana|2013|branca`, vínculo
  `9603e76b-b081-4e93-81e6-6b7cb9c4569d`, Storage object
  `46fe656e-bb35-474b-b938-b29adbc79981`, 331324 bytes, image/jpeg, 1600x720.
  SHA-256 `9337c64f4c7149db8a2d997160e03e6d91cd6cc987594ac57ce94d53b0d55883`.
  Caminho `genesis/74b57037-9349-4a9e-889c-b65fb63c983a/chevrolet-montana-2013-branca/principal.jpg`.
  URL pública conferida no relatório `images.applied.json`.
- Antes/depois: IDs e updated_at dos dez objetos iguais e bytes SHA-256 iguais.
  Fingerprint do inventário completo permaneceu `d2e6204fe3441513b92ea5850984b140`;
  fingerprint de tenant_settings permaneceu `17705dde859482b9c06d4118c19fa78a`.
  `settings.sales.whatsapp_catalog_photo_enabled=false` e
  `settings.sales.vehicle_photos_enabled` ausente. **Envio de fotos desativado.**
  Evidência detalhada: `images-production-proof.json` e `images.applied.json`.

### Rate control: correção local e bloqueadores restantes

O ambiente **exibido** no EasyPanel para o serviço n8n contém apenas as chaves
GEMINI_ENABLED, GEMINI_API_KEY e GEMINI_MODEL. Não foram expostos valores secretos.
Não aparecem GEMINI_RATE_SCOPE, GEMINI_MAX_RPM, GEMINI_MAX_TPM, GEMINI_MAX_RPD nem
GEMINI_RATE_CONTROL_REQUIRED. O banco continua com zero linhas em
gemini_rate_control_state. Isso não comprova todas as variáveis efetivas herdadas
pelos processos; impede afirmar que o controlador distribuído esteja ativo.

Correção mínima no CORE: o auditor adicional exige explicitamente aquisição pelo
**mesmo** magia_gemini_acquire existente. Sem configuração, RPC indisponível/nula
ou quota negada, falha fechada antes do HTTP; não cai no semáforo por worker.
Sem reescrita e sem retry dessa chamada. Demais callers legados preservados.
Seis checks de runtime sem rede real passaram: missing config, retorno nulo,
falha de rede, quota negada (todos zero chamadas ao provedor), uma aquisição + uma
chamada + uma liberação no sucesso e compatibilidade dos callers legados.
Arquivo `rate-guard-results.json`. O teste concorrente PostgreSQL valida o lock do
controlador existente, **não** prova ativação da configuração em produção.

Pendências impeditivas:

1. Aprovar quotas reais do projeto/modelo e configurar o MESMO GEMINI_RATE_SCOPE
   em todos os workers que compartilham a quota, RPM/TPM/RPD, concorrência e
   GEMINI_RATE_CONTROL_REQUIRED=true. Conferir a configuração efetiva nos workers.
   Não foram inventados números nem feitas alterações/restart do serviço.
   Com o ambiente hoje observado, publicar o candidato pode bloquear auditorias
   de detalhes; não publicar para descobrir isso em clientes reais.
2. O orçamento gemini_daily_limit do tenant (Gênesis: 700 na configuração lida)
   ainda usa staticData/data local diária, sem reserva atômica durável entre
   workers. Aprovar janela/fuso, consumo de tentativas/auditorias, escopo por modelo
   e política de esgotamento separadamente para cada tenant. A solução mínima
   proposta é estender a transação do controlador existente com identidade de
   tenant e consumo diário idempotente associado à aquisição; não criar segundo
   limitador nem dividir a quota global por tenant. Essa alteração SQL não é a
   migração de imagens e **não foi aplicada nem declarada implementada**.
   Não alterar Núbia/Royal ou copiar automaticamente os parâmetros da Gênesis.
3. TPM é reservado por estimativa de payload + limite de saída. Conferir margem
   e semântica com as quotas aprovadas; não tratar estimativa como medição exata.

### Candidato, diff, compatibilidade e futura publicação manual

Arquivos de lógica alterados nesta etapa: `n8n/sources/noria_core.js` (exigência
distribuída do auditor); esta documentação. Workflow JSONs receberam os IDs de nós
publicados e a regeneração oficial; projeções CORE/sales e manifesto regenerados.
Fonte EXT, regras comerciais e migração de imagens não precisaram de nova edição.
Diff específico: `scratch/publication-review-20261019/core.incremental.diff`.

Hashes do candidato regenerado (manifesto mantém production_approved=false):

- CORE normalizado: `68dad47b2d40c4833d5cb4ad2b6683acb5da219b503ec367fe2ad90877593385`.
- CORE disco: `d3de52f045d21459e438c21023d7e75c231a86a9943036aad913e539dea60c2a`.
- EXT fonte: `36904449f32a890a387961d0036a5e22d7b24d59e3ec6cc316aeca516a68031e` (inalterado).

Paths originais dos candidatos, **não liberados**:

- `C:/Noria_Plataform/n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json`
- `C:/Noria_Plataform/n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json`

Sintaxe do fonte e dos nós JS, hashes/paridade dos três nós CORE/EXT/projeção,
identidades e metadados conferidos; auditoria anti-hardcode passou. Diff incremental
sem whitespace inválido. git diff --check global continua apontando apenas os dois
EOF preexistentes em storageErrors.js:18 e attachments-location.css:332.

O par publicado usa o mesmo envelope commercial_decision_v1 e mesmas chaves de
identidade; não possui product_images_v1 nem o auditor novo. A EXT nova adiciona
capacidade técnica e, com flags desligadas, não busca nem projeta imagens.
CORE antigo não lê a tabela de vínculos recém-criada. Isso permite manter o estado
atual sem ativar fotos. Não equivale à homologação funcional de toda combinação
de versões: um turno iniciado pelo CORE antigo não tem a prova semântica nova;
CORE novo com EXT antiga também não recebe o contrato de imagem estrito.

**Ordem futura, condicionada ao desbloqueio:** (1) aprovar e homologar as pendências
de rate/budget; (2) obter novos exports caso a produção tenha mudado; (3) estabelecer
janela operacional sem turnos atravessando a troca de versão, com admissão/drain
controlados por procedimento aprovado; não há troca atômica do par no n8n;
(4) importar no workflow EXT existente e publicar; (5) importar no CORE existente
e publicar; (6) conferir IDs/creds/conexões, três fases CORE, contratos, limites e
logs; (7) retomar admissão. Manter fotos desligadas. Sem mecanismo de drain
aprovado não prometer ausência de mistura apenas por publicar rapidamente.
Nada dessa sequência de publicação/admissão foi executado nesta tarefa.

**Rollback:** numa janela igualmente controlada, restaurar primeiro CORE.published.json
no ID original e depois EXT.published.json no seu ID, verificando hashes do
rollback-manifest.json e credenciais. Preservar objetos/vínculos/tabela de imagens,
recibos, delivery ledger, claimed/pending, tickets e travas. O par exportado não
consulta a nova tabela e o catálogo WhatsApp estava vazio/desligado na conferência;
revalidar essas condições e as versões antes de executar rollback. Não converter
reservas incertas em reenvio. Nenhum rollback de dados/drop/delete é necessário.

**BLOQUEADO — controle global Gemini não comprovado/configurado e orçamento por
tenant ainda sem reserva durável; janela coordenada de publicação a homologar.**

## Auditoria específica pré-publicação — 19/10/2026, 22h BRT — BLOQUEADO

Escopo: fotos/inventário, verificador semântico e compatibilidade do pacote atual.
Fontes atuais e alterações locais preservadas; sem publicar, aplicar SQL, configurar
produção, enviar WhatsApp, recuperar filas ou executar novas chamadas Gemini reais.
Consultas Supabase e download dos objetos existentes foram SOMENTE LEITURA.

### Defeitos comprovados e correções locais

| Severidade | Defeito | Correção / resultado |
| --- | --- | --- |
| P1 | Existência de qualquer image_url contornava flags false/ausentes | CORE exige ativação explícita no planejamento e antes de cada envio. EXT não consulta imagens quando ambas as flags estão desativadas. |
| P1 | Nome de pasta do Storage era tratado como prova de principal.jpg e vínculo ao veículo; fallback só ocorria quando a tabela inteira estava vazia | Removida inferência por slug nos dois fontes. EXT aceita somente linhas explícitas tenant + vehicle_id + caminho + URL + MIME + tamanho + hash. Tabela ausente/parcial mantém somente as fotos comprovadas; contingência do CORE não inventa autorização. |
| P1 | Leitura RLS USING(true) permitia enumerar vínculos entre tenants; qualquer membro podia alterar o mapeamento | Migração pendente transacional: SELECT somente membro ativo do tenant; sem acesso anon e sem escrita authenticated. Escrita de registro restrita a service_role. FK composta preservada; checks de hash/tamanho/MIME/bucket/caminho. |
| P1 | URL HTTPS externa genérica era suficiente; snapshot prepare podia ressuscitar foto revogada no finalize | CORE valida envelope noria_product_images_v1 e tenant/produto, URL exata, hash e origem Supabase configurada. Fotos Gênesis usam somente produto reautorizado no finalize. URLs WhatsApp exigem host exato em sales.catalog_media_allowed_hosts e audit de sincronização válido. Sem configuração, nenhuma URL externa é liberada. |
| P1 | Upload deduplicava apenas por tamanho, não registrava vínculos e tratava erro de rede/permissão como ausência | GET dos bytes + SHA-256; somente 404 ou 400 com statusCode=404 e code=NoSuchKey significa ausência. Rede/403/conflito abortam. Apply exige digest revisado e tabela existente; registro insert-ignore + releitura exata, sem sobrescrever vínculos ou objetos. |
| P1 | Fotos não tinham registro durável ANTES da tentativa | Evento interno sales_product_photo_attempt, chave única por delivery_attempt_id + índice, tenant/sessão/token/produto/URL. Reserva deve retornar ID antes de Evolution. Reserva duplicada ou resposta perdida interrompe envio, sem reuse. Aceite exige ID do provedor, evento de foto persistido e atualização do recibo confirmada. Timeout/erro deixa reconciliação pendente. |
| P2 | Remoção de palavras em salesCatalogPhotoCandidate bloqueava ordinal legítimo ou reinterpretava a referência | Usa os IDs já resolvidos no fluxo/EXT e revalida a presença no snapshot final; seleção ambígua/inválida não despacha fotos. |
| P2 | Uma espera no semáforo podia esgotar o orçamento do auditor e ainda iniciar HTTP com mais 1 segundo | Verificador sem retry confere orçamento após adquirir lease e não inicia HTTP vencido; timeout usa apenas o restante. Caminhos anteriores de outros tenants preservados. |
| P2 | Valor integral repetido em claims e sources; nova prova de mídia seria repetida no prompt | Auditor omite value duplicado de claims e deduplica sources por fact_id após preflight. Metadados image_authorization não vão ao modelo primário. Não muda a evidência exigida. |

Não há nova política comercial ou texto comercial fixo. O contrato técnico
modules.product_images=noria_product_images_v1, projetado pela EXT Gênesis, limita
as novas exigências ao seu fluxo; o comportamento legado dos outros tenants não
foi migrado para esse contrato. Na Gênesis as três respostas fixas do ramo de fotos
não sobrescrevem a geração primária, que continua sujeita à auditoria.
A EXT decide elegibilidade; CORE verifica identidade, autorização técnica e execução.
Preço/observations/quilometragem continuam no ledger final; fotos não viram fatos
de condição mecânica. Um pedido de foto não comprova descrição visual.

O texto permanece confirmado pela RPC existente ANTES da mídia opcional. Falha de
foto não reenfileira nem duplica o texto. Os recibos de mídia são eventos internos
vinculados ao delivery ledger, NÃO uma nova semântica para magia_confirm_turn_delivery.
provider_accepted não significa leitura/entrega no dispositivo do cliente. Reservas
dispatch_reserved/uncertain/provider_accepted_audit_incomplete exigem reconciliação
manual por IDs; não há worker de reenvio ou resolução automática neste pacote.
Uma queda antes do HTTP pode deixar reserva ambígua de propósito. Persistência
continua dependente do índice único channel_events_external_message_unique_v2.
Os triggers de insert publicados foram conferidos em leitura: recibo outbound,
sender_type=system, handoff=false e service=sales_product_photo_attempt não acionam
controle humano, origem de controle autenticado ou cancelamento de follow-ups.
Cancelamento conhecido antes do HTTP fica cancelled_before_dispatch, distinto de
tentativa incerta; a reserva nunca é reutilizada automaticamente.
Controle humano, exclusões e token/phase/lease são rechecados antes de cada mídia;
isso não elimina a janela entre uma verificação de controle e a chamada externa.

### Evidência atual de produção (leitura)

- NORIA-prod: tabela genesis_inventory_vehicle_images ausente; 10 objetos JPEG no
  bucket; zero whatsapp_catalog_products para o tenant. Montana sem objeto.
- whatsapp_catalog_photo_enabled=false; vehicle_photos_enabled ausente.
- GET dos dez objetos: hashes iguais aos arquivos locais. Isso prova os bytes e
  NÃO prova a associação visual/comercial com cada vehicle_id nem entrega WhatsApp.
  Os dois veículos sold continuam fora das autorizações de envio, mesmo com foto.
- Há snapshots de estoque sincronizados em 14/10 (outros em 17/10 e Montana em
  19/10). Reler a linha não prova atualização física da oferta ou da fotografia.
  Status atual da fonte e correspondência da foto precisam da revisão operacional;
  não foi inventado TTL comercial para autorizar/recusar dados só pela idade.
- RPC magia_turn_lifecycle_status retornou ready=true / noria_turn_lifecycle_v1.
  RPCs de envio/confirmação/rate control existem. Não reaplicar a migração inteira
  da fila por causa deste pacote; readiness não substitui homologação de concorrência.
- gemini_rate_control_state não possui linhas. Variáveis do processo n8n e limites
  efetivos por projeto/modelo NÃO foram confirmados. Não afirmar controle global
  ativo apenas pela existência das RPCs.

### Chamadas, tokens, latência e limites

- Turno comercial normal: uma salesGenerate; plano derivado localmente. A função
  legada salesComposeNaturalDialogue não tem chamada no fluxo atual.
- Detalhes/condition, uso de observations ou modo semantic/verbatim: +1 auditor,
  somente após preflight estrutural válido. Nenhuma reescrita ou retry desse auditor.
  Catálogo/financiamento standard sem esses fatos: nenhuma chamada adicional.
  Handoff/backend terminal e contrato inválido não recebem auditor desnecessário.
- Imagens recebidas podem adicionar 1 classificação em lote quando necessária;
  imagem já stored/verified aguardada como vehicle_photo não precisa dessa chamada.
  OCR acrescenta chamada por documento processado; áudio possui seu processamento
  próprio. Portanto NÃO prometer duas chamadas como teto universal do turno.
- Sete amostras Gemini reais da homologação anterior (sem repetir chamadas agora):
  entrada 383–495 tokens (média 460,29), saída faturável 103–207 (média 152,14),
  latência 974–1255 ms (média 1055 ms). São fixtures curtas, anteriores à compactação,
  não medição de p95/p99 em n8n, nem garantia para observations longas.
- Preço Standard consultado em https://ai.google.dev/gemini-api/docs/pricing:
  gemini-3.5-flash-lite: US$0,30/M entrada e US$2,50/M saída, incluindo thinking.
  Incremento estimado por amostra auditada: US$0,000380–0,000666, média US$0,000518
  (~US$0,52/1000 auditorias). Fórmula = (entrada*0,30 + saída*2,50)/1e6;
  não inclui outras chamadas, câmbio, impostos ou desconto de cache.
- maxOutputTokens do auditor = 4096. Reserva TPM conservadora = ceil(JSON(payload).length/3,5)
  +4096; não é o consumo faturado. Payload grande pode reservar muito mais que as
  amostras. Cada auditor consome mais 1 RPM/RPD; se fração p de turnos audita, o
  componente primário+auditor passa de 1 para 1+p requisições/turno, fora mídia/retries.
- httpJson usa as RPCs atômicas por scope/modelo quando configurado; auditor tem
  retry=false e orçamento de 12s incluindo aquisição, com overhead de release/RPC.
  Não há deadline agregado do turno; múltiplos OCRs podem pressionar lease de 180s.
  As verificações de token/lease não podem ser removidas para compensar lentidão.
- Scope deve representar a conta/projeto de quota compartilhada, não ser separado
  por tenant de modo a multiplicar a quota real. Confirmar GEMINI_RATE_SCOPE,
  GEMINI_MAX_RPM, GEMINI_MAX_TPM, GEMINI_MAX_RPD e GEMINI_RATE_CONTROL_REQUIRED=true,
  e os limites de concorrência/lease aprovados. Nenhum valor foi inventado/aplicado.
- gemini_daily_limit por tenant é conferido via usageGate, mas sua contagem em static
  data do n8n NÃO é um orçamento durável/atômico entre workers. Isolamento de dados
  está preservado; quota rígida por tenant NÃO está comprovada. Para torná-la rígida,
  a aquisição precisa reservar orçamento global e do tenant na mesma transação/RPC,
  com identidade autenticada, idempotência por lease e configuração aprovada.
  Nenhuma RPC de produção foi alterada para fingir esse controle.

### Verificações pontuais e arquivos

14 grupos isolados em `C:/Users/jvsbj/AppData/Local/Temp/noria-prepublish-f32d0444-a2ad-46f1-9b81-a28206d4c110/`:
tabela ausente/parcial, tenant trocado, vendido/URL/caminho inválidos, combinação de
catálogo, ordinal após reordenação, CB 600RR/paráfrase, invenção rejeitada, timeout e
JSON inválido, bloqueio RPM, aquisição/reserva TPM, recibo antes de I/O, conflito de
reserva sem envio, texto sem retry, mídia incerta e bloqueio humano, SQL/RLS e upload.
SQL aplicado e reaplicado SOMENTE no PGlite isolado, com leitura entre dois tenants
e negação de escrita authenticated/consulta anon. NÃO é PostgreSQL de produção,
teste com duas conexões reais, chamada real de Evolution ou garantia de entrega.
17 checks locais anteriores do auditor também passaram; nenhuma nova chamada Gemini.

Alterados: n8n/sources/noria_core.js, n8n/sources/genesis_extension.js,
scripts/upload_genesis_inventory_images.cjs, migração de imagens e esta documentação.
Derivados: whatsapp_conversation_core.generated.js, whatsapp_sales.js, os dois JSONs
originais e build_manifest.json. Gerador existente reutilizado, sem refatoração.
Diff incremental e verificações de hashes/paridade ficam na pasta de evidências.
Diff global conserva os dois avisos anteriores de EOF no frontend, fora deste escopo.

Hashes finais deste pacote (19/10, 22h20 BRT):
- CORE normalizado: `8e5b15193d4df1112fe56b529f76ef885bd4d5957c7185dcae7c6892c47b4e7c`
- CORE disco: `ea8e56668c24d2123b04ed91497196ff5766cd6fdeca521620c58ea88d52e267`
- EXT: `36904449f32a890a387961d0036a5e22d7b24d59e3ec6cc316aeca516a68031e`

### Ordem de implantação futura e critérios para desbloquear

1. Congelar este pacote, exportar o par CORE/EXT atualmente publicado e settings,
   comparar hashes/conexões/credenciais sem expor segredos. Preparar rollback que
   comprovadamente respeite fotos desativadas: NÃO usar como rollback o snapshot
   local defeituoso que contornava flags. Não encerrar leases nem liberar filas.
2. Homologar com duas conexões PostgreSQL reais em ambiente controlado: reserva
   concorrente com mesma chave (apenas um insert), lost response, texto confirmado
   + mídia incerta, troca de token/expiração/controle humano e RLS de dois tenants.
   Nenhum dos testes pode executar envio real ou recuperar filas de clientes.
3. Confirmar configuração global RPM/TPM/RPD no n8n e decidir/implementar a política
   durável por tenant se o limite individual for requisito rígido. A tabela vazia
   e o contador local não satisfazem essa homologação. Parâmetros Gênesis/Núbia
   independentes exigem aprovação; sem copiar limites comerciais ou liberar retries.
4. Após autorização, aplicar SOMENTE a migração de imagens pendente revisada,
   mantendo fotos desativadas; conferir FK/RLS/grants/índice único de eventos e
   origem autenticada do tenant. Migração não cria vínculos nem faz upload.
5. Operação revisa visualmente cada associação arquivo → vehicle_id e assina o digest
   do dry-run. Hash local/remoto sozinho não substitui essa revisão. O script verifica
   ID/status atuais; divergência aborta. Rodar novamente o dry-run antes de aplicar.
   `node scripts/upload_genesis_inventory_images.cjs`
   Digest observado dos 11 mapeamentos+bytes:
   `e2ae52586e29b59303509a51370e4e498bc467c25a8d5da97196f8aa093aff6c`.
   Só após revisão/autorização:
   `node scripts/upload_genesis_inventory_images.cjs --apply --reviewed-mapping-sha256 <digest-revisado>`.
   Faz registro dos dez já idênticos e upload da Montana ausente, sem overwrite.
   Para atuar exclusivamente na Montana, incluir
   `--vehicle-id "chevrolet|montana|2013|branca"` no dry-run E no apply; usar o digest
   específico retornado por esse subconjunto, nunca o digest global acima.
6. Publicar em janela coordenada, após autorização separada: EXT primeiro (envelope
   compatível), CORE depois, sem misturar versões em turnos em andamento. Conferir
   os três nós CORE, identidade, gates, settings, recibos e logs no ambiente n8n.
   readiness da fila é requisito, não motivo para reaplicar RPCs já presentes.
   O novo contrato modules.product_images precisa estar presente no fluxo Gênesis;
   não publicar CORE novo com EXT antiga, pois clientes sem esse contrato conservam
   comportamento legado por compatibilidade com outros tenants.
7. Ativar somente sales.vehicle_photos_enabled=true após as etapas anteriores e
   autorização. Manter whatsapp_catalog_photo_enabled=false e catálogo vazio;
   não ativar sincronização/preços WhatsApp para habilitar Storage. Hosts externos
   só entram em catalog_media_allowed_hosts mediante necessidade e revisão própria.
   Confirmar tratamento de redirects/DNS do fetcher Evolution; allowlist do CORE
   não prova que um redirect externo ou DNS alterado será bloqueado pelo provedor.
8. Canary explicitamente autorizado: confirmar ID de aceite e evento/recibo da foto,
   sem inferir entrega ao dispositivo de HTTP 200/HEAD. Monitorar auditorias,
   latência, rate denials, reservas pendentes e controle humano. Sem autorecuperação.

Rollback: desativar fotos, suspender novas entradas de forma controlada e drenar os
turnos seguros; preservar todo estado incerto para reconciliação. Restaurar SOMENTE
o par exportado e previamente verificado como seguro; não o fonte local defeituoso.
Conservar tabela, vínculos, objetos e recibos para investigação, sem drops/deletes,
sem alterar claimed/pending, sem reenvio e sem reaplicar migração da fila.

**Veredito: BLOQUEADO para publicação completa e ativação de fotos.** Defeitos locais
corrigidos e artefatos preparados; faltam homologação real de concorrência/recibos,
configuração comprovada de rate control, revisão operacional dos vínculos, migração,
upload da Montana e ativação autorizada. A compatibilidade do build publicado e do
rollback também precisa ser conferida. Não declarar P0 encerrado com provas locais.

## Respostas naturais com prova de fonte — ajuste local de 19/10, não publicado

Este ajuste SUPERA a exigência de resposta em blocos literais da seção histórica
seguinte. `observations` integral continua somente em `facts[].value`, para ligar
o contrato à fonte autorizada. A resposta ao cliente e seu `excerpt` podem selecionar
detalhes pertinentes e parafrasear sem copiar toda a observação. Não há reescrita
posterior, lista de sinônimos, remoção de palavras ou nova política comercial.

### Contrato e execução

- Prompt/schema primários usam `fact_evidence_mode=semantic` para details/condition
  ou observations; demais respostas conservam standard. O CORE deriva a necessidade
  também do plano e dos IDs dos fatos; declarar standard não contorna essa exigência.
  `verbatim` legado é aceito somente com a mesma verificação semântica.
- IDs, valor integral da fonte, produto, remapeamento ordinal, ledger final, excerpts
  literais, centavos e provas de execução continuam com validação determinística.
  Contrato primário estruturalmente inválido não provoca chamada corretiva.
- Após essa validação, somente os turnos que exigem prova semântica recebem UMA
  chamada independente `dialogue_audit`, usando o modelo configurado e os controles
  existentes de quota, concorrência, circuito e timeout, sem retry da chamada. A
  geração primária continua única. A chamada adicional é necessária para avaliar
  paráfrases/negações sem heurísticas de vocabulário; acrescenta consumo e latência.
- O verificador recebe somente resposta, claims e fontes revalidadas do ledger final,
  com identidade de tenant/sessão/token/produto. Avalia o texto inteiro, pressupostos
  de perguntas, atribuição, qualificadores e fatos omitidos do contrato. Não produz
  nova resposta nem autoriza ações comerciais.
- A saída particiona toda a resposta sem apagar caracteres. Cada segmento factual
  exige fonte exata e claim com excerpt vinculado. Só segmentos genuinamente sem
  afirmações podem ser non_factual. Contradicted/unsupported/uncertain, cobertura
  incompleta, fonte divergente, JSON inválido, timeout ou quota bloqueiam a aprovação.
- Aprovação estrutural do relatório cria prova opaca em WeakMap local; um booleano
  ou relatório serializado não aprova o turno. Antes de aceitar, o CORE revalida o
  contrato e a identidade exata de texto/contrato/plano/ledger/produto. Alteração
  durante o await invalida a prova. O relatório fica em raw_payload.dialogue_audit.
- Fotos, fila, bloqueios humanos, EXT e ordem CORE → EXT → CORE permanecem intactos.
  Rejeição segue o fluxo seguro existente; não há liberação de review/uncertain.

### Homologação pontual

Evidências isoladas em
`C:/Users/jvsbj/AppData/Local/Temp/noria-natural-evidence-688d1775-b070-49f0-a5f3-1ebce191ac55/`:

- `offline-results.json`: 17 verificações do runtime gerado, incluindo prova forjada,
  cobertura, fonte/produto/escopo divergentes, mudança durante await, timeout,
  truncamento, preço não autorizado e ausência de chamada extra no caminho standard.
- `live-results.json`: 7 casos reais com Gemini `gemini-3.5-flash-lite`, modelo do
  snapshot da execução 393479: duas paráfrases naturais aceitas e cinco rejeições
  (negações nos dois sentidos, km inventado, atributo omitido e pergunta com premissa
  falsa). Dados exclusivamente fictícios.
- `primary-live.json`: `salesGenerate` real, prompt/schema canônicos e verificador
  real aprovaram `O anúncio informa que os pneus são novos.` a partir de observação
  maior, sem exigir revisão/km no texto. Plano e contrato foram gerados pelo modelo.
  O transporte isolado não executou runTurn, Supabase, EXT, Evolution ou publicação;
  rate limiter distribuído e execução completa do n8n não foram homologados aqui.

A prova semântica continua probabilística: um relatório estruturado não demonstra
entailment matemático. Os casos cobrem o defeito, sem afirmar correção universal.
Durante a homologação, outro editor alterou CORE/EXT (fotos/inventário). O snapshot
concorrente foi preservado; o ajuste deste auditor foi reincorporado por função,
mantendo as alterações independentes. Uma cauda duplicada inválida no fonte foi
retirada e preservada separadamente. As funções homologadas foram comparadas ao
build final; os demais deltas concorrentes NÃO receberam homologação funcional
nesta tarefa. Os diffs do ajuste e da integração ficam separados na pasta de evidências.
Publicação somente para teste controlado após conferir o build publicado versus
local, contratos da fila e acesso ao modelo. O manifesto ainda marca implantação
coordenada e `production_approved=false`; esses requisitos não foram aprovados nem
removidos por este ajuste. Monitorar rejeições e latência/quota. Rollback: restaurar
o build publicado anterior previamente exportado; não tocar filas nem reenviar lotes.

## Histórico: auditor literal — ajuste local de 19/10, 21:45 BRT (superado acima)

Este delta parte do estado local atual, incluindo as correções anteriores do
Claude para geração/contratos e as alterações de fotos do Gemini. Não foi usado
checkout antigo. Esta seção SUPERA a aceitação de fragmentos de observations
descrita no histórico abaixo, sem apagar aquela investigação.

### Evidências e causa-raiz

Consultados em leitura os eventos do Supabase e copiadas, pela UI autenticada,
as saídas integrais de prepare e EXT comercial das cinco execuções. Em TODAS,
generated voltou idêntico da EXT: o problema já existia no contrato primário.

| Execução | Incompatibilidade observada |
| --- | --- |
| 392676 | value de observations trocou uma palavra do ledger; excerpt também parafraseou a informação |
| 392690 | excerpt monetário era `3498000`, ausente da resposta que mostrava `R$ 34.980,00`; observações mencionadas sem fact correspondente |
| 392756 | facts.model apontava `CB 600RR`, embora a resposta fosse apenas uma pergunta sobre pagamento |
| 392773 | excerpt dizia `revisada, com pneus novos e quilometragem baixa`, diferente da redação efetivamente gerada |
| 393479 | excerpt `revisada, pneus novos` não aparecia na resposta; `motor de alta performance` foi acrescentado sem fonte |

O contrato antigo ligava value ao ledger e excerpt ao texto em verificações
independentes, sem provar que o texto dizia o mesmo valor. Aceitar substrings de
observations já permitia remover um qualificador/negação; a lista cleanSegment
ampliava essa equivalência inventada ao apagar palavras e recombinar trechos.
As instruções anteriores de cópia literal foram preservadas e reforçadas, mas
instrução/schema de string não provam equivalência semântica nem cobertura.

### Contrato implementado

- observations exige o valor INTEGRAL, exatamente como autorizado no ledger.
  Não há plain/cleanSegment, divisão por conjunções, lista de palavras ou relaxamento
  por semelhança. Cópia parcial/paráfrase não comprovável permanece rejeitada.
- response_contract passa a exigir fact_evidence_mode: standard ou verbatim;
  cada facts item exige source_product_id (string vazia se não pertence a produto).
  Para details/condition ou qualquer observations, o auditor exige verbatim e um
  ledger final, independentemente do modo que o modelo tentou declarar.
- Em verbatim, a resposta inteira deve conter somente blocos de fatos autorizados,
  separados por linha em branco. Cada excerpt é o bloco completo, literal da resposta;
  value e excerpt devem corresponder AO MESMO fato. Texto fora desses blocos é
  UNVERIFIED_FACT_RESPONSE_TEXT, inclusive comentários, negações, características
  ou números omitidos de facts. Prefixos/sufixos não são ignorados.
- O ID do produto do fato deve coincidir com source_product_id, o ledger final e
  o produto selecionado. Produto trocado entre prepare/finalize invalida o namespace
  official.product; inventory.N continua sendo remapeado pelo ID, nunca pela posição.
- O parser monetário do Claude permanece inalterado: unidades e igualdade exata em
  centavos, sem arredondar ou autorizar outro preço. Excerpts voltam a ser estritamente
  literais; foram removidas as substituições linguísticas legadas de contrações.
- O prompt e o schema primários instruem esse formato antes da geração. Não há
  pós-processamento da redação nem segunda chamada Gemini. CORE valida evidência;
  EXT continua sendo a autoridade comercial e Gemini continua escolhendo os fatos
  pertinentes, os pedidos e a resposta dentro do contrato verificável.

### Anti-hardcode e checks

O verificador anterior procurava algumas frases e nomes de interceptadores;
não inspecionava a estrutura de transformações no comparador. Agora usa AST do
TypeScript para visitar salesFactValueMatches e helpers chamados, detectando
replace/replaceAll/split com alternativas de palavras literais em regex. Não existe
blacklist de palavras de português. O baseline com cleanSegment é sinalizado mesmo
renomeando o helper. IDs/centavos/BRL e classes/escapes técnicos não são tratados
como vocabulário. É uma proteção específica para essa classe, não uma prova geral
de ausência de toda heurística semântica possível em qualquer código.

31 checks isolados passaram com as funções reais: observação integral positiva e
negativa; inversão nos dois sentidos; remoção de negação; prefixo/novo parágrafo
negativo; atributo inventado; facts omitidos; km ausente; preço correto/divergente;
outro produto; troca de seleção; ordinal reordenado; excerpt ausente; ledger/modo
ausentes; regressão de resposta monetária standard e cinco contratos reais ainda
recusados mesmo após preencher os novos campos de identidade. Auditoria estrutural
sinaliza o baseline e aceita o código atual. Não houve Gemini real, testes extensos,
escrita no Supabase, upload, envio ou publicação.

Sintaxe e diff incremental sem erros. O git diff --check global ainda acusa linhas
em branco no EOF de app/src/services/media/storageErrors.js:18 e
app/src/styles/components/attachments-location.css:332; esses arquivos pertencem
ao trabalho local anterior e não foram alterados por este ajuste.

Fontes alteradas: n8n/sources/noria_core.js e scripts/audit_anti_hardcode.cjs, além
deste registro. Regenerados CORE workflow, whatsapp_conversation_core.generated.js,
whatsapp_sales.js e build_manifest.json nos caminhos originais. Gerador, EXT,
fotos/OCR, prepare, ownership, commit/complete e fila foram preservados.
CORE local: 3c62b28eb6a268563b319912aeb0ef50607e14a0d805d1d1ad04ca473449390a.
EXT inalterada neste delta: 7985d18565a8c6b510d854734d6740418776bb0f55ab1753ef86f1414499291b.
Build UTC 2026-10-20T00:45:48.551Z = 19/10, 21:45:48 BRT; o sufixo UTC da revisão
é o comportamento já existente do gerador, não outra publicação.

### Limites e publicação

Este modo deliberadamente NÃO aceita prosa livre, paráfrases, perguntas adicionais
ou múltiplos produtos sem foco verificável numa resposta de detalhes. Não há prova
determinística dessas equivalências no contrato atual. Para liberar redação livre
no futuro será necessário um contrato de evidência adicional revisado, não outra
lista de palavras. A pertinência conversacional e a aderência real do modelo ao
novo formato ainda exigem homologação autorizada; os checks locais não provam isso.
Os demais turnos mantêm o modo standard e os validadores já existentes.

Publicação permanece proibida até nova autorização. Revisar o delta, exportar e
comparar a versão ativa e atualizar somente os nós CORE afetados, preservando IDs,
conexões e configurações. Não reaplicar SQL, não republicar EXT nem recuperar filas.
Rollback repõe o CORE anterior; não modifica recibos, ledger, bloqueios ou mensagens.
O diff incremental separa este ajuste de todo o trabalho local anterior.

---

## Fotos e envelopes de álbum — execuções 391179 e 390940 (19/10, ajuste local)

Conferidas pela UI autenticada do n8n as saídas integrais dos dez nós executados
em CADA execução, incluindo bootstrap, claim/dispatch, EXT por turno, prepare,
EXT comercial, gates e finalize. Não houve reexecução, alteração nem publicação.
As cópias de cada nó estão no artefato local `noria-photo-contract-09296fc6-d0b1-4874-ba3f-28961d50858c`.
O recorte antigo abaixo mantém seus limites históricos; esta seção registra a
nova evidência obtida às 17:28–17:34 BRT.

### Causa comprovada e localização da ausência do contrato

- 391179: quatro JPEGs stored/verified e um evento separado `[album]`.
- 390940: dois JPEGs stored/verified e um evento separado `[album]`.
- Em ambos, o canal persistiu o envelope com `channel_type=whatsapp`,
  `content_type=album`, IDs próprios e SEM `media`/`source_media`. Não é uma quinta
  ou terceira foto, nem há prova persistida da associação individual ou do total
  esperado do álbum. A correção não inventa esses vínculos/contagens.
- `salesMediaCapability` rejeitava qualquer marcador além de image/document/audio/
  video. O marcador album tornava TODO o lote unsupported/unknown. O prepare
  pulava `salesReadMedia` e `salesGenerate`, criando apenas um aviso técnico com
  `media_notice=unknown`. Nas saídas reais: documents=[], dialogue_plan=null,
  primary_reply/response_contract/model/usage ausentes. Não houve resposta primária
  Gemini malformada: a chamada primária sequer foi alcançada nesse caminho.
- `generated` é idêntico no prepare e na saída da EXT comercial dos dois casos.
  O contrato não se perdeu na projeção EXT. O finalize auditou o aviso sem plano/
  contrato e recusou corretamente: INVALID_PRIMARY_REPLY, MISSING_PRIMARY_PLAN,
  MISSING_RESPONSE_CONTRACT. O workflow confirmou o envio da contingência, com
  ai_processing_ok=false. Stored/verified prova ingestão, não análise pelo modelo.
- Hash do CORE nos dois eventos: 49a9af134357997a8fd18fb1d04c888374d8255564d0b8a0ec1737750d0b5fe0;
  build 19:15:43.838Z, o mesmo baseline local anterior ao ajuste.

### Correção pontual

`n8n/sources/noria_core.js`: `salesAlbumEnvelope` reconhece somente o envelope
WhatsApp comprovado pelo tipo persistido, marcador, ambos os IDs e ausência de
descritor binário. O filtro de capacidade e o cálculo de imageOnly/videoOnly
desconsideram somente esse envelope para classificar arquivos, sem removê-lo de
turn.messages, claim, receipts ou grouped_message_ids. Um `[album]` literal sem
essa origem, um descritor contraditório ou outro formato desconhecido continuam
sujeitos às proteções existentes.

O lote segue para leitura/classificação das imagens reais e UMA geração primária
estruturada. O prompt conserva os IDs de mensagem e de evento de cada mídia e
projeta os envelopes em `media_envelopes`, separados das fotos/documentos.
Não são enviados pixels do envelope, não são sintetizadas descrições nem novas
associações de álbum. OCR privado e classificação visual continuam nos caminhos
existentes. Contratos inválidos continuam recusados pelo parser/auditor original;
nenhum guardrail foi relaxado nem aviso foi promovido a resposta Gemini válida.

Gerador existente executado, sem modificá-lo. Regenerados o CORE workflow nos
caminhos originais, `whatsapp_conversation_core.generated.js`, `whatsapp_sales.js`
e `build_manifest.json`. EXT workflow permaneceu byte a byte idêntico. CORE novo:
401f69c493480ad2dae09833ede68ec5327415f87b9be890c463afde98822c7b (somente local).

### Retry separado, estado operacional e pendências

O erro TURN_RETRY_NOT_QUEUED:retry_policy_missing de 17:03:38 pertence a OUTRO
turno, posterior à execução 390940: token 0f86b487-bcb6-4a2d-842c-2446cd14dcbc,
evento c0e957ff-85a4-459c-be16-e8b5c8b34c4f (texto recebido às 17:03:17).
Chegou nova mensagem às 17:03:32 antes do commit. `magia_commit_turn` recusou
com new_messages; `complete('retry')` acionou a política durável. A RPC reteve
review por retry_max_attempts/base/cap ausentes. Não é retry do envio confirmado
da contingência de fotos. Evento técnico 4e24dcb9-9d8c-4217-ba36-5ec4e7d7e710:
turn_committed=false, provider_accepted=false, delivery_confirmed=false.

Leitura às 17:33:42: conversa hash 5c975910 continua review, ticket
bcd46ded-4fdc-47b2-b136-695affad252f/revisão 3, um claimed e três pending preservados,
current_delivery_id=NULL. Nenhum retry foi aprovado/configurado, nenhuma resolução
ou recuperação foi executada. Depende de política técnica explicitamente aprovada
e resolução autorizada desse ticket com nova validação das provas.

Fiat Toro, hash 4ba8066e: atribuição humana a35492ed-2c19-4317-9bda-a301e9696c8f
às 17:18:08; lead 841c95ca-6f3b-489e-99a4-19fc5736d56e permanece sales_human,
ai_locked=true/revisão 7. Fila ready/0/0. Não foi removido bloqueio humano.

Validações pontuais: 19 verificações isoladas com os lotes reais capturados e
provedor simulado, sem dados de imagem reais reenviados. Reproduzido unknown no
baseline; conferidos 4+envelope e 2+envelope, IDs imutáveis, caminho de fotos já
solicitadas e caminho de classificação multimodal, request primário com schema,
JSON malformado/truncado rejeitado e contrato ausente recusado. Isso não comprova
a interpretação visual de uma chamada Gemini real. Gate/ownership, commit,
complete, finalize e auditor permaneceram idênticos ao baseline; conferida paridade
das três fases geradas, EXT inalterada, sintaxe e auditoria anti-hardcode.
Sem bateria extensa, chamadas Gemini/Evolution reais, SQL de escrita ou alteração
da política comercial. Publicação do CORE corrigido e homologação controlada
continuam pendentes de autorização; não declarar estes P0 resolvidos em produção.

Rollback de eventual publicação: repor o CORE publicado anterior preservando IDs,
configurações, ledger, recibos e lotes retidos. Não desfazer envios confirmados nem
restaurar manualmente mensagens já consumidas; a EXT não precisa ser republicada.

---

Revisão restrita a EXT → CORE → auditor de fatos, em 19/10/2026.
Atualização: corrigidas localmente a divergência entre auditoria factual/monetária,
a autoridade do snapshot final, referências posicionais de produto e a perda de
observations na projeção EXT → ledger. Fontes e artefatos foram regenerados.
Nenhuma alteração no Supabase, publicação de workflows, política comercial ou conversa.
Consultas remotas de evidência somente SELECT/GET. Sem Gemini real, Evolution ou
reexecução de atendimento. O diagnóstico inicial abaixo é preservado como baseline;
o resultado da implementação está em "Correções implementadas e validação final".

## Recorte e limites da evidência

Recorte confirmado pelo usuário: desde 18/10/2026 às 00:00 de Brasília
(2026-10-18T03:00:00Z), considerando o último workflow publicado.
O build mais recente IDENTIFICADO NOS EVENTOS é o CORE
`4f85d2544b82f7d5d073c97dbce5cd4e2389df2dd22ebaaa9dd2b2bc3c55e05e`,
revisão `conversation_core_v2_1_34_core_ext_decision_identity_2026_10_18`,
build_timestamp 2026-10-18T20:43:02.230Z, workflow `3N5oN6sxtir9lFrA`.
Último evento com essa telemetria encontrado: execução 387959, 19/10 às 14:35:32 BRT.
Não foi obtido export da definição ativa do n8n nem o runData completo das execuções;
esses metadados demonstram o build executado, não o estado atual do editor/publicação.

No recorte, `nullif(ai_error,'') is not null` retorna **72 eventos**, dos quais
**35 pertencem ao build mais recente observado** (4 em 18/10 e 31 em 19/10).
Os 37 demais pertencem a builds anteriores ou não têm hash. O total 44 do relato
não foi reproduzido com esse critério; não foi ajustado artificialmente.
Uma amostra inicial dos 44 erros não vazios mais recentes foi mantida separada e
NÃO é usada como se fosse o conjunto exato do último build.

Nos 35 eventos: **28 respostas de dificuldade técnica**, **5 recuperações com
catálogo** e **2 recuperações pela política de financiamento da EXT**.
Erro no campo ai_error não equivale, portanto, a 35 respostas técnicas ao cliente.
O status persistido `sent` indica registro de envio, não leitura pelo destinatário.
Ausência de ai_error na Núbia não foi tratada como prova de correção das respostas.

## Baseline local anterior à implementação

CORE local: `f0c32d6e5cca07244585e4ad1916e2d0dc7553458b7965a7daedd376b98cc15d`.
EXT local e EXT registrada nos quatro casos de referência:
`e5763805d336cde2de532cabd5b02c0c1d98564271cec4c47768af669056030f`.
O CORE local difere do executado; a EXT desses casos já tem o mesmo hash local.

Hash normalizado da fonte, manifesto, runtime gerado e os três nós CORE no JSON
canônico foram comparados e estão consistentes. O hash da EXT também confere.
Na comparação inicial não se executou o gerador. Na implementação posterior ele
foi executado após alterar as fontes; hashes finais constam abaixo.

## Casos de referência — diagnóstico anterior à implementação

| Caso | Evidência persistida | Situação na versão local |
| --- | --- | --- |
| Alex — 387942; anterior 387815 | category/raw_mention rejeitados; cliente recebeu dificuldade técnica após perguntar sobre compra de carro com documentos atrasados e motor batido. | A nova passagem do ledger aceita raw_mention persistido no probe de compatibilidade. Category não pode ser declarada resolvida: estado atual está unknown e faltam valor/excerpt originais. Não há prova de replay completo corrigido. |
| Renata — 387872; anterior 387826 | Preço anunciado, entrada e R$ 11.980 rejeitados; em 387826, entrada de R$ 6.000 rejeitada. Houve resposta técnica. | Fatos da entrada passam a ser reconhecidos pelo ledger final, mas o auditor monetário ainda rejeita R$ 6.000 quando esse valor só aparece no ledger final. Pendência reproduzida. O saldo de R$ 11.980 continua sem fato comercial explícito autorizado pela EXT. |
| Everton — 387520/387593 | official.business.locations.0.address rejeitado; resposta técnica. Entre esses casos houve resposta de endereço em 387563. | Endereço atualmente configurado é aceito com ledger final e rejeitado no probe sem ele. Isso confirma cobertura estrutural, não que o valor/excerpt original de ambas as respostas fosse idêntico. Referência geográfica adicional exige prova própria. |
| Herberton — 387693 | UNANSWERED_REQUEST e UNFULFILLED_CATALOG_REQUEST; dialogue_recovery=grounded_catalog. | Já recebeu catálogo com oito itens em produção. O catálogo persistido passa no auditor local com contrato de resposta reconstruído. O contrato original do Gemini não foi recuperado: não é possível chamar a rejeição inicial de falso positivo ou afirmar que a geração original foi corrigida. |

## Contrato — diagnóstico anterior à implementação

1. **Correção estrutural presente:** a finalização reconstrói `auditLedger` e passa
   `fact_ledger` e `authorized_facts` da decisão EXT ao auditor
   (`n8n/sources/noria_core.js`, aproximadamente 10925–10939). O auditor combina
   primary_facts com fact_ledger (aproximadamente 8573–8585). Isso cobre fatos que
   surgem após prepare, desde que seus IDs, valores e excerpts sejam válidos.
2. **Pendência monetária comprovada:** `allowedMoney` nasce de primary_facts
   (aproximadamente 8623), recebe preços do inventário/produto e execution.deposit_cents
   (aproximadamente 8735–8741), mas não os valores de execution.fact_ledger.
   A chamada final passa o ledger, porém não execution.deposit_cents. Assim,
   uma entrada persistida após o snapshot primário continua produzindo
   UNSUPPORTED_AMOUNT mesmo quando reported.deposit_cents está autorizado.
3. **Saldo/parcela não podem ser inventados pelo CORE:** a EXT fornece a entrada
   em operations.financing.deposit_cents, mas seus authorized_facts não projetam
   saldo parcelável ou valor de parcela nesse contrato. O bloqueio de R$ 11.980
   persiste no probe; não foi removido nem se calculou política no CORE.
   Antes de autorizar esse valor, é necessário identificar no trace qual operação
   comercial o originou e se existe autoridade para ele, inclusive taxas/prazo.
4. **Campos/aliases ainda exigem classificação:** observations e km ausente não
   podem virar informação afirmada sem fonte. Aliases de policy/rules fora dos IDs
   emitidos pela EXT não devem ser liberados por uma whitelist genérica no CORE.
   Índices de inventário exigem os snapshots e contratos originais para verificar
   correspondência, ordem e identidade do produto. O ledger final não prova que
   toda referência numérica antiga é válida.
5. **Pedidas sem resposta e contratos ausentes:** validar sem primary_reply,
   plano ou response_contract continua sendo rejeitado. As execuções 385638 e
   386483 requerem o runData para localizar se a perda ocorreu em geração,
   prepare, transporte EXT ou finalize. Não se deve tornar o auditor permissivo.
6. **O sintoma de resposta técnica continua possível:** salesRecoverSafeDialogue
   retorna a contingência técnica; qualquer rejeição não recuperada pelos caminhos
   específicos ainda chega a esse texto. Publicar o local não garante, por si só,
   resolver os casos monetários ou respostas efetivamente incompletas.

Identidade/proveniência de commercial_decision continuam verificadas antes dos
efeitos comerciais. Nenhuma regra foi transferida da EXT para o CORE.

## Validação pontual inicial, antes das correções

Sete probes no runtime gerado real, com HTTP bloqueado e sem chamada ao modelo:

- raw_mention persistido de Alex: rejeita sem ledger final, aceita com ele;
- endereço atualmente configurado: rejeita sem ledger final, aceita com ele;
- entrada persistida de Renata: fato aceito com ledger final, valor monetário ainda rejeitado;
- preço atual do produto selecionado: aceito pelo auditor;
- valor registrado de R$ 11.980: continua rejeitado sem fato comercial autorizado;
- resposta de catálogo já persistida de Herberton: aceita com contrato reconstruído;
- controle negativo de endereço inventado: continua rejeitado.

São provas de compatibilidade e reprodução pontual, NÃO replays históricos.
Settings e leads lidos são os atuais, não snapshots dos instantes das execuções.
O banco não persiste nos eventos consultados o primary_reply rejeitado, o
response_contract original, primary_facts ou toda a decisão EXT daquele instante.
As cópias privadas de evidência e o resultado dos probes estão sob
`scratch/incident-contract-review-2026-10-19/`, ignorado pelo Git. Não incorporar
conversas, JIDs, credenciais ou dados pessoais brutos ao relatório versionado.

## Evidência histórica ainda necessária

Obter export somente leitura das execuções 387942, 387872, 387520/387593 e 387693,
com saídas de prepare, EXT comercial e finalize, além da definição publicada.
Confrontar reply/answers/facts/authorized_facts, produto, estado, ledger, identidade
e erros originais para fechar cada incidente histórico. A correção local descrita
abaixo não autoriza liberar indiscriminadamente valores ou calcular parcelas no CORE.

Não publicar o build local como solução definitiva desta análise. P0 não encerrado.

## Correções implementadas e validação final

### Corrigido e reproduzido localmente

- **Renata / dinheiro:** salesValidatePrimaryDialogue usava execution.fact_ledger
  para fatos, mas primary_facts para allowedMoney. Antes: UNSUPPORTED_AMOUNT:600000.
  Depois: accepted com a entrada persistida no ledger final, sem mudar o valor.
  salesAuthorizedMoneyValues agora é compartilhado com validateDraft. Reconhece
  somente preços oficiais, reported.deposit_cents e campos monetários explicitamente
  autorizados pela EXT; campo arbitrário do estado/Gemini não vira permissão.
  Extração CORE e EXT conferida contra a mensagem disponível: ambas retornam
  600000 centavos. A sanitização mantém o valor vinculado ao ID de evidência.
- **Autoridade única:** a presença de fact_ledger torna esse snapshot obrigatório.
  primary_facts não ressuscita chaves ausentes, preços antigos ou declarações
  substituídas. O ledger final não é mais podado por flags de apresentação do plano;
  perguntas atuais continuam auditadas separadamente. SKU selecionado é atualizado
  com a linha autorizada pela EXT, inclusive em sua projeção de inventário.
  Foco explicitamente revogado pela EXT é excluído do inventário de auditoria.
- **Valores de fatos:** com ledger final, não há aceite por aproximação de modelo,
  marca/ano/preço de OUTRO atributo, nem pela mera existência de uma chave reported.
  Duplicatas conflitantes e formatos inválidos são rejeitados com diagnóstico.
  Endereço canônico passa; endereço inventado e entrada divergente continuam rejeitados.
  Apenas normalização técnica de caixa/espaços e aliases de schema existentes são
  preservados; não foram inventadas equivalências geográficas.
- **Alex / categoria:** fixture anonimizada com categoria semântica e ID de mensagem
  válido passa pela sanitização → ledger → auditor. Sem evidência, categoria se torna
  unknown e não é emitida como fato conhecido. raw_mention vinculado ao estado passa.
  Não há regex nova para decidir se a pergunta descreve carro próprio ou política de compra.
- **Produtos numerados:** um fact_id official.inventory.N.field é associado ao ID do
  produto que ocupava N no snapshot entregue ao modelo. Filtragem/reordenação no final
  não troca a identidade do SKU. Se esse produto/campo não está autorizado no final,
  a referência é recusada. Fixture com ordem invertida conferida.
- **Catálogo:** resposta persistida de Herberton aceita com contrato reconstruído;
  seleção ordinal posterior resolve o mesmo SKU mesmo com o inventário reordenado.
  No bloco final real, recuperação/contexto recebem atributos atuais do SKU autorizado
  pela EXT e removem foco revogado, mantendo IDs/ordem dos itens remanescentes.
  Não foi adicionado fallback que transforma consulta específica em catálogo geral.
- **Valores derivados:** R$ 11.980 continua bloqueado sem autorização. Uma fixture
  explicitamente autorizada pela EXT permite um fato monetário derivado; é apenas
  teste do contrato, NÃO fato emitido pela EXT atual. Nenhuma conta preço−entrada,
  taxa, prazo ou oferta foi introduzida no CORE ou na política da EXT.

### Corrigido por evidência estática, sem replay real do incidente

- EXT commercial.decide disponibilizava produto sem observations, enquanto o contexto
  para Gemini podia conter esse campo. O ledger também o omitia. authorized_product
  e o ledger agora preservam observations da linha autorizada, mantendo null quando
  ausente. A operação EXT real foi exercitada localmente com settings disponíveis e
  produto de fixture, passando o resultado ao ledger e ao auditor. Isso cobre a
  quebra demonstrada de projeção; não prova qual texto de Renata 387806 foi rejeitado.
- Planos/campos de resposta malformados retornam INVALID_RESPONSE_CONTRACT, sem
  ampliar permissões ou substituir o conteúdo por uma resposta comercial pronta.
- O snapshot inicial versus final e o conjunto monetário agora usam a mesma autoridade.
  Não foi modificado o fallback; deixam de cair nele os casos legítimos cobertos pelo
  contrato corrigido, sem esconder rejeições reais.

### Ainda não comprovado / não alterado por falta de evidência

- O valor/excerpt exato de category em Alex 387942 e os IDs de evidência da saída
  original do Gemini. O estado lido posteriormente com unknown não prova a saída original.
- A origem comercial de 1198000 e o texto original sobre parcela em Renata 387872.
  A EXT atual não emite fato de saldo/parcela para isso. Condições de cartão, juros,
  prazo e aceitação comercial não foram criadas ou inferidas a partir da aritmética.
- Valor, excerpt e ledger originais dos endereços em 387520/387593. Não se mudou
  indexação de múltiplas localizações sem evidência de que ela causou esses casos.
- O contrato primário de Herberton 387693: por que answers não atendia request_1 e
  por que não apresentava catálogo. O anúncio original pode ter foco específico;
  texto genérico de entrada não prova qual produto era o alvo. A recuperação já
  entregue não foi contabilizada como perda de resposta.
- Os contratos ausentes de 385638/386483. A validação continua rejeitando ausência
  de reply/plano/contrato; falta localizar a origem da ausência no runData.

### Verificações finais e arquivos

Pontos exatos no fonte final:

| Arquivo e linha | Função / quebra corrigida |
| --- | --- |
| n8n/sources/noria_core.js:7958 | validateDraft: mesmos fatos e mesmo conjunto monetário, sem bypass de reported |
| n8n/sources/noria_core.js:8525 | salesAuthorizedMoneyValues: unidades, namespaces e autorização monetária |
| n8n/sources/noria_core.js:8537 | salesValidatePrimaryDialogue: snapshot final, shape, valores e vínculo de SKU |
| n8n/sources/noria_core.js:8671 | allowedMoney recebe auditFacts, não um snapshot primário paralelo |
| n8n/sources/noria_core.js:8828 | salesDialogueFactLedger: atributos, valores atualizados e categoria conhecida |
| n8n/sources/noria_core.js:9481 | runSalesTurnFinalize: projeção EXT, catálogo e chamada final do auditor |
| n8n/sources/noria_core.js:10988 | auditInventory/auditLedger: revogação da EXT e snapshot sem poda de apresentação |
| n8n/sources/genesis_extension.js:1192 | executeBusinessOperation/commercial.decide: observations preservada |

Verificações direcionadas em dois grupos: quatro casos acima e controles negativos
de autoridade, mais atualização de SKU revogado/preço antigo e consistência do
validador secundário. Sem suíte extensa ou arquivos novos de testes no repositório.
Resultados: `scratch/incident-contract-review-2026-10-19/structural-fix-checks.json`
e `complementary-fix-checks.json`; não são runData reais nem testes em produção.
Sintaxe, paridade fonte/runtime/três nós CORE, hashes, gates/conexões e diff conferidos.
Auditoria anti-hardcode passou. As funções alteradas no CORE são somente
validateDraft, salesValidatePrimaryDialogue, salesDialogueFactLedger e
runSalesTurnFinalize; foi adicionado salesAuthorizedMoneyValues. Na EXT, a única
diferença funcional é a projeção de observations em executeBusinessOperation.
Identidade, sessões, queue lifecycle, envio e caminhos da Núbia não foram alterados.
O diff incremental dos oito arquivos passou em git diff --no-index --check.
O git diff --check global ainda acusa uma linha vazia preexistente em
app/src/services/media/storageErrors.js:18, fora desta alteração e preservada.

Fontes: n8n/sources/noria_core.js e n8n/sources/genesis_extension.js.
Artefatos: whatsapp_conversation_core.generated.js, whatsapp_sales.js, os dois JSONs
canônicos CORE/EXT nos caminhos originais e n8n/build_manifest.json. O gerador existente
foi usado sem alteração. Nenhuma RPC, migração, ticket ou fila foi modificada.

Hashes locais finais:

- CORE normalizado: f9d4b6699e51e7fe5dff8662a0d883ce4ea0ff82391a6a91284ed5ee989292f5.
- Fonte CORE em disco com metadados (raw_disk_sha256 do manifesto): 534313f09435a0a4e29af647bee72c7758a348db7a826b95aa4c5536f1fef52c.
- Runtime gerado com prefixo de fase: 66e85f75d93ed9aa228321113dda7afe45c93b94cf45304a10c557109c2464c5.
- EXT: 91ec891c1f473d17a2b1be35a537931f62e0bdebe77dfe3dfcba3c3718a0a58b.

Hashes diretos dos demais artefatos regenerados (bytes locais):

| Artefato | SHA256 |
| --- | --- |
| n8n/code/whatsapp_sales.js | f42093e75430d4a1feaaac1ba00b0e4d95cf2db31825c8a5256eac0d3f4c04ba |
| JSON canônico NORIA CORE | bb7767bc1e526ed3cf028f09083f2dbb0d9654eba82d283377218f2407b9d859 |
| JSON canônico NORIA EXT Gênesis | 256f7dac48bb1a207576dcaeaaf94b0624871c5b284ee5dff4d6ebdd066fb179 |
| n8n/build_manifest.json | 4bcd3d516eeb2120f470cd643cc576a97eb21ce7936903bdb6c8c0aef9985f16 |

Para homologação histórica, obter somente as execuções prioritárias e anteriores
necessárias, com runData dos nós prepare, EXT e finalize, mensagens agrupadas,
semantic_intent/evidence_ids, primary_reply, response_contract, primary_facts,
commercial_decision/authorized_product/authorized_facts, ledger e recuperação, além
do export ativo. O conector/API n8n não estava disponível nesta investigação;
as URLs locais/internas configuradas não fornecem esses exports autenticados.
Rollback local pode restaurar somente este diff a partir do snapshot da tarefa,
preservando o trabalho anterior. Nenhum rollback ou deploy foi executado.
Correções locais prontas para revisão; os incidentes históricos e o P0 não estão
declarados encerrados sem runData/homologação e implantação coordenada.

## Inventário dos 35 eventos do build observado (baseline de produção)

| Execução | Data BRT | Falhas registradas | Resposta persistida |
| --- | --- | --- | --- |
| 369318 | 18/10/2026, 17:54:40 | UNSUPPORTED_FACT:official.business.trade_in_policy.accepted_subject_to_appraisal | contingência técnica |
| 370140 | 18/10/2026, 18:47:58 | UNANSWERED_REQUEST:request_1 | contingência técnica |
| 371120 | 18/10/2026, 19:56:58 | UNANSWERED_REQUEST:request_1; UNANSWERED_REQUEST:request_2 | contingência técnica |
| 371170 | 18/10/2026, 19:59:32 | UNSUPPORTED_FACT:reported.customer_vehicle.raw_mention | contingência técnica |
| 379361 | 19/10/2026, 06:07:53 | UNFULFILLED_CATALOG_REQUEST | grounded_catalog |
| 379828 | 19/10/2026, 06:42:28 | UNSUPPORTED_FACT:official.rules.rejected_purchase_brands.0 | contingência técnica |
| 381187 | 19/10/2026, 08:22:42 | UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 381220 | 19/10/2026, 08:24:13 | UNSUPPORTED_FACT:reported.customer_vehicle.brand; UNSUPPORTED_FACT:reported.customer_vehicle.model | contingência técnica |
| 381252 | 19/10/2026, 08:26:05 | UNSUPPORTED_FACT:sell_brand; UNSUPPORTED_FACT:sell_model; UNSUPPORTED_FACT:sell_year | contingência técnica |
| 382391 | 19/10/2026, 09:37:53 | UNANSWERED_REQUEST:request_1; UNFULFILLED_CATALOG_REQUEST | grounded_catalog |
| 382547 | 19/10/2026, 09:45:25 | UNANSWERED_REQUEST:request_1; UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 382594 | 19/10/2026, 09:47:42 | UNSUPPORTED_FACT:sell_model; UNSUPPORTED_FACT:sell_year | contingência técnica |
| 383409 | 19/10/2026, 10:28:27 | UNSUPPORTED_FACT:official.inventory.7.id; UNSUPPORTED_FACT:official.inventory.7.advertised_price_cents | contingência técnica |
| 383459 | 19/10/2026, 10:30:06 | UNANSWERED_REQUEST:request_1; UNANSWERED_REQUEST:request_2; UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 383570 | 19/10/2026, 10:36:14 | UNANSWERED_REQUEST:request_1; UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 383585 | 19/10/2026, 10:37:04 | UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 385268 | 19/10/2026, 12:00:46 | UNSUPPORTED_FACT:reported.purchase_interest.brand; UNSUPPORTED_FACT:reported.purchase_interest.model | contingência técnica |
| 385483 | 19/10/2026, 12:09:40 | UNFULFILLED_CATALOG_REQUEST | grounded_catalog |
| 385573 | 19/10/2026, 12:13:45 | UNSUPPORTED_FACT:official.inventory.2.id | contingência técnica |
| 385594 | 19/10/2026, 12:14:12 | UNSUPPORTED_FACT:official.inventory.2.id | extension_financing_policy |
| 385638 | 19/10/2026, 12:16:08 | INVALID_PRIMARY_REPLY; MISSING_PRIMARY_PLAN; MISSING_RESPONSE_CONTRACT | contingência técnica |
| 385862 | 19/10/2026, 12:32:22 | UNSUPPORTED_FACT:official.business.name | contingência técnica |
| 386483 | 19/10/2026, 13:10:17 | INVALID_PRIMARY_REPLY; MISSING_PRIMARY_PLAN; MISSING_RESPONSE_CONTRACT | contingência técnica |
| 386846 | 19/10/2026, 13:32:58 | UNANSWERED_REQUEST:request_2 | contingência técnica |
| 386862 | 19/10/2026, 13:33:33 | UNSUPPORTED_FACT:official.inventory.2.model; UNSUPPORTED_FACT:official.inventory.2.advertised_price_cents | contingência técnica |
| 386883 | 19/10/2026, 13:34:46 | UNSUPPORTED_FACT:official.product.km; UNSUPPORTED_FACT:official.product.advertised_price_cents | contingência técnica |
| 387520 | 19/10/2026, 14:13:25 | UNSUPPORTED_FACT:official.business.locations.0.address | contingência técnica |
| 387593 | 19/10/2026, 14:16:52 | UNSUPPORTED_FACT:official.business.locations.0.address | contingência técnica |
| 387693 | 19/10/2026, 14:22:09 | UNANSWERED_REQUEST:request_1; UNFULFILLED_CATALOG_REQUEST | grounded_catalog |
| 387773 | 19/10/2026, 14:26:16 | UNFULFILLED_CATALOG_REQUEST | grounded_catalog |
| 387806 | 19/10/2026, 14:28:07 | UNSUPPORTED_FACT:official.product.observations | extension_financing_policy |
| 387815 | 19/10/2026, 14:28:27 | UNSUPPORTED_FACT:reported.customer_vehicle.raw_mention | contingência técnica |
| 387826 | 19/10/2026, 14:28:55 | UNSUPPORTED_AMOUNT:600000 | contingência técnica |
| 387872 | 19/10/2026, 14:30:41 | UNSUPPORTED_FACT:official.product.advertised_price_cents; UNSUPPORTED_FACT:reported.deposit_cents; UNSUPPORTED_AMOUNT:1198000 | contingência técnica |
| 387942 | 19/10/2026, 14:34:27 | UNSUPPORTED_FACT:reported.customer_vehicle.category; UNSUPPORTED_FACT:reported.customer_vehicle.raw_mention | contingência técnica |

---

## Continuação P0 — 19/10 noite: catálogo, auditor, handoff e Kanban (local, não publicado)

Todas as execuções abaixo rodaram no CORE `49a9af13…` (mesmo baseline das correções
estruturais anteriores, sem o ajuste de álbum). Evidência: `channel_events.raw_payload`,
`sales_leads`, `genesis_inventory_vehicles`, `tenant_settings` e definições de RPC/trigger,
somente leitura. O contrato primário do Gemini (facts/answers) NÃO é persistido e o
runData dessas execuções não foi obtido: causas marcadas como "não comprovadas" dependem dele.

### Álbum (391179 / 390940) — correção do Codex preservada
Revisada e mantida sem alteração. Probes: 4 fotos + envelope seguem para geração com IDs
preservados; `[album]` literal sem origem de canal continua `unknown`; imagem avulsa + texto
(caso positivo 391456) não regrediu.

### 391327 — `UNSUPPORTED_FACT:official.inventory.5.observations`
Identidade conferida: no snapshot ofertável o índice 5 é `honda|cb 600rr|2007|` (a "moto 4"
da lista filtrada); a vinculação por ID do produto está correta. Incompatibilidade estrutural
reproduzida: `observations` é texto livre e o auditor só aceitava o valor INTEGRAL; citar
"revisada, pneus novos e km baixo" era rejeitado. Correção (`salesFactValueMatches`): para
`observations` aceita apenas fragmentos literais do texto autorizado do MESMO produto;
quilometragem inventada, texto de outro veículo e números ausentes continuam bloqueados.
Status: corrigido localmente, sem replay; valor exato citado pelo Gemini não comprovado.

### 391479 — `UNANSWERED_REQUEST:request_1;UNSUPPORTED_FACT:official.inventory.3.advertised_price_cents`
Índice 3 = `yamaha|crosser|2023|` (a Crosser 2021 está `sold` e fora do snapshot). Preço está
autorizado no ledger final. Incompatibilidade reproduzida: fatos `*_cents` só aceitavam a
string em centavos; "R$ 17.980,00"/"17980" para o mesmo valor eram rejeitados. Correção:
comparação monetária por valor (centavos ou BRL), exigindo igualdade exata; valores
divergentes e `UNSUPPORTED_AMOUNT` continuam bloqueados; `availability_asserted` sem
verificação continua `UNVERIFIED_PRODUCT_AVAILABILITY`. `request_1`: NÃO comprovado
(sem answers originais); validação mantida.

### 391362 — `UNANSWERED_REQUEST:request_2` (Montana 2013)
NÃO comprovado. A segunda tentativa foi aceita com plano diferente. Sem plan/answers
persistidos não é possível separar plano com pedido obsoleto de excerpt não literal.
Nenhuma alteração; validação mantida. Observação para o runData: `validatePlan` renumera
os IDs por posição sem remapear `answers`.

### 391456 — "Vou encaminhar…" sem handoff (adendo §12/§14)
Comprovado e corrigido localmente:
1. `vehicle.trade_in` (EXT) extrai o veículo só do turno atual e `commercial.decide` emitia
   esse objeto como `commercial_state.sell_vehicle`; o CORE aplica `Object.assign(s, …)`.
   O turno "[image] / Manutenção em dia" apagou modelo/ano e gravou
   `raw_mention="[image]\nManutenção em dia"`. A EXT baseline reproduz exatamente o estado
   persistido. Correção: a EXT mescla com o veículo persistido (modelo diferente = veículo novo).
2. A EXT não tinha caminho de avaliação para venda independente: só rejeição de
   marca/ano gerava handoff. O CORE calculava "appraisal ready", mas a decisão autoritativa
   da EXT o sobrescrevia (qualifying, sem handoff). Correção: o CORE envia apenas evidência
   (`appraisal_evidence`: contagem de fotos e IDs de descrição) e a EXT aplica
   `business_facts.vehicle_appraisal.remote` (fotos/descrição exigidas, walk-in respeitado).
   Pronto → `appraisal_review` → `sales_appraisal`, com atribuição pelo fluxo existente.
3. O Gemini era instruído a "descrever encaminhamento futuro". Novo campo de contrato
   `handoff_announced`; promessa de encaminhamento sem dispatch efetivo vira
   `UNEXECUTED_HANDOFF_ANNOUNCEMENT`.

### Classificação, financiamento e Kanban (adendo §13/§15)
- Comprovado: `commercialDecisionNeedsInventory` só carregava estoque quando a mensagem
  citava produto. Em turnos de entrada/documentos o produto em foco ficava `null`:
  temperatura `unknown` e coleta de financiamento bloqueada em `purchase_product`.
  Correção: produto já em foco é reautorizado pela EXT a cada turno.
- Comprovado: lead quente resolvia `sales_hot` (allow_ai=false) sem handoff → IA travada
  sem dono. Correção: EXT emite `hot_lead` explicitamente.
- Comprovado (banco, NÃO aplicado): o trigger `magia_sales_human_control` move qualquer
  lead para `sales_human` ao registrar `conversation_assigned`, sobrescrevendo
  `sales_financing`/`sales_appraisal`/`sales_hot`. Proposta em
  `supabase/migrations_pending_review/20261019210000_sales_assignment_preserves_human_stage.sql`.
- Divergência de configuração (NÃO alterada): `magia_sales_save` só calcula a coluna `hot`
  para `deposit_and_financing_documents_v2`; o tenant usa `…_v1`, então `sales_leads.hot`
  é sempre false. A temperatura autoritativa está em `state.financing.temperature` (EXT).
- Dados atuais: 11 leads têm temperatura warm/cold registrada; 10 estão em `sales_human` e 1 em `sales_closed`
  (pedido do cliente, handoff de financiamento + trigger). Ausência nessas colunas do Kanban não é ausência de decisão.

### Retry (Gomes Silva)
Inalterado. Dependência operacional separada (política por tenant com aprovação).

### Verificação
Probes em `scratch/p0-2026-10-19b/` (ignorado pelo Git): 18 checagens do auditor/mídia e
casos EXT com settings reais locais, sem rede, Gemini ou Evolution. Suítes existentes:
conjunto de falhas idêntico ao baseline (falhas preexistentes). Anti-hardcode aprovado.
Paridade fonte/runtime/três nós CORE/nó EXT conferida. Núbia e Royal intocados.

## Rodada 3 (19/10, noite) — Kanban/RPC, moeda, veículo e prova de handoff (local, não publicado)

- **Kanban/RPC** (validado em PostgreSQL 16 isolado com as definições de produção):
  `magia_sales_human_control` preserva etapa humana já decidida (allow_ai=false, não
  encerrada) em atribuição/resposta manual/pedido de handoff e trava o lead antes de
  ler a etapa. `magia_sales_save`: `hot` passa a espelhar a classificação da EXT para
  regras ≠ v2, só se rule = configurada, threshold válido, entrada*100 ≥ preço*percentual
  e documentos completos quando exigidos; divergência gera exceção. Ramo v2, p_stage,
  p_register e validações intactos. Rollback com definições byte a byte de produção
  (md5 conferido após rollback no banco isolado).
- **Moeda**: `R$` só como reais; inteiro sem unidade = centavos (contrato *_cents);
  formato brasileiro = reais; demais formatos rejeitados. `R$ 1798000` e `17980` recusados.
- **Veículo**: reconciliação por id/marca/modelo/ano; conflito = outro veículo sem herança
  (inclusive campos planos sell_*); vínculo sem identidade comum = não anexado. Baseline
  mesclava "Onix 2020" na Montana e encaminhava a avaliação errada.
- **Handoff**: prova = resultado do backend (ai_locked, etapa humana, atribuição confirmada/
  preservada ou fila persistida), registrada em `handoff_execution`; o booleano do Gemini
  nunca é prova. Texto do modelo mantido após dispatch (ack simples) passa a ser auditado.

## Aplicação da migração comercial — 19/10/2026 ~19:20 BRT (autorizada pelo usuário)

- Antes: md5 de `pg_get_functiondef` em produção = linha de base revisada
  (`magia_sales_human_control` 72c10076…, `magia_sales_save` d7beeb57…), 1 sobrecarga,
  trigger `sales_human_control` intacto, 0 chamadas ativas, 0 leads quentes destravados.
- Aplicada como `20261019210000_sales_assignment_preserves_human_stage` (registro
  20261019221956), com guarda que abortaria se a linha de base tivesse mudado.
- Depois: md5 = 00b15ebd… / ad81cc51… (iguais aos obtidos no PostgreSQL isolado),
  SECURITY DEFINER, search_path e permissões (postgres/service_role) preservados;
  trigger habilitado e inalterado.
- Rollback pronto: `supabase/migrations_pending_review/20261019210000_sales_assignment_preserves_human_stage.rollback.sql`
  (restaura byte a byte; md5 esperado após rollback 72c10076… / d7beeb57…).
- CORE/EXT locais NÃO publicados; o CORE em produção continua o 49a9af13….
