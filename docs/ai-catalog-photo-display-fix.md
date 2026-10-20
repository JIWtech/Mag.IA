# Exibição de fotos do catálogo enviadas pela IA

O registro `sales_product_photo` criado por `sendChannelMessage` não continha URL nem objeto `media`. O frontend recebia um evento sem texto e sem anexo renderizável. O fonte agora persiste a URL efetivamente enviada, o ID retornado pelo provedor, o tipo de mídia e a legenda efetivamente enviada (somente na primeira foto).

O Kanban usa a legenda ou o rótulo Imagem para esses eventos sem texto; o tooltip também passa pela formatação amigável.

Validação local: teste de regressão falhou antes da correção pela ausência de `raw_payload.media`; após a correção, 4/4 testes direcionados passaram. Build do frontend e revisão de whitespace passaram. Suíte completa: 565 aprovados e 16 falhas em testes de arquitetura, localização e renderização de mídia. Não foi estabelecida uma execução de referência anterior para essas 16 falhas.

O CORE foi regenerado pelo builder canônico. Duas gerações mantiveram o hash normalizado do CORE; timestamps e hashes dos arquivos com metadados variam por geração.

Limitações: sem publicação no n8n, alterações de banco ou envio real. Eventos antigos sem URL não são recuperados por esta mudança. Esta evidência comprova a falha no registro de fotos, mas não explica por si só eventual ausência de mensagens de texto. Paridade do workflow publicado e comportamento do caso real ainda não foram verificados.

Rollback: remover o objeto `media` acrescentado no fonte, regenerar com `node scripts/build_noria_workflows.cjs` e reverter apenas o fallback e tooltip do Kanban deste ajuste. Preservar as alterações independentes da landing page.
