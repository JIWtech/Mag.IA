# Revisao da integracao da branch dev - 29/09/2026

## Evidencias

Consulta somente de leitura ao Supabase oficial, sem mensagens de teste nem alteracoes remotas:

- `conversation_core_v1`, `canonical_v2`, `session_v2`, Gemini 2.5 Flash.
- Uma unidade no cadastro: Angra. Responsavel confirmou essa configuracao nesta revisao.
- Prompt ativo: `nubia-2026-09-28-agendamento-v1`, diferente do trecho que 022 originalmente aceitava.
- O prompt ativo exige unidade sustentada por mensagem em dois lugares, apesar da unidade unica.
- Em 419 registros consultados desde 28/09: 47 bloqueios `Unit without customer evidence`,
  15 `media_not_transcribed`, 2 de horario, 2 de data, 2 de reserva incompleta e 2 de
  promessa de acao nao executada. Sao eventos, nao necessariamente clientes distintos.
- Existe uma versao legada ativa em `ai_prompt_versions`. O Core canonico nao a consulta.

## Resolucao

O merge em andamento integra `3d8fd55` com `f39aa27` e seus tres antecessores de follow-up.
Nao escolher o arquivo gerado inteiro de um lado: preservar fontes mescladas e regenerar
o Core e o workflow. Foi preservado `binaryMode=separate` vindo do remoto e a rota legada
de WhatsApp, incluindo Universo Prata. Encerramento, sessoes e pagamento nao foram removidos.

- Unidade unica e fato da configuracao, nao exige evidencia textual da cliente.
- Multiunidade continua exigindo selecao e evidencia. Testes usam configuracao separada
  para nao confundir o comportamento generico com o cadastro atual da clinica.
- 022 agora aceita a variante comprovadamente ativa de 28/09, corrige o bloco adicional
  de coleta de unidade e pode ser repetido. Variantes desconhecidas ainda abortam.
- 04/05/06 foram regenerados da mesma fonte canonica, incluindo Angra e sessoes independentes.
- Falha ao programar follow-up nao transforma mensagem enviada e persistida em erro/handoff.
- 020 foi corrigida para novas instalacoes e 023 corrige instalacoes existentes que permitiam
  leitura anonima de jobs. Apenas membros ativos autenticados podem ler os jobs da clinica.

## Ativacao segura (nao executada nesta revisao)

1. Publicar o codigo gerado de `Processar Conversa WhatsApp` (ou importar o workflow revisado
   preservando as credenciais e as configuracoes remotas).
2. Executar `022_nubia_single_angra_scheduling.sql` revisado, nao a copia anterior do commit remoto.
   Ele preserva o resto do prompt ativo e as configuracoes comerciais/sessoes.
3. Se follow-up 019/020 ja estiver instalado, executar `023_follow_up_dashboard_access.sql`.
4. Nao e necessario reaplicar 04/05/06 para este ajuste: o remoto ja possui `session_v2`.
5. Publicar frontend se for desejada a integracao visual de follow-up recebida no merge.
6. Testar em contato autorizado: saudacao, Sim, Sexta-feira, bairro, servico, data, horario,
   nome; conferir consulta de vagas e pendencia de sinal. Depois SINAL PAGO e confirmacao humana.
7. Conversas ja sob controle humano continuam assim. Retomar cada uma explicitamente,
   sem liberar em massa ou apagar historico/reservas. Para teste limpo, encerrar antes.

Nao foram feitos push ou deploy nesta revisao. O merge local nao atualiza n8n nem Supabase.

## Limites e proximos riscos

- Audio ainda exige transcricao; alterar o prompt nao resolve `media_not_transcribed`.
- Sexta tem inicios 14:00, 15:30, 17:00. O pedido apos 18h/18:20 do print nao pode gerar
  reserva nesse horario com a grade atual. Nao foi ampliada a agenda sem autorizacao.
- O dispatcher de follow-up recebido no merge usa uma chamada Gemini separada, sem o
  mesmo validador canonico, sem recorte explicito da sessao e sem o contador diario do Core.
  Sua ativacao/ampliacao nao foi autorizada por esta revisao. Revisar esse fluxo antes de
  trata-lo como equivalente ao atendimento principal; nao considerar essa parte homologada.
- Ha dois arquivos com prefixo 019 (sessoes e follow-up), provenientes das branches.
  Nao renomear migrations ja aplicadas nem executar `supabase db push` automaticamente.
  Conferir o historico remoto e executar por nome completo no SQL Editor; normalizar a
  numeracao em uma manutencao especifica se for adotado deployment automatico de migrations.

## Verificacao

Suite local cobre unidades unica e multiplas, evidencias, capacidade, reservas adicionais,
fechamento/reabertura, pagamento, falha de follow-up, idempotencia de 022 e RLS de 023.
Build Vite validado. Nenhum envio real, reserva real ou desativacao remota foi efetuado.
