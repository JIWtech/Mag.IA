# Clinica da Nubia oficial - 2026-09-25

## Correcao de unidade unica — 2026-09-29

- A Clínica atende somente em Angra dos Reis. O cadastro versionado não contém
  mais a antiga unidade do Rio nem a referência ao Salão Esthefany Campos.
- A migration `022_nubia_single_angra_scheduling.sql` atualiza o tenant oficial,
  mantém apenas a unidade `angra`, troca o trecho conflitante do `system_prompt`
  e desativa os registros ativos de `ai_prompt_versions` desse tenant.
- O Core canonical assume automaticamente a única unidade configurada. Em um
  tenant com apenas uma unidade, `unit_id` é um fato do sistema e não exige
  `unit_evidence` da mensagem da cliente.
- Publicar no nó `Processar Conversa WhatsApp` o conteúdo de
  `n8n/code/whatsapp_conversation_core.generated.js` antes de executar a
  migration 022. Depois, validar uma conversa com serviço, data, horário e nome,
  sem perguntar região.

## Atualizacao Movvy: estado atual

- Documento lido: `Movvy_Agendamento_Servicos.docx`, incluindo as tabelas.
- Core compativel publicado: `a58c3187-4230-4a5e-86fb-5184507861dc` no workflow WhatsApp existente.
  Somente o node `Processar Conversa WhatsApp` foi alterado. Demais nodes e settings
  dos outros tenants comparados antes/depois e preservados.
- Pix ja corrigido no Supabase oficial: `21966353026`, `Silvana Marques`.
  Instituicao antiga omitida porque nao foi confirmada para esta favorecida.
- Mensagem final do sinal ja atualizada. Continua restrita ao clique Confirmar.
  SINAL PAGO continua enviando somente o aviso curto e pausando a IA.
- **Ainda NAO ativados no Supabase:** unidades, capacidade, prompt Movvy e novo catalogo.
  Requerem `supabase/migrations/018_appointment_capacity.sql` e depois
  `05_unidades_agenda_pagamento.sql`. Nao executar novamente os SQLs antigos 01 a 04.
- Frontend com unidade/servico/data/horarios disponiveis implementado e validado localmente;
  falta deploy do frontend antes de ativar o SQL 05 para manter a criacao manual operacional.
- Modelo preservado: Gemini 2.5 Flash no n8n. Debounce/fila/encerramento preservados.
- 77 testes passaram, build Vite passou, formulario verificado em 1366x900 e 390x844.
- Gemini real no runner: execucoes 4267 (reserva simulada), 4270 (regiao),
  4272 (preparo jato), 4273 (Banho de Lua unico de 40 minutos).
  Todos os envios e gravacoes desses testes foram interceptados.
- A chave Gemini local retornou restricao de acesso ao modelo legado; o teste foi repetido
  com a chave do n8n e funcionou. Nao houve troca automatica do modelo/credencial de producao.
- Nenhuma reserva existente foi apagada ou transferida de unidade.
- Detalhes e ordem de ativacao: `UNIDADES_E_AGENDA.md`.

## Registro anterior: canonical_v2

As secoes abaixo documentam a etapa anterior, antes da atualizacao Movvy acima.

## Identidade e isolamento

- Tenant: `clinica_nubia_oficial` (`563a93cd-a5c1-4412-a65f-be2e2d41bb88`).
- Instancia Evolution: `clinica_nubia`; telefone: `5524998696802`.
- Canal WhatsApp ativo; nenhum Telegram criado no tenant oficial.
- Configuracao comercial e 15 servicos copiados do tenant antigo, sem historico.
- Configuracoes dos outros tenants comparadas antes/depois: inalteradas.

## Diagnostico

O WhatsApp antigo nao consultava o catalogo e priorizava outra versao de prompt.
Copiar instrucoes do Telegram nao executava suas acoes de agendamento/pagamento.
A primeira correcao restaurou contexto; esta etapa portou o processamento.

## Incidente de endereco e perda de contexto

Em 25/09, eventos reais comprovaram enderecos inventados (Rua das Flores 123,
Rua do Comercio 150 e referencias sem cadastro). O cadastro oficial nao tinha
endereco. O runtime tambem cortava o historico em 12 registros, perdendo dados
de agendamento e reenviando respostas inventadas antigas como contexto do modelo.
Os testes anteriores nao tinham coberto conversas longas nem fatos ausentes.

Correcao canonical_v2: prompt unico, fatos verificados, saida JSON com evidencias
de mensagens da cliente, endereco/Pix formatados pelo codigo e preservacao do
historico da sessao. Respostas antigas nao verificadas do bot sao excluidas do
contexto, sem apagar mensagens da interface. Dados da cliente sao preservados.

## Publicado e ativado

- WhatsApp: `Y318foGE6xQlpP3h`, versao `6e37e938-4d61-45f1-91ac-92856569d5e3`.
- Comandos: `804sM2HhS8BYJXuS`, versao `5cbc648c-7b9b-4968-bcc9-d1eb54a3d816`.
- Migration 017 executada pelo operador; RPC verificada.
- Opt-in somente oficial: `whatsapp_processing_mode = conversation_core_v1`.
- Grounding somente oficial: `grounding_mode = canonical_v2`.
- Um unico system_instruction: `tenant_settings.settings.system_prompt`.
  Nao consulta ai_agents/ai_prompt_versions/Redis/vector store para instrucoes.
  A personalidade foi consolidada no prompt; conversation_style_instructions removido.
- Fonte comercial: o mesmo projeto Supabase, settings.business_facts/payment
  e tenant_service_catalog, sempre do tenant oficial. Historico nao altera fatos.
- Endereco confirmado pelo responsavel: Av. Itaguai, 200 - Nova Angra,
  Angra dos Reis - RJ, 23933-115, Brasil. Nenhuma outra unidade foi inventada.
- Oito novos nos; parametros dos nos WhatsApp preexistentes inalterados.
- Universo Prata segue na rota anterior, incluindo seu catalogo de fotos.
- Telegram antigo nao alterado.
- Variaveis Evolution/Supabase e chave Gemini verificadas no processo n8n.
- Novo motor usa GEMINI_API_KEY do ambiente e modelo configurado no tenant:
  gemini-2.5-flash (sem Lite), temperatura 0.2, thinkingBudget 512,
  maxOutputTokens 2048 e schema JSON. Outros tenants conservam a rota antiga.

## Fluxo

1. Entrada gravada e deduplicada; fila por tenant/canal/conversa.
2. Janela reiniciada a cada mensagem: 12s normalmente, 25s para fragmentos
   curtos sem pontuacao, conforme settings atuais. Soma-se tempo de geracao.
3. Lote inteiro enviado junto ao modelo, com prompt, catalogo e historico
   posterior ao ultimo encerramento. Recuperacao periodica a cada 10s.
4. Novas mensagens durante geracao invalidam a resposta antes dos efeitos;
   o lote e reprocessado junto. Isso pode consumir uma chamada adicional.
5. Nome, servico, data e hora validos geram reserva pending_payment.
6. SINAL PAGO muda para payment_reported/Verificar Sinal e envia apenas aviso
   curto. A IA fica pausada, aguardando verificacao humana.
7. Confirmar no Kanban envia a mensagem final configurada e registra confirmed.
   Cliques concorrentes/repetidos sao bloqueados; atendimento continua humano.
8. Encerramento delimita novo contexto, sem apagar historico.

## Verificacao

- 68 testes passaram: acesso, encerramento, midia existente, fila, agendamento,
  pagamento, concorrencia e isolamento SQL.
- Migration real testada em PostgreSQL/PGlite local.
- Code runner hospedado + Gemini real + consultas reais: tres mensagens
  agrupadas produziram uma resposta e reserva simulada pending_payment,
  com data/hora corretas. Escritas e envios interceptados: nenhum WhatsApp
  enviado e nenhum agendamento real criado nesta validacao.
- Execucoes 1320, 1321 e 1322: recuperacao da fila em producao sem erros.
- Testes Gemini real canonical_v2: 3007 (agendamento), 3011 (dados 29 registros
  antes), 3012 (servicos/precos), 3021 (endereco sem Gemini), 3023 (handoff).
  Gravacoes/envios simulados: nao foram enviados testes para clientes.
- Prompt/codigo/endereco/modelo publicados comparados com os arquivos locais.
- Nenhum historico ou memoria Redis apagado. Nenhum commit/push nesta etapa.

## Homologacao pendente e limites

Testar pelo WhatsApp: encerrar conversa anterior; enviar saudacao, servico,
dia/hora futuro e nome em sequencia; conferir resposta unica e reserva.
Pedir Pix, enviar SINAL PAGO, conferir aviso curto e Verificar Sinal; clicar
Confirmar e conferir mensagem final, agenda e Kanban. Encerrar e reabrir.

Audio/arquivos nao transcritos encaminham para equipe; nao fingir compreensao.
Historico completo da sessao limitado a 250 registros/65000 caracteres:
ao exceder, encaminhar para humano, nunca truncar silenciosamente os dados.
O limite diario legado nao e atomico entre chats;
nao tratar como teto financeiro garantido. Aceite Evolution nao prova entrega.
Falhas incertas de envio exigem reconciliacao, nunca reenvio automatico cego.

## Arquivos e rollback

- Guia: docs/operations/whatsapp_conversation_core.md.
- 02_restaurar_contexto_whatsapp.sql: contexto e personalidade.
- 03_ativar_processamento_whatsapp.sql: reproduz ativacao JA aplicada por API.
- prompt_canonico_v2.txt e business_facts_v2.json: fontes versionadas do cadastro.
- 04_fonte_unica_whatsapp.sql: reproduz a correcao JA aplicada. Gerar com
  node scripts/build/sql/build_nubia_grounding_sql.cjs. Nao executar 02 depois de 04.
- Backups de publicacao/ativacao: .local/backups/ (ignorado pelo Git).
- Rollback restrito: pausar trafego oficial, reconciliar mensagens em andamento
  e remover apenas whatsapp_processing_mode das settings oficiais. Volta para
  rota anterior SEM esta paridade. Nao restaurar workflows compartilhados
  cegamente nem apagar a fila. Nao precisa executar outro SQL agora.
