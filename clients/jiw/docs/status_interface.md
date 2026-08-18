# Status da interface JIW - Mag.ia

Atualizado em: 2026-07-28

## Cliente

```text
Cliente: JIW - Solucoes tecnologicas
Tenant: jiw
Canal ativo: Telegram
Bot: @jiwtech_bot
Modo atual: atendimento por regras MOCK no n8n
IA paga: desativada
Persistencia Supabase: pendente
Hospedagem: ainda nao sera feita
```

## O que esta funcional hoje

- Bot Telegram real criado e conectado ao n8n.
- Webhook Telegram configurado para o workflow `telegram-jiw`.
- Workflow n8n ativo:
  - `Mag.ia/JIW - Telegram Atendimento MOCK`
  - ID: `jiwTelegramMock01`
- O bot responde no Telegram sem usar Gemini/OpenAI.
- O workflow classifica mensagens por regras:
  - software, sistema, site, app, automacao;
  - suporte de TI;
  - trafego pago;
  - social media;
  - pedido de orcamento;
  - pedido de humano;
  - fora de contexto.
- Interface Mag.ia ajustada para a JIW:
  - Dashboard;
  - Conversas;
  - Kanban;
  - Funil;
  - Automacoes;
  - IA em modo mock;
  - Configuracoes de canais.

## O que a interface mostra agora

A interface representa o estado atual real do cliente:

- Telegram conectado.
- n8n webhook ativo.
- Respostas por regras MOCK.
- IA paga desativada.
- WhatsApp/Instagram/WebChat como canais futuros.
- Supabase ainda pendente para salvar conversas reais.

## O que ainda nao e real na interface

Por enquanto, os dados exibidos na interface sao mockados:

- lista de conversas;
- cards do kanban;
- funil;
- contagem de mensagens;
- historico de eventos;
- oportunidades comerciais.

Isso e intencional neste estagio, porque ainda nao ligamos o workflow ao Supabase generalista.

## Proxima etapa tecnica

Para a interface ficar alimentada por dados reais:

1. Executar `supabase-generalista-schema.sql`.
2. Executar `supabase-jiw-seed.sql`.
3. Alterar o workflow `jiwTelegramMock01` para gravar:
   - contato;
   - conversa;
   - mensagem recebida;
   - mensagem enviada;
   - evento de classificacao;
   - etapa kanban/funil.
4. Alterar a interface para buscar dados do Supabase.
5. Manter IA paga desligada ate aprovacao de custo.

## Observacao importante

O tunel publico usado para testar localmente e temporario. Se o PC reiniciar ou o processo cair, sera necessario gerar nova URL publica e atualizar o webhook do Telegram.
