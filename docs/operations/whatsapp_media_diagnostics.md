# WhatsApp: catalogo de fotos e diagnostico

## Verificado em 2026-09-21

- O tenant universo_prata possui quatro categorias e tres imagens por categoria.
- O codigo local seleciona tres fotos para "me mostra pulseiras" usando o Supabase atual.
- Os eventos inspecionados registram `product_media_delivery.skipped = no_product_media`.
  Nessas execucoes, nenhuma chamada de envio de foto foi feita.
- Ha eventos com `raw_payload` como objeto e outros como string contendo JSON.
  Uma consulta direta `raw_payload->'product_media_delivery'` pode retornar null
  mesmo quando o campo existe dentro da string.
- A interface antiga exibia `response_text` do inbound e tambem o outbound.
  A correcao mantem o outbound e preserva respostas legadas sem evento de saida.
- Links do Wikimedia retornaram HTTP 429 durante a verificacao. Isso e um risco
  adicional de download; nao explica execucoes que pularam o envio por falta de selecao.

## Arquivos e aplicacao

- Fontes: `n8n/code/whatsapp_prepare_context.js` e `whatsapp_prepare_sent.js`.
- Gerar JSON: `node scripts/build_whatsapp_media_nodes.cjs`.
- Testes sem Gemini, WhatsApp ou alteracoes no banco:
  `node --test scripts/test_whatsapp_media.cjs`.
- Importar/publicar `n8n/workflows/magia_whatsapp_evolution_mvp.json` no n8n hospedado.
  Conferir as credenciais Supabase, Redis, Gemini e Evolution apos a importacao.
  Manter somente um workflow ativo para `/webhook/magia-whatsapp`.
- Esta correcao nao exige migration nem reaplicar o seed do cliente.
- O push do frontend foi feito em `dev`. Um site vinculado a `prod` so recebe
  essas alteracoes apos a promocao aprovada e um novo build/deploy.

O JSON local grava a entrada antes do Gemini. A revisao do catalogo aparece em
`catalog_diagnostics.workflow_revision = whatsapp-session-reset-2026-09-21`.
Nao considerar a publicacao ou entrega de fotos validada apenas pelos testes locais.

## Credenciais

O no `Gemini Chat Model` usa a credencial selecionada no proprio n8n. O envio de
texto pela Evolution usa a credencial do no visual. O envio de fotos usa as
variaveis `EVOLUTION_API_URL_{TENANT}`, `EVOLUTION_API_KEY_{TENANT}` e a instancia
recebida no evento, com fallback para `EVOLUTION_INSTANCE_{TENANT}`.
As variaveis precisam estar acessiveis no ambiente que executa os Code nodes;
ter uma credencial Supabase funcionando em outro no nao comprova esse acesso.
Nao copiar senhas ou chaves para o repositorio.

## Teste controlado

1. No numero usado nos testes, enviar "Quero ver pulseiras".
2. Conferir no contexto `catalog_categories = 4`, `selected_count = 3` e
   `selection_source = current_message`.
3. Conferir `product_media_delivery.sent`: `accepted` significa que a Evolution
   aceitou o envio e retornou ID; confirmar tambem o recebimento no aparelho.
4. Enviar "manda de novo" e conferir `selection_source = conversation_history`.
5. Categoria nao e recuperada de uma sessao encerrada nem inventada a partir
   apenas de promessas anteriores da IA. Nesse caso, informar novamente a categoria.

Consulta compativel com os dois formatos historicos de payload:

```sql
with recent as (
  select created_at, direction, message_text,
    case when jsonb_typeof(raw_payload) = 'string'
      then (raw_payload #>> '{}')::jsonb
      else raw_payload
    end as payload
  from public.channel_events
  where tenant_slug = 'universo_prata'
  order by created_at desc
  limit 20
)
select created_at, direction, message_text,
  payload->'catalog_diagnostics' as catalog_diagnostics,
  payload->'product_media_matches' as media_matches,
  payload->'product_media_delivery' as media_delivery
from recent
order by created_at desc;
```

Interpretacao:

- `missing_supabase_env_in_code_node`: variaveis ausentes ou bloqueadas no Code node/runner.
- `tenant_settings` com status HTTP: falha na leitura da configuracao pelo Code node.
- `catalog_categories = 0`: catalogo nao carregado ou vazio.
- `catalog_categories > 0`, `selected_count = 0`: categoria nao encontrada na mensagem/historico.
- `missing_or_placeholder_evolution_media_env`: falta configuracao de envio de fotos.
- `sent[].status = failed`: houve tentativa; conferir HTTP e erro na execucao/Evolution.
- `unconfirmed`: resposta da Evolution sem ID de mensagem; nao tratar como entrega.

Para entrega estavel, os arquivos reais da loja devem ficar em armazenamento
controlado (por exemplo Supabase Storage), com URLs acessiveis pela Evolution.
O catalogo atual continua usando imagens externas de exemplo; nao foi migrado
automaticamente para Storage nem apresentado como estoque real da loja.

## Limite conhecido

### Encerramento de atendimento

O encerramento grava `service = conversation_closed` no Supabase. Antes desta
correcao, a memoria Redis usava a mesma chave por contato por ate 24 horas.
Isso fazia a IA continuar o atendimento anterior apesar do status Finalizado.

Agora o workflow consulta o ultimo encerramento filtrando tenant, canal e contato.
Esse evento define `conversation_session_id` e uma nova `memory_session_key`.
Somente eventos posteriores ao encerramento sao usados como contexto ativo.
A consulta ao encerramento e independente da janela de 40 eventos, para que a
chave nao volte a apontar para a memoria antiga quando a conversa crescer.
Atendimentos sem encerramento previo preservam a chave Redis existente.

O historico da interface e preservado; nenhuma conversa ou chave de outros
clientes e apagada. A memoria antiga expira pelo TTL existente. Ha uma verificacao
antes do envio: se o operador encerrou enquanto a IA gerava a resposta, ela e
descartada com `conversation_closed_during_processing`. Essa verificacao nao e
uma transacao atomica com o envio externo; uma mensagem ja entregue ao provedor
nao pode ser cancelada retroativamente.

Aplicar: importar/publicar o JSON atualizado de WhatsApp. Nao precisa migration,
limpar Redis inteiro, mudar prompt ou reinstalar o Command Router. O botao de
encerrar existente ja grava o evento necessario. Confirmar isso com o teste:

1. Pedir um produto e aguardar resposta.
2. Encerrar pelo painel e verificar Finalizado.
3. Mandar uma nova saudacao no WhatsApp.
4. Conferir que a IA inicia um novo atendimento, sem retomar o pedido antigo.
5. Na execucao, conferir `conversation_session_id` igual ao ID do encerramento,
   `hasHistory = false` na primeira mensagem e chave Redis diferente da anterior.
6. Mandar nova mensagem e conferir que a chave permanece a mesma na nova sessao.

### Agrupamento de mensagens

Este JSON possui deduplicacao por ID, mas nao possui buffer de debounce para
agrupar varias mensagens diferentes. Nao descrever esse mecanismo como implementado.
O ajuste de fotos e a correcao visual nao alteram essa parte do fluxo.
