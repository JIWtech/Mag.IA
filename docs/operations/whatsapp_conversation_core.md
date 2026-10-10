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

scripts/build/n8n/build_whatsapp_core.cjs extrai funcoes do Telegram V4.8.0 versionado
com AST TypeScript, aplica adaptadores de contexto/transporte e incorpora
n8n/code/whatsapp_core_runtime.js. Nao editar o generated diretamente.
Personalidade vem das settings, nunca de condicional por nome de cliente.

Executar node scripts/build/n8n/build_whatsapp_core_workflow.cjs para gerar motor e JSON.
Executar node scripts/build/n8n/build_command_router_workflow.js para gerar o roteador.
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
node --test app/tests/features/tenantAccess.test.js app/tests/features/conversationLifecycle.test.js scripts/tests/test_whatsapp_media.cjs scripts/tests/test_whatsapp_core.cjs scripts/tests/test_confirm_payment_core.cjs scripts/tests/test_whatsapp_turn_queue.cjs
```

Teste SQL requer @electric-sql/pglite em TEMP/magia-diag-tools/node_modules.
Demais testes usam Node test runner. Nao usam chaves ou canais reais.
Audio/imagens/citacoes no novo motor exigem homologacao separada. Nao ativar
esse perfil em lojas que dependam da rota existente de envio de fotos.
Nao ha novo motor de capacidade/disponibilidade de agendamento.
Limite diario legado nao e atomico entre conversas. Retentativas/geracoes
descartadas tambem gastam tokens. Recuperacao a cada 10s gera execucoes n8n
mesmo com fila vazia; monitorar armazenamento/retencao.
