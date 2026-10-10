# BLOCKED — EVOLUTION_RUNTIME_UNAVAILABLE

Nenhuma variável `EVOLUTION_*`/`N8N_*` foi disponibilizada nesta sessão e o
runtime Docker local não está acessível. Portanto não foi possível identificar
a versão instalada, estado de `wesley-carros`, endpoint implementado ou obter
uma resposta real para o produto `28062470200101732`.

Não houve alteração do parser Evolution nesta etapa.

## Acesso necessário

Executar no host autorizado do n8n, onde já existem `EVOLUTION_API_URL_*`,
`EVOLUTION_API_KEY_*` e `EVOLUTION_INSTANCE_*`. Não copiar esses valores para
o relatório.

## Consulta isolada

No n8n, criar/executar localmente (sem publicar) uma chamada HTTP de leitura
para o endpoint de catálogo comprovado pela versão instalada, usando a
instância `wesley-carros` e o número configurado no canal. Registrar somente:

- versão/imagem da Evolution e tipo de integração;
- método, rota e status HTTP;
- JSON sanitizado, preservando chaves e tipos;
- posição do array de produtos, paginação e o resultado do ID de referência;
- campos de preço e imagem, sem converter unidade monetária.

Rotas candidatas para testar uma a uma, somente se a versão/metadata as
indicar: `business/getCatalog`, `business/getCollections`, `chat/fetchCatalogs`
e `chat/fetchCollections`. Não fazer varredura nem enviar mensagens.

Com essa evidência sanitizada, o parser e as fixtures poderão ser ajustados.
