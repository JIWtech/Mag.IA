# Unidades, agenda e documento Movvy

## Fontes e escopo

Aplicacao comercial apenas ao tenant `clinica_nubia_oficial`. Universo Prata nao alterada.
Fonte: `Movvy_Agendamento_Servicos.docx` e confirmacoes do responsavel nesta conversa.
O titulo Movvy do documento nao altera a identidade comercial da Clinica da Nubia.

- Unidade única: Av. Itaguai, 200 - Nova Angra, Angra dos Reis - RJ, 23933-115, Brasil.
- A unidade `angra` é assumida automaticamente pelo Core; a cliente não precisa escolher região.
- 4 Classico, 1 Comfort, 1 Premium por inicio; blocos de 90 minutos.
- Procedimento Classico dura 60 minutos, sem reduzir o bloco reservado de 90.
- Comfort e Premium: 90 minutos. Banho de Lua: unico, 40 minutos, sem variacoes.
- Jato: a domicilio. Solar: ao ar livre. Orientacoes de cada modalidade separadas.
- Precos anteriores preservados para Classico, Comfort, Premium e Solar.
- Precos complementados pelo responsavel no chat: Banho de Lua unico R$60,00;
  Bronze a Jato a domicilio R$200,00. Valores no catalogo, nao duplicados no prompt.
  A consulta de agenda desses servicos permanece com a equipe.
- Variacoes antigas de Banho de Lua e Jato corpo/bojo serao desativadas no catalogo,
  nao apagadas. Reservas e historico continuam intactos.
- Combos e adicionais omitidos do documento estao preservados ate confirmacao do responsavel.
  Fora das tres modalidades com capacidade definida, agendamento segue para a equipe.

## Arquivos autoritativos

`prompt_canonico_v2.txt` continua sendo o arquivo do unico prompt; revisao nova
`nubia-2026-09-25-movvy-v3`. O nome do arquivo foi preservado para evitar segunda fonte.
`business_facts_v2.json`, `scheduling.json`, `payment_update.json` e
`catalog_document_update.json` alimentam `node scripts/build_nubia_scheduling_sql.cjs`.
O resultado e `05_unidades_agenda_pagamento.sql`. Nao editar o SQL gerado isoladamente.

## Ativacao

1. O core compativel JA foi publicado no n8n. Nao importar outro workflow duplicado.
2. Publicar o frontend atualizado para ter os seletores de unidade/servico/horario.
3. Executar `supabase/migrations/018_appointment_capacity.sql` no SQL Editor.
4. Executar `clients/clinica_nubia_oficial/05_unidades_agenda_pagamento.sql`.
5. Revisar os agendamentos legados retornados pelo SELECT final e atribuir a unidade `angra` quando confirmado.
6. Testar uma nova sessão: informar serviço, data, horário e nome em mensagens separadas;
   conferir resposta única, unidade `angra` e `pending_payment` na agenda/Kanban.
7. Pedir Pix; informar SINAL PAGO; verificar aviso curto e Verificar Sinal.
   Apenas Confirmar pelo operador pode enviar o texto final e mudar para confirmed.

Os SQLs 018 e 05 sao transacionais e repetiveis, testados juntos em PGlite.
Nao ha acesso SQL administrativo remoto configurado nesta sessao: os dois arquivos
ainda precisam ser executados pelo operador no Supabase.

## Garantias e limites

- Consulta de disponibilidade retorna somente inicios disponiveis, nunca numero de vagas.
- Reserva revalida a ocupacao no banco. Contador atomico por tenant/unidade/recurso/inicio
  impede duas insercoes concorrentes de ocuparem a ultima vaga.
- Trigger cobre tambem insert/update/delete via interface ou REST, nao apenas o bot.
- Cancelamento libera ocupacao; pending_payment, payment_reported e confirmed a conservam.
- RPC usa chave idempotente e bloqueia segunda reserva futura para a mesma conversa.
- Reservas legadas sem classificacao bloqueiam apenas intervalos sobrepostos para revisao;
  nao sao ignoradas, apagadas ou migradas silenciosamente.
- Uma consulta de disponibilidade pode ficar desatualizada; a reserva e quem decide.
- Erro de RPC ou grade/servico sem configuracao nunca usa POST sem validacao como fallback.
- Horarios sugeridos em texto livre pelo Gemini sao substituidos pela consulta ao banco.
- Respostas do assistente de revisoes antigas do prompt nao retornam como fatos ao modelo;
  mensagens da cliente continuam preservadas dentro da sessao.
- Acrescimo de R$10 apos 17h, domingos e feriados esta nas politicas. 17h exatas nao
  correspondem a "apos 17h". Nao foi inventado calendario de feriados nem total final;
  cotacoes com feriados/adicionais precisam de verificacao humana enquanto nao houver cadastro.
- A politica do sinal e mantida; nao ha expiracao automatica de reservas nao pagas definida.
- Testes locais de capacidade usam PostgreSQL/PGlite; ainda e necessaria homologacao no
  Supabase real, inclusive duas sessoes concorrentes. Nenhum teste enviou WhatsApp real.

## Reversao

Nao remover a migration nem as tabelas de ocupacao para reverter interface/modelo.
Desativar a agenda automatica sem plano pode reintroduzir o POST legado sem capacidade.
Se houver incidente, colocar o atendimento sob controle humano e conservar reservas/ledger.
Backups anteriores a publicacao estao em `.local/backups/*-before-scheduling` (ignorados no Git).
