# NORIA — execução em etapas Hotfix12

Data: 2026-10-08. Trabalho local בלבד: sem deploy, commit, push, publicação n8n, migration remota ou alteração do Supabase LIVE.

## Etapa 1 — Genesis: referência atual do catálogo vence o contexto histórico

O gerador do Core agora aplica uma prioridade determinística para um `catalog_referral` atual de origem `whatsapp_catalog_product` acompanhado de pergunta de disponibilidade. A referência é foco de **compra** neste turno; uma venda prévia é mantida somente como parte de `transaction_mode = buy_and_sell`.

- O interesse de compra recebe produto, marca, modelo, ano e evidência do produto referido quando há correspondência única no catálogo canônico.
- Dados da venda anterior não são apagados nem usados como produto de compra.
- A resposta reconhece o produto, mas não afirma disponibilidade e não informa preço a partir da planilha. Oferece verificação humana.
- O adaptador legado `whatsapp_sales.js` também reconhece `catalog_referral` e não trata a planilha como confirmação de disponibilidade/preço para item WhatsApp.

Reprodução validada: estado prévio de venda de Siena 2014 + referência `27808173632149872` / `Nissan Versa 1.6 2013` + “ainda disponível?” mantém Siena como trade-in, fixa foco `buy`, seleciona apenas Versa SL 2013 e devolve a resposta segura sem preço nem promessa de disponibilidade.

## Etapa 2 — comparação REVIEW × Hotfix12 e melhoria Núbia compatível

O REVIEW não substituiu o workflow: ele tem IDs/layout e revisão diferentes. A comparação das funções de agendamento encontrou duas diferenças materiais:

1. `groundingTimeFromEvidence` aceita opção numérica somente se houver menu verificado. O REVIEW não inclui uma cadeia persistida de opções nem passa essa lista aos chamadores; portanto não foi importado isoladamente, pois permitiria interpretar um número sem prova do menu.
2. `groundingGuardNubiaFutureAppointment` no REVIEW identifica duplicidade/sobreposição na janela solicitada. Essa melhoria foi incorporada na fonte Hotfix12.

O guard da Núbia agora recebe o estado estruturado da reserva, valida data/hora/serviço, consulta apenas a janela potencialmente sobreposta do mesmo tenant e conversa e bloqueia `NB_DUPLICATE_FUTURE_APPOINTMENT` ou `NB_OVERLAPPING_FUTURE_APPOINTMENT`. Reserva em outro dia continua permitida. O RPC atômico de reserva existente permanece inalterado; o pré-agendamento segue pendente de pagamento.

## Etapa 3 — geração e integridade do workflow

`scripts/build_whatsapp_core.cjs` é idempotente e:

- substitui projeções de cache somente por colunas permitidas;
- injeta as duas correções determinísticas com marcadores verificáveis;
- valida sintaticamente o Code node;
- atualiza exclusivamente `parameters.jsCode` de `Processar Conversa WhatsApp` no workflow Hotfix12;
- preserva nós, IDs, posições, metadados e conexões.

O arquivo preservado é `n8n/workflows/NORIA_Hotfix12_CATALOGO_REFERENCIAS_PRODUTOS_LAYOUT.json`. O workflow antigo renomeado não foi recriado nem publicado.

## Validação executada

| Comando / caso | Resultado |
| --- | --- |
| `node scripts/build_whatsapp_core.cjs` | PASS (inclusive repetido para idempotência) |
| Reprodução Genesis “Versa após venda” | PASS |
| Teste Núbia duplicidade/sobreposição e outro dia | PASS |
| `node --test scripts/test_whatsapp_sales.cjs` | 139 PASS, 23 FAIL preexistentes |
| `node --test scripts/test_whatsapp_core.cjs` | 57 PASS, 10 FAIL preexistentes |
| `git diff --check` | PASS |

As 10 falhas Núbia preexistentes estão relacionadas a fixtures que usam `Maria` como nome não completo ou esperam gravação por tags/fluxo anterior, enquanto Hotfix12 exige evidência estruturada e nome completo. A nova cobertura usa `Maria Souza` e passa. As 23 falhas de vendas incluem a paridade histórica exigindo igualdade textual entre o adaptador legado e o Core Hotfix12 já divergentes antes desta etapa, além de expectativas antigas de resposta/estágio. Elas não foram alteradas para ocultar regressão.

## Pendências e riscos

- A seleção numérica de um menu de horários só deve ser conectada quando o contrato do Core persistir as opções verificadas que foram efetivamente enviadas ao cliente; o REVIEW isolado não fornece isso.
- A equivalência total entre `whatsapp_sales.js` legado e o Core Hotfix12 continua uma divergência preexistente. O gerador agora garante equivalência entre o Core gerado e o Code node do workflow Hotfix12.
- A Evolution real permanece pendente de execução no n8n que detenha URL/chave/versão. Não houve produto, imagem, preço ou resposta de provedor inventados.

