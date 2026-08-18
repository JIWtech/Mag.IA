# Plano de evolucao WhatsApp (MVP)

**Data de inicio:** 2026-08-18  
**Branch de trabalho:** `dev-whatsapp`  
**Status:** workflow visual implementado; configuracao das credenciais e da instancia pendente

## Objetivo

Adicionar WhatsApp ao Mag.IA por meio da Evolution API hospedada no EasyPanel,
mantendo o Telegram funcionando e usando o mesmo modelo multi-tenant, inbox de
conversas, n8n e Supabase.

## Contexto atual

- O projeto esta sendo desenvolvido na branch `dev-whatsapp`, baseada no ultimo
  `origin/dev`.
- Telegram continua sendo o canal de referencia do MVP.
- A infraestrutura de testes utiliza uma VPS com EasyPanel e servicos n8n,
  Evolution API e Redis.
- O painel de IA foi removido da interface; a automacao deve ser tratada como
  fluxo de canal/n8n, sem reintroduzir esse painel.
- Nenhuma credencial, token, QR code ou chave privada deve ser versionada.

## Workflow entregue

Arquivo para importar no n8n:

```text
n8n/workflows/magia_whatsapp_evolution_mvp.json
```

O fluxo foi reorganizado para ficar legivel no canvas do n8n e contem somente
os blocos necessarios para o MVP:

- webhook `POST /webhook/magia-whatsapp` para receber a Evolution API;
- normalizacao, filtro de grupos/status e deduplicacao no `channel_events`;
- ramo visual de audio com conversao para arquivo e transcricao OpenAI;
- contexto da JIW sem estoque de veiculos, vector store ou dados da Avvento;
- agente `Assistente JIW (Gemini)` conectado ao no `Gemini Chat Model`;
- registro dos eventos de entrada e saida no `channel_events`;
- envio pelo no visual `Enviar Resposta pela Evolution`;
- resposta JSON ao webhook para a Evolution API.

O Gemini e o transcritor ficam visiveis e configuraveis no proprio n8n. O
workflow vem desativado para permitir configurar as credenciais antes do
primeiro teste.

O `magia_command_router.json` tambem aceita `channel_type: "whatsapp"`, permitindo
respostas manuais pela aba Conversas.

Variaveis usadas pelo fluxo no n8n/EasyPanel:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
EVOLUTION_INSTANCE_JIW=nome-da-instancia
WHATSAPP_TENANT_SLUG=jiw
```

As chaves de API nao devem ser inseridas no JSON. Depois de importar o
workflow, abra os nos e selecione/crie as credenciais no n8n:

1. `Gemini Chat Model`: credencial Google Gemini com a chave do Google AI
   Studio.
2. `Transcrever Audio (OpenAI)`: credencial OpenAI com acesso ao endpoint de
   transcricao.
3. `Buscar Mensagem Duplicada`, `Salvar Evento Recebido` e `Salvar Evento
   Enviado`: credencial Supabase apontando para o projeto e para a tabela
   `channel_events`.
4. `Enviar Resposta pela Evolution`: credencial da Evolution API instalada no
   n8n. O nome da instancia pode vir de `EVOLUTION_INSTANCE_JIW`.

Se a instalacao do n8n nao tiver o no `n8n-nodes-evolution-api`, substitua o
no de envio por um `HTTP Request` para
`/message/sendText/{EVOLUTION_INSTANCE_JIW}`, usando a chave da Evolution como
credencial/header dentro do n8n.

Depois de importar e configurar as credenciais, configure o webhook da
instancia Evolution no EasyPanel para a URL
`https://SEU-N8N/webhook/magia-whatsapp` e ative o workflow somente depois de
validar o HTTPS. A webhook fica na Evolution; nao e necessario colocar URL de
webhook no frontend.

## Escopo do MVP

1. **Conexao da instancia**
   - Configurar uma instancia WhatsApp na Evolution API.
   - Confirmar URL HTTPS, chave da API e nome da instancia via variaveis de
     ambiente/EasyPanel.
   - Exibir no sistema o estado `disconnected`, `connecting` ou `connected`.

2. **Recebimento de mensagens**
   - Criar webhook para mensagens recebidas, atualizacoes de entrega e eventos
     de conexao.
   - Resolver o tenant pela instancia/canal, nunca por um slug enviado pelo
     navegador.
   - Persistir eventos com identificador do provedor para garantir idempotencia.

3. **Envio de mensagens**
   - Permitir resposta manual pela tela de Conversas.
   - Encaminhar o envio para a Evolution API por um fluxo n8n/backend central.
   - Registrar sucesso, erro, tentativa e timestamp da mensagem.

4. **Integracao com o fluxo existente**
   - Reaproveitar o roteador de comandos e o catalogo de servicos quando fizer
     sentido.
   - Manter Telegram isolado e funcional durante toda a implementacao.
   - Tratar falhas de provedor com timeout, retry limitado e registro de erro.

5. **Interface**
   - Adicionar WhatsApp a Integracoes com estado e ultima sincronizacao.
   - Identificar o canal em cada conversa e permitir filtro por canal.
   - Mostrar erros operacionais acionaveis, sem expor tokens ou payloads
     sensiveis.

## Sequencia de implementacao

### Fase 1 — Descoberta e ambiente

- [x] Remover dependencias especificas da Avvento do fluxo principal.
- [x] Criar workflow base `magia_whatsapp_evolution_mvp.json`.
- [ ] Confirmar versao da Evolution API e nome da instancia.
- [ ] Confirmar dominio HTTPS publico e rota de webhook.
- [ ] Definir onde ficam n8n, Evolution API, Redis e banco em producao.
- [ ] Cadastrar segredos somente no EasyPanel/Supabase Edge Functions/n8n.

### Fase 2 — Contrato de dados e seguranca

- [ ] Mapear canal WhatsApp para `tenant_id` e `channel_account_id`.
- [ ] Revisar tabelas de mensagens/eventos e constraints de idempotencia.
- [ ] Aplicar RLS baseada em `auth.uid()` em todas as leituras e escritas do
      tenant.
- [ ] Validar assinatura/segredo do webhook e limitar origem quando possivel.

### Fase 3 — Webhook e n8n

- [x] Implementar fluxo de entrada WhatsApp -> normalizacao -> Supabase.
- [x] Implementar fluxo de saida manual Supabase/n8n -> Evolution API.
- [ ] Adicionar logs, retries e caminho de erro sem duplicar mensagens.

### Fase 4 — Frontend e aceite

- [ ] Exibir conexao, conversas, mensagens e envio manual.
- [ ] Testar mensagens de texto, resposta, reconexao e duplicidade.
- [ ] Testar isolamento entre dois tenants.
- [ ] Documentar procedimento de operacao e rollback.

## Criterios de aceite

- Uma mensagem recebida no WhatsApp aparece uma unica vez no tenant correto.
- Um operador consegue responder pela tela de Conversas e recebe confirmacao
  de envio ou erro legivel.
- Telegram continua recebendo e enviando mensagens sem regressao.
- Um usuario nao consegue consultar ou alterar conversas de outro tenant.
- Tokens e dados sensiveis nao aparecem no Git, frontend, logs publicos ou URL.
- Uma queda temporaria da Evolution API nao derruba a interface nem cria loop
  infinito de tentativas.

## Fora do escopo inicial

- Campanhas em massa e rotinas de marketing.
- Suporte completo a todos os tipos de midia e grupos.
- Multi-instancia avancada por tenant.
- Reintroducao do painel de IA.
- Troca do provedor de banco ou migracao do n8n.

## Decisoes pendentes

- Qual dominio sera usado no webhook em producao?
- A instancia sera uma por tenant ou uma instancia compartilhada no MVP?
- O envio sera sempre manual ou tambem acionado por workflows existentes?
- Quais tipos de midia sao obrigatorios para o primeiro piloto?
- Qual politica de retencao e auditoria sera aplicada aos eventos WhatsApp?
