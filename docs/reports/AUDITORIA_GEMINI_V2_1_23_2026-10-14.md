# NORIA — auditoria cruzada Gemini 4 × repositório real

Data da revisão: 2026-10-14  
Commit de partida: `5f97bf1dc38ff9ef0b4919733bf0357f9c92786d`  
Worktree: preservado; havia alterações locais e arquivos não rastreados antes desta auditoria.  
Revisão produzida: `conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14`

## Escopo e limites

- O repositório citado no pedido (`C:\pastas\MagIA-Projeto-Oficial`) não existe neste ambiente. A auditoria foi feita no repositório ativo `C:\pastas\Noria_Plataform`.
- Nenhum workflow foi publicado ou ativado.
- Nenhuma migration foi aplicada ao Supabase de produção.
- Nenhuma mensagem WhatsApp foi enviada.
- Nenhuma chamada real à API Gemini foi executada.
- A causa externa exata do 429 (RPM, TPM, RPD, billing ou capacidade) continua indeterminada; o diagnóstico anterior perdeu os detalhes do provedor.

## Matriz BUG-01 a BUG-10

| ID | Evidência anterior no repositório | Veredito | Situação atual / correção |
|---|---|---|---|
| BUG-01 | `httpProviderBody()` aceitava o primeiro objeto, inclusive `{}`, Buffer ou array; `httpRetryAfterMs()` só lia header. | Confirmada e pendente no baseline, P0. | Corrigida: ignora envelopes vazios, converte Buffer, percorre arrays, lê `description`/`message`, `RetryInfo`, `QuotaFailure`, status e request ID sem persistir corpo privado. |
| BUG-02 | O breaker era consultado antes do `for`, mas não obrigatoriamente antes de cada tentativa. | Confirmada e pendente, P0. | Corrigida: cada tentativa consulta o breaker antes de adquirir lease. Um 429 abre circuito e a tentativa seguinte falha sem novo HTTP ao Google. |
| BUG-03 | `$getWorkflowStaticData('global')` limitava apenas o processo local, sem TTL, RPM ou TPM. | Confirmada, P0. A solução Redis do relatório era incompatível. | Corrigida localmente por migration Postgres/Supabase atômica: leases, fencing, janela móvel, RPM/TPM/RPD e circuito geracional. Só fica efetivamente distribuída após migration + ENV em implantação. |
| BUG-04 | `salesModeFor()` devolvia `unknown` antes de inferir produto/veículo persistido. | Confirmada e pendente, P0. | Corrigida: `unknown` não é retorno terminal; compra, venda e troca são inferidas do estado validado. |
| BUG-05 | `callGroundedGemini()` convertia qualquer falha, inclusive 429, em `[HUMANO_SOLICITADO]`. | Confirmada e pendente, P1. | Corrigida: falha transitória gera resposta técnica, preserva estado e telemetria, sem handoff falso. Falhas de validação não transitórias mantêm o caminho seguro existente. |
| BUG-06 | `transcribeTurnAudio()` chamava `helpers.httpRequest()` diretamente. | Confirmada e pendente, P1. | Corrigida: áudio passa por `httpJson`, lease, rate limit, breaker, retry e diagnóstico centrais. |
| BUG-07 | A remoção local de `!history.length` permitia saudação genérica mesmo com produto, referral, requisito pendente ou mídia. | Parcialmente correta e pendente, P1. | Corrigida: a resposta determinística só ocorre sem contexto comercial, referral, mídia, requisito ou oferta humana pendente. |
| BUG-08 | A versão publicada relatada mantinha `awaiting_customer` em falha técnica. | Confirmada, mas já corrigida nas alterações locais v2.1.22. | Preservada: `technical_failure`, `ai_processing_ok=false` e bloqueio de follow-up técnico. |
| BUG-09 | `markUsage()` ficava nos chamadores; retries HTTP e retry por truncamento podiam não ser contados. | Confirmada e pendente, P2. | Corrigida: contagem ocorre uma vez por tentativa física dentro de `httpJson`; marcadores legados ficaram inertes. |
| BUG-10 | `parseAppointmentStartAt()` concatenava `-03:00`. | Confirmada e pendente, P2. | Corrigida: conversão usa a timezone IANA do tenant e valida o round-trip, inclusive offsets diferentes e horários DST inválidos. |

## Auditoria da proposta Redis

Infraestrutura encontrada:

- Redis 7 Alpine, instância única, com senha e persistência AOF.
- n8n local em processo principal; não há queue mode configurado nos compose atuais.
- O Redis é consumido por nós nativos e pela Evolution API.
- `NODE_FUNCTION_ALLOW_EXTERNAL` não permite `ioredis`/`redis` no Code Node.
- Não existe `REDIS_REST_URL`; Redis convencional não expõe `/eval` HTTP.
- `EVAL` é compatível com Redis 7, mas não está acessível de dentro do Code Node pela configuração atual.

Problemas comprovados no patch proposto pelo Gemini:

1. O half-open consultava uma chave de probe, mas não demonstrava aquisição exclusiva completa.
2. `success -> DEL cb_key` permitia que uma chamada antiga apagasse um circuito aberto por outra chamada mais nova.
3. RPM/TPM padrão `0` desativava silenciosamente os controles.
4. Bucket por minuto não era janela móvel e permitia rajada na fronteira.
5. Lease de 20 s não estava formalmente vinculado ao timeout máximo.
6. O texto dizia SHA-256, mas o patch usava hash próprio da API key.
7. A rota `/eval` REST presumida não existe na infraestrutura encontrada.

Decisão: não aplicar o Redis/Lua proposto. O controle distribuído foi implementado no Postgres/Supabase já acessível ao CORE, usando RPC transacional e `pg_advisory_xact_lock`. O escopo é um identificador opaco configurado em `GEMINI_RATE_SCOPE`; nenhuma API key é usada em nomes, hashes, logs ou telemetria.

### Estratégia implementada

- Chave lógica: `GEMINI_RATE_SCOPE + modelo`; tenants que usam o mesmo projeto/modelo compartilham a mesma quota.
- Concorrência: leases com expiração entre 20 s e 120 s; padrão recomendado 30 s para HTTP limitado a 15 s.
- RPM/TPM: eventos consultados em janela móvel real de 60 segundos.
- RPD: janela conservadora móvel de 24 horas; não presume o horário de reset externo do Google.
- Half-open: somente um `probe_lease_id` por geração.
- Fencing: sucesso só fecha o circuito se o lease for o probe atual e sua geração for a geração vigente.
- Falha do controlador: `GEMINI_RATE_CONTROL_REQUIRED=true` falha fechado antes do Google; em `false`, cai para fallback local e identifica o modo na telemetria.
- Configuração incompleta: não anuncia controle global; opera como `local_only_unconfigured` ou falha fechado quando obrigatório.

## Novos achados

| ID | Severidade | Evidência / impacto | Correção |
|---|---|---|---|
| NEW-01 | P0 | Sucesso antigo podia apagar circuito novo no Lua proposto. | Fencing por `circuit_generation`; teste transacional específico. |
| NEW-02 | P0 | Mais de um worker podia virar probe após cooldown. | Probe exclusivo sob advisory lock; teste com aquisições concorrentes. |
| NEW-03 | P1 | Bucket fixo permitia rajada entre minutos. | Eventos em janela móvel de 60 s. |
| NEW-04 | P1 | Redis REST e cliente externo não existem no ambiente do Code Node. | Proposta rejeitada; RPC Supabase compatível com o transporte atual. |
| NEW-05 | P1 | Script diagnóstico mostrava prefixo/sufixo da API key e imprimia corpo bruto. | Script agora nunca exibe a chave e reduz a saída a status, headers permitidos, quota/retry e usage seguros. |
| NEW-06 | P1 | Fallback local não tinha half-open exclusivo. | Probe local com TTL, modo degradado explícito e teste de circuit breaker. |
| NEW-07 | P2 | Headers vazios em um envelope podiam ocultar headers válidos em outro. | Seleção do primeiro conjunto de headers não vazio. |
| NEW-08 | P2 | EXT e CORE ainda podem repetir leituras de tenant/settings/channels. | Confirmado como custo potencial; não alterado nesta revisão por não ser necessário ao 429 e exigir revisão de contrato do subworkflow. |

## Arquivos da revisão

- `scripts/build/n8n/whatsapp_failure_resilience.cjs`: fonte das correções e do controlador do CORE.
- `scripts/build/n8n/build_whatsapp_core.cjs`: revisão v2.1.23 e rebuild preservando o grafo importado.
- `scripts/build/n8n/build_whatsapp_core_workflow.cjs`: validação da revisão e do grafo.
- `supabase/migrations/029_gemini_global_rate_control.sql`: tabelas e RPCs atômicas.
- `scripts/ops/diagnose_gemini_api.cjs`: diagnóstico de uma chamada, seguro e opt-in.
- `scripts/tests/test_gemini_failure_resilience.cjs`: diagnóstico, retry, áudio, estado, timezone e falha do controlador.
- `scripts/tests/test_gemini_global_rate_control.cjs`: testes Postgres concorrentes do controlador.
- `scripts/tests/test_whatsapp_core.cjs` e `scripts/tests/test_whatsapp_sales.cjs`: expectativas atualizadas para contagem central e revisão.
- `.env.example`, `docker-compose.yml`, `infra/local/docker-compose.local.yml`: parâmetros explícitos.
- `n8n/code/whatsapp_conversation_core.generated.js`: runtime gerado.
- `n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json`: workflow importável, sem publicação.

## Testes e validações

Baseline antes da implementação:

- Backend completo: 389 testes; 388 aprovados; 1 falha preexistente porque `n8n/workflows/magia_command_router.json` está deletado no worktree.

Após a implementação:

- Testes focados Gemini + controlador: 47/47.
- Backend, excluindo somente o teste cujo fixture já estava deletado: 402/402.
- Execução backend incluindo tudo: 403 testes, 402 aprovados e 1 falha; a única falha é `test_command_router_catalog.cjs` por `ENOENT` do fixture deletado.
- Frontend: 521/521.
- Build Vite: concluído; há warnings preexistentes de chunk grande/import misto.
- Build do CORE: idempotente por SHA-256 antes/depois.
- `git diff --check`: aprovado.
- Migration 029: compilada e exercitada em Postgres isolado via PGlite.
- Playwright: o teste legado informa indisponibilidade local; não foi contado como teste Node ignorado.

Limites: não houve teste contra o Supabase de produção, Redis de produção, n8n ativo, Google ou WhatsApp. A atomicidade foi testada com múltiplas instâncias concorrentes do RPC em Postgres local, não com Redis, pois Redis não foi escolhido para o controlador.

## Workflow final

- Revisão: `conversation_core_v2_1_23_gemini_global_rate_control_2026_10_14`
- Nós: 61
- Arestas de conexão: 64
- Paridade Code node × `whatsapp_conversation_core.generated.js`: confirmada
- SHA-256 do JSON: `260affa071f06d69f0d3223a2aa521ffd9d3e6eee04ab54d7afb7b05369bd6e1`

## Parâmetros necessários

Obrigatórios para controle distribuído:

- `GEMINI_RATE_SCOPE`: ID opaco e estável do projeto/quota; nunca a API key.
- `GEMINI_MAX_RPM`: limite confirmado do projeto/modelo.
- `GEMINI_MAX_TPM`: limite confirmado do projeto/modelo.
- `GEMINI_MAX_RPD`: limite confirmado do projeto/modelo.
- `GEMINI_MAX_CONCURRENT_CALLS`: padrão operacional sugerido pelo repositório: `2`.
- `GEMINI_LEASE_TTL_MS`: padrão: `30000`, maior que o timeout HTTP individual.
- `GEMINI_RATE_CONTROL_REQUIRED`: usar `true` somente após migration e health check.

Não foram inventados valores RPM/TPM/RPD. Eles devem ser obtidos no projeto Google realmente associado à chave do n8n.

## Diagnóstico externo seguro

Dry-run, sem chamada:

```powershell
node scripts/ops/diagnose_gemini_api.cjs --model=gemini-3.5-flash-lite
```

Uma única chamada, somente após autorização explícita:

```powershell
node scripts/ops/diagnose_gemini_api.cjs --live --model=gemini-3.5-flash-lite
```

O script lê a chave do ambiente/.env, nunca a imprime e não envia dados de clientes.

## Implantação segura

1. Exportar e guardar o workflow ativo v2.1.22 e registrar seu SHA-256.
2. Aplicar a migration 029 primeiro em staging e validar os dois RPCs com service role.
3. Configurar um `GEMINI_RATE_SCOPE` opaco e as cotas confirmadas no projeto Google.
4. Iniciar com `GEMINI_RATE_CONTROL_REQUIRED=false`, importar a v2.1.23 como workflow inativo e executar smoke tests controlados.
5. Confirmar telemetria `supabase_atomic`, leases liberados, RPM/TPM/RPD e isolamento dos três tenants.
6. Ativar `GEMINI_RATE_CONTROL_REQUIRED=true`, reiniciar o n8n de forma controlada e só então promover o workflow.
7. Monitorar `generation_failure`, `rate_control_mode`, circuitos, latência do RPC e ausência de follow-ups técnicos.

## Rollback

1. Desativar a v2.1.23 e reativar o export v2.1.22 previamente salvo.
2. Se o controlador estiver impedindo tráfego durante investigação, definir `GEMINI_RATE_CONTROL_REQUIRED=false` antes do restart; isso degrada explicitamente para controle local.
3. Não remover imediatamente migration/tabelas: deixá-las sem consumidores é seguro e preserva evidência operacional.
4. Só remover objetos da migration em mudança separada, revisada e após confirmar que nenhuma execução v2.1.23 permanece ativa.

## Revisão complementar da migration 029

O parecer complementar do Gemini foi confrontado com a função real, sem copiar a função alternativa sugerida. Os dois defeitos apontados foram confirmados:

- um probe encerrado por timeout/rede deixava `probe_lease_id` ocupado;
- um sucesso normal não zerava `consecutive_upstream_failures`.

A alternativa proposta pelo Gemini não foi aplicada porque ainda permitia resultados `rate_limit` e `upstream_server` antigos alterarem uma geração mais nova e apenas limpava o probe falho, possibilitando nova sondagem imediata. A migration 029 foi corrigida antes de qualquer implantação, sem criar uma migration 030.

Correções adicionais na 029 e no consumidor:

- todo resultado de falha compara a geração do lease com a geração corrente antes de alterar o circuito;
- falha explícita de probe reabre o circuito em uma nova geração, limpa o probe e aplica cooldown;
- probe abandonado é recuperado com cooldown calculado a partir do vencimento, sob o mesmo advisory lock;
- aquisição repetida do mesmo `lease_id` retorna `duplicate_lease_id`, sem violação inesperada de chave;
- RPM, TPM e RPD tornam-se configuração canônica do par `scope + model`; chamadas divergentes retornam `configuration_mismatch`;
- o consumidor envia `p_probe_cooldown_ms` e distingue `network_or_timeout` de uma liberação genérica;
- o fallback local recebeu a mesma recuperação de timeout para não criar comportamento divergente.

Validação complementar:

- Gemini + controlador: 55/55 testes aprovados.
- Controlador Postgres isolado: 13/13, incluindo interleavings concorrentes para timeout de probe, reset após sucesso, fencing de rate limit/upstream, recuperação half-open, lease duplicado e configuração divergente.
- Backend completo: 411 testes, 410 aprovados e a única falha preexistente em `test_command_router_catalog.cjs`, por `ENOENT` do arquivo já removido `n8n/workflows/magia_command_router.json`.
- Build do CORE novamente idempotente; SHA-256 antes/depois: `260affa071f06d69f0d3223a2aa521ffd9d3e6eee04ab54d7afb7b05369bd6e1`.

Não houve acesso a produção nem chamada real ao Google. Portanto, a causa externa do HTTP 429 permanece não verificada e não é declarada resolvida.
