# Processamento conversacional WhatsApp (opt-in)

## Fonte unica canonical_v2

Perfil opt-in adicional em tenant_settings.settings.grounding_mode. Somente
clinica_nubia_oficial esta habilitada. Motor em whatsapp_grounded_reply.js.
O system_instruction recebe EXATAMENTE settings.system_prompt (trim), sem
concatenar prompt legado, personalidade secundaria, prompt versionado ou RAG.
ai_agents nao e consultado nesse perfil. Credencial GEMINI_API_KEY; modelo
settings.ai_model, agora gemini-2.5-flash na Nubia. Nao ha fallback de modelo.

Fatos comerciais chegam como dados estruturados do mesmo Supabase:
business_facts, payment, catalogo ativo e agendamentos do tenant/conversa.
Endereco e Pix sao renderizados pelo codigo a partir dos dados verificados.
Mensagem do cliente nao altera cadastros. Respostas antigas do bot nao sao
fonte de verdade. Fatos ausentes exigem humano, nao complemento pelo modelo.

Toda a sessao e carregada, ate 250 eventos/65000 caracteres; excesso encaminha
para humano. Nao ha mais corte silencioso para 12 registros nesse perfil.
Campos de agendamento estruturados precisam de evidencia em IDs de mensagens
da cliente, servico existente e validacao de data/hora/nome antes da persistencia.
Essas evidencias ficam em raw_payload.conversation_state e a origem do prompt,
versao, tamanho do historico e bloqueios ficam em raw_payload.grounding.

Nao e promessa de zero alucinacao: validacao sintatica/IDs nao prova toda
semantica da prosa. Monitorar bloqueios e revisao humana; ampliar testes com
casos reais. O modelo Flash custa mais que Lite. Endereco/Pix nao chamam Gemini.
Clientes atingidos por respostas incorretas anteriores precisam de revisao
humana; nao foram enviados avisos retroativos automaticos.

## Fontes e build

scripts/build_whatsapp_core.cjs extrai funcoes do Telegram V4.8.0 versionado
com AST TypeScript, aplica adaptadores de contexto/transporte e incorpora
n8n/code/whatsapp_core_runtime.js. Nao editar o generated diretamente.
Personalidade vem das settings, nunca de condicional por nome de cliente.

Executar node scripts/build_whatsapp_core_workflow.cjs para gerar motor e JSON.
Executar node scripts/build_command_router_workflow.js para gerar o roteador.
O trecho whatsapp_confirm_signal.js deve permanecer identico ao incorporado
em command_router.js. O teste de confirmacao executa o roteador completo.

Implantar migration 017, depois roteador e WhatsApp com opt-in desligado;
verificar canal/credenciais/modelo e ativar somente o tenant homologado.
Fazer backup e comparar versoes antes de publicar, preservando alteracoes
concorrentes de outros desenvolvedores e credenciais dos nos existentes.

## Fila e consistencia

conversation_turn_queue e RPCs magia_enqueue_turn, magia_claim_turn,
magia_commit_turn e magia_finish_turn sao exclusivas da service role.
Chave tenant/canal/chat. Webhook responde depois da persistencia.
Token e lease impedem trabalhadores concorrentes de enviarem o mesmo lote.
Commit verifica chegada de mensagem nova, encerramento e intervencao humana.
Recuperacao periodica filtra filas vazias antes de aplicar limite de linhas.

Historico usa ultimo conversation_closed/conversation_reset como fronteira.
Preserva todos os inbounds originais, sem inserir copia agregada. Um outbound
por resposta, response_text null, para evitar duplicacao na interface.

Reserva pending_payment; SINAL PAGO e declaracao do cliente, nao comprovacao:
payment_reported, Verificar Sinal, aviso curto e handoff. Confirmar valida
usuario/tenant/conversa/status e disputa a linha por updated_at antes do envio.
Confirmed so depois do envio aceito. Repeticao em confirmed nao reenvia.

## Entrega incerta

Nao limpar fila nem clicar repetidamente. Verificar execucao, channel_events,
aparelho/provedor. Timeout pode ocorrer depois que a mensagem ja foi enviada.
Fila phase=uncertain ou metadata.signal_confirmation_state sending/uncertain
exige reconciliacao tecnica. Entrega comprovada: concluir registro sem reenviar.
Ausencia de entrega comprovada: preparar tentativa controlada. Preservar
evidencias e estados antes de qualquer alteracao. Nao criar reset automatico.

## Testes e limites

```powershell
node --test app/src/tenantAccess.test.js app/src/conversationLifecycle.test.js scripts/test_whatsapp_media.cjs scripts/test_whatsapp_core.cjs scripts/test_confirm_payment_core.cjs scripts/test_whatsapp_turn_queue.cjs
```

Teste SQL requer @electric-sql/pglite em TEMP/magia-diag-tools/node_modules.
Demais testes usam Node test runner. Nao usam chaves ou canais reais.
Audio/imagens/citacoes no novo motor exigem homologacao separada. Nao ativar
esse perfil em lojas que dependam da rota existente de envio de fotos.
Nao ha novo motor de capacidade/disponibilidade de agendamento.
Limite diario legado nao e atomico entre conversas. Retentativas/geracoes
descartadas tambem gastam tokens. Recuperacao a cada 10s gera execucoes n8n
mesmo com fila vazia; monitorar armazenamento/retencao.

## Hotfix local: ciclo de vida e retencao tecnica (18/10/2026)

**REGISTRO HISTORICO SUPERSEDIDO:** a leitura das RPCs publicadas confirmou
que o claim podia limpar uncertain ao receber outro inbound. As garantias de
retencao abaixo descreviam somente o SQL antigo do repositorio e NAO valem
para producao. A proposta alinhada, ainda nao aplicada, esta em
`docs/operations/turn_queue_lifecycle_review.md`. As RPCs de delivery existem
em producao; sua ausencia local era uma lacuna de sincronizacao.

Fonte atual: `n8n/sources/noria_core.js`; regeneracao:
`node scripts/build_noria_workflows.cjs`. Esta secao descreve o contrato SQL
versionado em `017_whatsapp_turn_queue.sql`, nao uma verificacao de producao.

Fluxo: claim -> processing -> commit -> sending -> tentativa de entrega ->
confirmacao persistida -> finish(done). `providerAccepted` comprova apenas um ID
retornado pela Evolution; `deliveryConfirmed` exige `confirmed: true` da RPC e
um evento outbound persistido. Nao equivale a recibo de entrega/leitura no aparelho.

Antes do hotfix, o catch global escolhia retry por `sendAttempted === false`,
inclusive depois do commit. Caminhos afetados: persistencia comercial e de
eventos, atribuicao humana, credenciais/consultas de controle anteriores ao envio,
criacao de delivery attempt e timeout do proprio commit (resultado desconhecido).
Todos podiam estar em sending; finish(retry) rejeita essa fase. Transcricao em
prepare tambem solicitava retry incondicional e podia repetir indefinidamente.

Comportamento local corrigido:

- Retry somente no caso de commit recusado por novas mensagens, conferindo
  tenant/canal/chat, token e fase processing; a RPC conserva sua guarda atomica.
- Falha tecnica em processing: finish(uncertain) conserva claimed/token e bloqueia
  retomada automatica. Nao afirma envio: delivery_uncertain=false e
  hold_reason=technical_failure_requires_review. Nao ha orcamento duravel para
  autorizar retries automaticos de falhas recuperaveis com seguranca.
- Sending sem tentativa, inclusive commit sem resposta: retencao para revisao;
  nunca retry direto. Leitura da fase real e flags locais ficam no diagnostico.
- Tentativa sem confirmacao persistida: uncertain; reconciliar attempt, ID do
  provedor e eventos antes de qualquer novo envio. ID aceito nao autoriza retry.
- Confirmacao persistida: falhas posteriores tentam apenas finish(done), sem
  novo envio. Falha do proprio finish continua explicitamente rastreada.
- Cancelamentos por controle humano/fronteira e supressoes intencionais continuam
  terminais; done sem envio nesses caminhos nao representa entrega confirmada.
- Resultados tecnicos sao terminais no workflow e registram token, sessao,
  mensagens agrupadas, fase observada, attempt/ID do provedor, motivo e resultado
  da finalizacao. O campo requires_technical_intervention sinaliza intervencao;
  nao cria atribuicao comercial ou ticket automaticamente.

Limites e dependencias (nenhuma RPC/migracao foi aplicada):

1. A fila versionada nao possui attempt_count, max_attempts, next_attempt_at ou
   estado proprio de revisao tecnica. O recuperador seleciona lotes com lease
   expirado e exclui uncertain; o claim tambem bloqueia uncertain. A retencao
   conservadora interrompe repeticao apos falhas capturadas, mas exige operador.
2. Para retry automatico duravel, adicionar contabilizacao atomica por lote
   estavel de mensagens (nao somente por token, que muda no claim), politica
   configurada de tentativas/backoff, ultimo erro e revisao tecnica persistida.
   Claim/finish e recuperador devem respeitar essa politica, sem limpar claimed.
3. Sending sem envio exige uma RPC de reconciliacao com lock e fencing por
   tenant/canal/chat/token/attempt: comprovar ausencia de tentativa/aceitacao,
   preservar claimed e somente entao transicionar para processamento/retry.
   Nao basta liberar retry para todo sending. Uma entrega confirmada deve poder
   concluir atomicamente a fila sem reenviar; entrega ambigua permanece retida.
4. As definicoes de magia_begin_turn_delivery/magia_confirm_turn_delivery nao
   foram encontradas nas migracoes locais. Obter as definicoes implantadas e
   validar atomicidade, fencing, idempotencia e semantica de confirmed antes de
   afirmar paridade ou recuperacao automatica segura.
5. Se o banco impedir tanto finish quanto a gravacao do erro, o resultado n8n
   informa finish_persisted=false/audit_error. Crash, falha fora do CORE ou erro
   antes de adquirir/receber o token ainda podem ser retomados sem limite pelo
   lease. Eliminar esse risco exige o controle persistente acima e acesso as
   execucoes/rotas de erro do n8n. Nao considerar o P0 integralmente resolvido.

Recuperacao de Silvio, Leandro e MY LORD (somente procedimento, nao executado):

1. Resolver identidade por tenant, instancia e JID; nome nao identifica conversa.
   Preservar snapshot da fila, leads, eventos e execucoes antes de intervencao.
2. Enumerar IDs inbound afetados e correlacionar grouped_message_ids, sessao,
   token, delivery_attempt_id, outbound e ID do provedor. Comparar pending e
   claimed; uma fila vazia nao prova que houve resposta.
3. Conferir execucao n8n e prova do provedor/aparelho, inclusive para envios cujo
   evento nao foi persistido. Havendo prova de envio, reparar apenas a trilha/
   finalizacao sob procedimento autorizado; nunca reenviar automaticamente.
4. Ausencia de evento outbound nao prova ausencia de envio. Caso ambiguo fica
   em reconciliacao. Somente com ausencia de envio comprovada, revisar validade
   atual da demanda e controle humano, preparar recuperacao idempotente dos IDs
   originais e pedir autorizacao explicita antes de reenfileirar ou responder.
   Nao reinserir cegamente via enqueue: a deduplicacao do inbound pode rejeitar
   o evento antigo e nao restaurar a fila consumida.

Rollback: usar o diff incremental deste hotfix sobre o snapshot local anterior,
preservando as demais alteracoes locais, e regenerar nos caminhos originais.
Nao usar reset/checkout de snapshots antigos. Nao liberar filas uncertain como
parte do rollback; reconciliar entrega primeiro. Nada foi publicado em producao.

Validacao deste hotfix: sintaxe do gerador e dos tres nos CORE; igualdade entre
fonte/gerado/JSON; 12 verificacoes offline das transicoes afetadas; EXT, conexoes
e dois gates terminais identicos ao snapshot local anterior. Nenhum teste novo
foi salvo e nenhuma bateria foi executada. O diff --check global apontou somente
uma linha em branco preexistente em app/src/services/media/storageErrors.js:18,
fora do hotfix. Nao houve consulta de contatos, execucoes n8n ou dados de producao.
