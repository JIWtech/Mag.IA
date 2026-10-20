# Central de notificações do operador

## Interface

A central reúne atividades do tenant e o histórico de pendências já fornecido pelas RPCs de notificações. A apresentação remove IDs, tickets, revisões, códigos de erro e explicações de infraestrutura. Há filtros por leitura, atenção e categoria; agrupamento por dia; contador; leitura individual/em lote; e ação para abrir a conversa equivalente por identidade normalizada ou a área pertinente.

Ler uma notificação não modifica o lead, a atribuição, a entrega ou o estado da conversa. Avisos operacionais são compartilhados quanto ao assunto entre os operadores autorizados do tenant, mas leitura e som são individuais por usuário/tenant neste navegador. Uma atribuição é apresentada pelo nome do responsável; não é anunciada como atribuída ao usuário conectado sem evidência dessa identidade.

## Gatilhos implementados

| Origem existente | Avisos |
| --- | --- |
| Mensagens recebidas | Texto e anexos com resumo legível; exclui reações, eventos internos e atualizações de metadados |
| Atendimento | Atribuição, pedido de humano, retomada pela IA, encerramento, reabertura explícita e dificuldade para continuar |
| Leads | Novo lead, mudança de etapa/controle da IA, interesse, lead quente, financiamento, avaliação de troca, negócio fechado e outras etapas com rótulos humanos |
| Kanban | Mudança de etapa por evento de controle |
| Entrega | Envio com falha ou sem confirmação; nunca recomenda reenviar sem conferir |
| Anexos | Falha de download, armazenamento ou verificação |
| Agenda | Criação, confirmação, mudança de horário, cancelamento, conclusão, pagamento pendente/informado/confirmado |
| Lembretes | Compromissos agendados/confirmados nos próximos 15 minutos; retomadas pendentes cujo horário chegou nas últimas 24 horas |
| Campanhas | Conclusão, erro parcial, falha, pausa e cancelamento |
| Conexão local | Perda e restabelecimento da conexão do navegador |
| Pendências do backend | Atendimento precisa da equipe, entrega ainda não confirmada e pendência resolvida |

Os aliases reais `atendimento_humano`, `pagamento_sinal` e `appointment_payment_confirmed` estão incluídos, além dos eventos de controle usados pela interface. Não são fabricados estados de conexão do WhatsApp/Evolution: o frontend não possui uma fonte verificada desse estado nesta implementação.

## Som

Toque curto de duas notas gerado com Web Audio, sem dependência externa nem permissão de notificações do sistema. O navegador precisa liberar áudio por interação do usuário. O botão permite silenciar/reativar; reativar demonstra o som. Eventos repetidos preservam leitura, não geram novo toque e as rajadas são limitadas a um toque a cada três segundos, incluindo abas do mesmo navegador quando o armazenamento está disponível. O histórico inicial de incidentes não toca; somente novas ocorrências/revisões. Som sem suporte no navegador não impede avisos visuais.

## Isolamento e limites

- O emissor reutiliza o fluxo Realtime existente; não abre uma segunda assinatura por central. O consumidor confere usuário, tenant e os identificadores do registro. A troca de usuário/tenant remonta a central.
- Os avisos novos de atividade são limitados a 120 e persistidos em localStorage. Eles são capturados enquanto a aplicação está aberta e dependem da recepção dos eventos Realtime. Não constituem uma caixa de entrada durável entre dispositivos e não recuperam eventos ocorridos com a aplicação fechada. Leitura desses avisos sincroniza entre abas do mesmo navegador.
- As pendências técnicas anteriores continuam com persistência, paginação e leitura pelo backend existente, sem alterar seus contratos.
- Lembretes usam os compromissos e cards carregados e são reavaliados a cada minuto; não há agendador em segundo plano quando a aplicação está fechada.
- Não foram aplicadas migrações, alteradas publicações Realtime nem enviados WhatsApps. Não houve publicação de frontend ou workflows.

## Evidências

44 testes específicos passaram: matriz de eventos, filtros de tenant, chaves por usuário, deduplicação, preservação de leitura, limite de retenção, lembretes, normalização de telefone/LID, mensagens humanizadas e envelope de áudio. Build do frontend e diff --check aprovados. Suíte completa: 645 testes, 635 aprovados, 10 falhas em testes de arquitetura, localização e estrutura de componentes; nenhum teste foi alterado para escondê-las.

A central foi aberta na aplicação local autenticada. Foram conferidos os controles Todas/Atenção, silenciar/reativar som e o recebimento de novos avisos. Nenhum aviso real foi marcado como lido para testar a implementação.

## Rollback

Reverter apenas os trechos desta alteração em App.jsx, AppTopbar.jsx, NotificationCenter.jsx, notificationService.js e notifications.css; remover operatorEvents.js, useOperatorNotifications.js, useNotificationSound.js e operatorNotifications.test.js. Preservar os ajustes paralelos de conversas, mídia, áudio, Kanban e landing.
