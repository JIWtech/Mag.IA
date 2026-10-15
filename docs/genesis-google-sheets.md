# Google Sheets do estoque da Gênesis

A EXT Gênesis lê somente a planilha configurada em `tenant_settings.sales.sheet_id` para o tenant `wesley_automoveis`. A aba é `Página1` por padrão e pode ser alterada por `tenant_settings.sales.sheet_tab`. O CORE não lê Google Sheets: ele recebe apenas o resultado comercial autorizado do despacho por turno.

## Credenciais

O acesso usa a Google Sheets API, nunca `gviz` público. Configure uma destas opções no ambiente do n8n:

1. `GOOGLE_SHEETS_ACCESS_TOKEN`, com permissão de leitura na planilha; ou
2. renovação OAuth na EXT Gênesis: configure em `tenant_settings.sales` os nomes de `google_sheets_refresh_token_env`, `google_sheets_client_id_env` e `google_sheets_client_secret_env`. A EXT troca o refresh token por um access token em cada leitura e não persiste esses valores.

Opcionalmente, `tenant_settings.sales.google_sheets_access_token_env` seleciona outro nome de variável. O nome é validado e nenhum valor de credencial entra no workflow ou nos eventos.

A EXT retorna `INVENTORY_CREDENTIALS_UNAVAILABLE` quando o token não existe, e o CORE falha fechado ao receber esse resultado. O último estoque confiável já persistido no estado comercial continua apenas como contexto histórico; nenhuma resposta passa a inventar preço ou disponibilidade.

Falha de renovação retorna `INVENTORY_CREDENTIAL_REFRESH_FAILED`; nomes de variáveis incompletos ou inválidos retornam `INVENTORY_CREDENTIAL_CONFIG_INVALID`.

## Despacho comercial por turno

A primeira chamada CORE → EXT valida tenant, canal e configurações permitidas e devolve somente `noria_client_policy`. Depois de reivindicar a fila, o CORE carrega `sales_leads` e o último catálogo enviado da sessão e faz uma segunda chamada `conversation.evaluate`.

O payload dessa segunda chamada contém `tenant_id`, `tenant_slug`, `session_id`, `request_id`, mensagens agrupadas, `stage_key`, `ai_locked`, `revision`, estado comercial persistido e `catalog_context`. A EXT resolve números contra os IDs da lista efetivamente exibida, mas busca preço e status no estoque autenticado atual. O CORE aceita o resultado somente quando a sessão e o token da reivindicação correspondem.

O catálogo numerado é gravado em `channel_events.raw_payload.catalog_context` apenas depois da aceitação do envio pelo canal. Ele contém a ordem, IDs, dados de exibição, origem e horário. Eventos antigos com apenas `catalog_item_ids` continuam legíveis como compatibilidade de histórico; eles preservam a ordem e nunca usam o índice atual da planilha.

## Outros tenants

Esta integração autenticada é exclusiva da Gênesis. Núbia não consulta estoque automotivo. Royal 4x4 permanece no seu adaptador próprio de catálogo/Supabase e não usa esta credencial nem a planilha Gênesis.

## Estados aceitos

`ANUNCIADO` e `DISPONÍVEL` são ofertáveis. `VENDIDO`, `RESERVADO`, `INDISPONÍVEL` e `NÃO VERIFICADO` continuam legíveis para consulta/contexto histórico, mas são removidos de qualquer lista de carros ou motos ofertada ao cliente.
