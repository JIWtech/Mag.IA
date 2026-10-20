# Carregamento de conversas e consistência de leads

## Alterações

- A carga inicial reaproveita URLs em cache, sem esperar assinaturas de todos os anexos. O componente de mídia mantém a resolução sob demanda e a recuperação de erros.
- A timeline monta inicialmente 80 mensagens, com botão para exibir mais 80. A posição de leitura é preservada ao mostrar mensagens anteriores. A troca de conversa ou empresa reinicia a janela.
- A leitura do histórico retorna os 1000 eventos mais recentes, em vez dos 1000 mais antigos; a apresentação continua em ordem cronológica. Falhas de consulta são propagadas para permitir nova tentativa ao reabrir a conversa.
- O cache do histórico usa empresa e conversa. Uma requisição cancelada não marca um histórico não exibido como carregado.
- A transformação de eventos evita copiar todo o restante da lista em cada mensagem comum; a busca de continuidade só ocorre para a saudação genérica que precisa desse tratamento.
- O responsável da conversa agora acompanha o responsável do card quando o lead persistido determina controle humano ou IA. O teste novo reproduziu o erro anterior: card Wesley e conversa Assistente IA.
- IDs WhatsApp de grupo e LID não geram variantes de telefone ao buscar o histórico.

## Validação local

149 testes direcionados aprovados: transformação de conversas/cards, estados de lead, responsáveis, isolamento e mídias. Os testes novos cobrem responsável divergente, carga sem chamadas a Storage, ordenação recente, filtro de empresa, LID/grupo e propagação de falhas de histórico.

Suíte completa: 586 testes, 571 aprovados e 15 falhas. A execução anterior registrada tinha as mesmas 15 falhas de arquitetura, localização e estrutura de componentes. Build do frontend e diff --check aprovados.

## Limites

Sem publicação, escrita no banco ou envio real. A consistência foi validada com cenários locais; leads reais e publicação Realtime em produção não foram auditados nesta alteração. Não foi medida latência no navegador autenticado. A consulta continua limitada a 1000 eventos recentes; o botão da timeline revela o histórico já disponível, sem prometer paginação além desse limite.

## Rollback

Reverter somente os trechos desta alteração em dataService.js, mediaUrlService.js, conversationHistoryReads.js, eventsToConversations.js, Conversations.jsx, ConversationTimeline.jsx e o estilo timeline-load-older em conversations.css. Remover conversationPerformance.test.js. Preservar os ajustes anteriores de mídia, CORE, Kanban e landing.
