# Status e passo a passo operacional - Avvento N8N

Atualizado em: 2026-07-25

Este documento serve como ponto de acompanhamento do projeto para evitar reexplicar o plano completo a cada etapa.

## Status atual

### Mudanca de escopo em 2026-07-25

- [x] Decidido que o produto deixa de ser nichado para veiculos e passa a ser uma plataforma generalista de automacao, atendimento, CRM operacional e IA.
- [x] Mantido todo o trabalho atual como base tecnica e primeiro caso de uso.
- [x] Manuais OpenBox PRO localizados e estudados como referencia funcional.
- [x] Criado documento atualizado da nova direcao:
  - `PLANO_PRODUTO_GENERALISTA_AUTOMACAO_IA.md`
- [x] Plano antigo de escala automotiva mantido como historico e caso de uso:
  - `PLANO_ESCALA_PRODUTO_FYC_MOTORS_AI.md`

### Primeiro cliente real: JIW - Solucoes tecnologicas

- [x] Definido primeiro tenant real:
  - `JIW - Solucoes tecnologicas`
  - slug: `jiw`
  - canal inicial: Telegram
- [x] Criado seed Supabase do cliente:
  - `supabase-jiw-seed.sql`
- [x] Criado guia de BotFather, webhook e testes:
  - `GUIA_JIW_TELEGRAM_BOTFATHER_N8N.md`
- [x] Criado workflow n8n Telegram MOCK:
  - `workflow-jiw-telegram-mock.json`
  - nome n8n: `Mag.ia/JIW - Telegram Atendimento MOCK`
  - ID: `jiwTelegramMock01`
  - webhook: `telegram-jiw`
- [x] Workflow importado, publicado e ativado no n8n.
- [x] Webhook local validado:
  - `http://localhost:5678/webhook/telegram-jiw`
- [x] Interface Mag.ia atualizada para incluir JIW como tenant principal.
- [x] Interface Mag.ia alinhada ao status real da JIW:
  - Telegram ativo
  - atendimento por regras MOCK
  - IA paga desativada
  - Supabase pendente
  - canais futuros marcados como planejados/nao contratados
- [x] Criado documento de status da interface JIW:
  - `STATUS_INTERFACE_JIW.md`
- [x] Criar bot real no BotFather:
  - username: `@jiwtech_bot`
- [x] Configurar URL publica temporaria para teste Telegram local:
  - `https://five-parts-appear.loca.lt/webhook/telegram-jiw`
- [x] Executar `setWebhook` no Telegram com a URL publica.
- [ ] Testar envio real de mensagem pelo Telegram.
- [ ] Persistir contatos/conversas/mensagens JIW no Supabase.

### Proxima etapa recomendada

- [x] Criar interface prototipo da plataforma generalista:
  - `produto-interface/`
  - URL local: `http://localhost:5174`
- [x] Criar schema Supabase generalista multi-tenant:
  - `supabase-generalista-schema.sql`
- [ ] Criar tenant `avvento` como primeiro cliente/caso de uso.
- [ ] Criar tenant `teste` para validacao multi-nicho.
- [ ] Criar canal Telegram via BotFather.
- [ ] Criar workflow n8n de entrada Telegram.
- [ ] Normalizar payload WhatsApp e Telegram para o mesmo formato interno.
- [ ] Persistir conversas e mensagens em tabelas generalistas.
- [ ] Depois iniciar dashboard web MVP com menus:
  - Dashboard geral
  - Conversas
  - Kanban
  - Funil
  - Automacoes
  - IA
  - Configuracoes

### Ja realizado

- [x] Ambiente Docker subido.
- [x] n8n acessivel em `http://localhost:5678`.
- [x] Evolution API acessivel em `http://localhost:8080`.
- [x] Postgres, Redis, MCP Server e Vaultwarden rodando.
- [x] Workflows JSON analisados.
- [x] Workflows importados no n8n.
- [x] Workflow principal correto identificado: `Avvento fluxo principal`.
- [x] Workflows antigos/desalinhados identificados para nao ativar agora:
  - `Fluxo Principal`
  - `Atualizar Ferramenta de Estoque`
- [x] Identificado que o painel usa `visitas_agendadas`.
- [x] Identificado que faltam endpoints do painel:
  - `editar-veiculo-dash`
  - `atualizar-status-dash`
- [x] Configuracao avancou ate a etapa de chaves de IA.
- [x] Criada copia DEV do workflow principal:
  - `DEV - Avvento fluxo principal (texto + Gemini)`
  - ID: `devAvventoTexto01`
  - Webhook: `webhook-avvento-dev`
- [x] Removidas dependencias de custo da copia DEV:
  - OpenAI
  - Cohere
  - Supabase Vector Store / embeddings
- [x] Audio e imagem desviados no modo DEV para resposta textual, sem chamar OpenAI.
- [x] Criados workflows faltantes do painel:
  - `DEV/Painel - Editar Veiculo Dashboard`
  - `DEV/Painel - Atualizar Status Dashboard`
- [x] Credenciais existentes no n8n confirmadas:
  - `Redis account`
  - `Supabase account`
  - `Evolution account`
- [x] Credencial Gemini confirmada no n8n:
  - `Google Gemini(PaLM) Api account`
- [x] Credencial Gemini vinculada ao node `Google Gemini Chat Model` da copia DEV.
- [x] Instancia Evolution `teste` criada com channel `Baileys`, QR escaneado e status conectada/open.
- [x] Webhook da Evolution configurado para `http://n8n:5678/webhook/webhook-avvento-dev` com evento `MESSAGES_UPSERT`.
- [x] Workflows da trilha DEV publicados/ativados.
- [x] Script SQL das tabelas Supabase criado:
  - `supabase-avvento-schema.sql`
- [x] Tabelas Supabase criadas/validadas:
  - `leads_teste`
  - `visitas_agendadas`
- [x] Endpoint `avvento-visitas` corrigido para retornar JSON valido mesmo sem registros.
- [x] Primeiro teste WhatsApp chegou ao n8n.
- [x] Webhook Evolution corrigido via API porque a interface salvou `enabled:false` e `events:[]`.
- [x] Modelo Gemini ajustado para modelo valido:
  - `models/gemini-2.0-flash-lite`
- [ ] Resolver quota Gemini: a chave atual lista modelos, mas `generateContent` retorna 429 com limite gratuito `0`.
- [x] Criado e ativado fluxo MOCK sem IA externa:
  - `MOCK - Avvento fluxo principal (sem IA externa)`
  - ID: `mockAvventoFyc01`
- [x] Desativado fluxo DEV com Gemini:
  - `DEV - Avvento fluxo principal (texto + Gemini)`
- [x] MOCK enriquecido com base na proposta FYC Motors AI:
  - saudacao e qualificacao
  - estoque simulado com varias marcas/modelos
  - filtros por marca, modelo, tipo, cambio, combustivel e faixa de preco
  - financiamento
  - troca/avaliacao
  - handoff para vendedor
  - agendamento
  - resposta para audio/imagem em modo DEV
  - fallback fora de contexto pedindo reformulacao
- [x] Respostas do MOCK ajustadas para texto ASCII-safe, evitando acentos quebrados/mojibake no WhatsApp.

### Ainda falta

- [x] Confirmar que o community node `n8n-nodes-evolution-api` foi instalado e carregou sem erro.
- [x] Criar/validar credencial Redis no n8n.
- [x] Criar/validar credencial Supabase no n8n.
- [x] Criar/validar credencial Evolution API no n8n.
- [x] Criar chave Gemini para testes.
- [x] Cadastrar credencial Gemini no node `Google Gemini Chat Model` da copia DEV.
- [x] Decidir como lidar com OpenAI em desenvolvimento sem custo: nao usar OpenAI/GPT nesta trilha.
- [x] Executar/validar tabelas Supabase:
  - `leads_teste`
  - `visitas_agendadas`
- [x] Ajustar/confirmar `instanceName` da Evolution no workflow DEV: `teste`.
- [ ] Ajustar prompt, identidade, endereco e horario da Avvento.
- [ ] Ajustar vendedores e gerente.
- [x] Criar workflows faltantes do painel:
  - `editar-veiculo-dash`
  - `atualizar-status-dash`
- [x] Ativar somente os workflows corretos.
- [x] Configurar webhook da Evolution API para o n8n.
- [ ] Fazer teste ponta a ponta via WhatsApp.
- [ ] Validar painel `avvento.html`.

## Como lidar com IA sem custo na fase de desenvolvimento

### Resumo

Para desenvolvimento sem custo, a recomendacao e:

1. Usar Gemini API pela camada gratuita do Google AI Studio para testes de conversa em texto.
2. Nao usar OpenAI em chamadas reais enquanto nao houver credito/billing aprovado.
3. Evitar testes com audio, embeddings, transcricao e recursos que dependam de OpenAI.
4. Se necessario, criar uma copia DEV do workflow principal sem os nodes OpenAI.

### Por que isso e necessario

O workflow principal usa varios provedores:

- Gemini: modelo principal de conversa/imagem.
- OpenAI: transcricao de audio, embeddings e possivelmente nodes auxiliares.
- Cohere: reranker.
- Supabase Vector Store: busca vetorial, que depende de embeddings.

Na pratica, para testar o atendimento basico sem custo:

- Testar mensagens de texto.
- Testar consulta de estoque.
- Testar detalhes de veiculo.
- Testar handoff humano.
- Testar agendamento.
- Testar painel.

Evitar por enquanto:

- Audio.
- Imagem.
- Busca vetorial/RAG.
- Qualquer branch que execute node OpenAI ou Cohere.

## Gemini API Key para testes

### O que usar

Use o Google AI Studio:

```text
https://aistudio.google.com/
```

Documentacao oficial:

- API keys Gemini: `https://ai.google.dev/gemini-api/docs/api-key`
- Precos Gemini API: `https://ai.google.dev/gemini-api/docs/pricing`
- Rate limits Gemini API: `https://ai.google.dev/gemini-api/docs/rate-limits`

Segundo a documentacao oficial, o uso do Google AI Studio e gratuito nas regioes disponiveis, e a API tem camada gratuita sujeita a limites. Para sair da camada gratuita para uma camada paga, e necessario configurar billing no AI Studio.

### Passo a passo

1. Acesse:

```text
https://aistudio.google.com/
```

2. Entre com uma conta Google.

3. Abra o menu lateral.

4. Va em `API keys`.

5. Clique em `Create API key`.

6. Se aparecer opcao de projeto:
   - Para teste, use um projeto novo ou o projeto padrao criado pelo AI Studio.
   - Evite vincular billing se a intencao for custo zero.

7. Copie a chave gerada.

8. No n8n, crie a credencial Gemini/Google PaLM usada pelo workflow.

9. Teste somente com mensagens pequenas no inicio.

### Cuidados importantes

- Nao publique a chave em GitHub, prints, planilhas ou mensagens.
- Se a chave vazar, revogue e crie outra.
- O Google passou a trabalhar com `auth keys` no AI Studio; novas chaves criadas pelo AI Studio ja seguem esse modelo.
- Chaves standard irrestritas podem ser rejeitadas pela Gemini API.
- Se aparecer erro de quota/limite zero, verifique o painel de rate limits do projeto no AI Studio.

## OpenAI API Key sem gerar custo

### Realidade pratica

Para chamadas reais da OpenAI API, normalmente e necessario ter credito/billing configurado. A documentacao oficial da OpenAI descreve o modelo de billing pre-pago: voce adiciona creditos, usa a API, e as chamadas descontam desses creditos. Se os creditos acabam, as requisicoes passam a retornar erro de quota/billing.

Documentacao oficial:

- Billing pre-pago OpenAI: `https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing`
- API keys/usage no dashboard: `https://platform.openai.com/`

Conclusao: nao conte com OpenAI API gratuita para desenvolvimento, a menos que sua conta tenha creditos promocionais/trial disponiveis no dashboard.

### Como verificar se voce tem credito gratuito

1. Acesse:

```text
https://platform.openai.com/
```

2. Entre na sua conta.

3. Va em `Settings` / `Billing`.

4. Verifique se existe saldo ou creditos promocionais.

5. Se houver credito promocional, voce pode criar uma API key e usar ate acabar o saldo.

6. Se nao houver saldo, chamadas reais da API exigirao compra de creditos.

### Como criar a key, caso haja credito ou voce aceite usar credito minimo

1. Acesse:

```text
https://platform.openai.com/api-keys
```

2. Clique em `Create new secret key`.

3. Nome sugerido:

```text
avvento-dev-n8n
```

4. Copie a chave uma unica vez.

5. No n8n, crie a credencial OpenAI.

6. Configure limite de gasto/alertas no painel de billing antes de testar.

### Como continuar sem OpenAI no desenvolvimento

Opcao recomendada para custo zero:

1. Nao testar audio.
2. Nao testar imagem se o branch depender de OpenAI ou gerar erro de credencial.
3. Nao usar embeddings/vector store.
4. Testar apenas texto com Gemini.
5. Criar uma copia do workflow:

```text
DEV - Avvento fluxo principal
```

6. Nessa copia DEV, desabilitar/remover temporariamente:
   - `Transcribe a recording`
   - `Embeddings OpenAI`
   - `Supabase Vector Store`, se exigir embeddings
   - `Message a model`, se estiver usando OpenAI
   - `Reranker Cohere`, se a busca vetorial nao for usada

7. Manter ativos:
   - Webhook WhatsApp
   - Normalizacao de texto
   - Redis
   - Supabase leads/visitas
   - Gemini Chat Model
   - Ferramentas de estoque
   - Envio WhatsApp via Evolution

### Alternativa de baixo custo controlado

Se for inevitavel testar audio/transcricao/embeddings:

1. Adicione o menor credito possivel permitido pela OpenAI.
2. Desative auto recharge.
3. Configure limite mensal/alertas.
4. Teste com poucos prompts.
5. Evite anexos grandes.
6. Desative novamente depois dos testes.

## Ordem das proximas acoes

### Proxima etapa recomendada agora

1. Criar Gemini API Key.
2. Cadastrar a credencial Gemini no node `Google Gemini Chat Model` do workflow `DEV - Avvento fluxo principal (texto + Gemini)`.
3. Validar as tabelas Supabase.
4. Revisar `instanceName` da Evolution no DEV. Hoje ainda esta como `teste`.
5. Publicar/ativar os workflows DEV.

### Depois disso

1. Configurar webhook Evolution para `webhook-avvento-dev`.
2. Rodar teste ponta a ponta por texto.
3. Validar dashboard.
4. Ajustar prompt, identidade, endereco, vendedores e gerente.

## Workflows DEV criados nesta etapa

### `DEV - Avvento fluxo principal (texto + Gemini)`

ID:

```text
devAvventoTexto01
```

Webhook:

```text
webhook-avvento-dev
```

O que foi alterado em relacao ao workflow principal:

- Removidos nodes OpenAI.
- Removido Cohere.
- Removido Supabase Vector Store/embeddings.
- Removido caminho de transcricao de audio.
- Removido caminho de leitura de imagem.
- `Normalizar Dados` agora transforma audio/imagem em aviso textual de modo DEV.
- Fluxo segue direto de `Restaurar Dados (Anti-Bug)` para `Add to Buffer`.
- Memoria Redis usa chave separada:

```text
chat_avvento_dev:<phone>
```

Ainda falta nele:

- Conectar credencial Gemini no node `Google Gemini Chat Model`.
- Confirmar `instanceName` da Evolution, hoje `teste`.
- Revisar prompt/identidade/endereco.

### `DEV/Painel - Editar Veiculo Dashboard`

ID:

```text
editarVeiculoDash01
```

Webhook:

```text
editar-veiculo-dash
```

Funcao:

- Atualiza campo `veiculo` em `visitas_agendadas`, filtrando por `phone`.

### `DEV/Painel - Atualizar Status Dashboard`

ID:

```text
atualizarStatusDash01
```

Webhook:

```text
atualizar-status-dash
```

Funcao:

- Atualiza campo `status` em `visitas_agendadas`, filtrando por `phone`.

## Como ativar os workflows DEV quando a Gemini estiver configurada

Pela interface do n8n, ative:

- `DEV - Avvento fluxo principal (texto + Gemini)`
- `Ferramenta - Busca Avvento (Estoque Blindado)`
- `Ferramenta - Ler Detalhes do Veículo`
- `Avvento Auto - Relatório + Financiamento`
- `Avvento - Atualizar Vendedor Dashboard`
- `DEV/Painel - Editar Veiculo Dashboard`
- `DEV/Painel - Atualizar Status Dashboard`

Ou pelo terminal:

```powershell
docker exec n8n n8n publish:workflow --id=devAvventoTexto01
docker exec n8n n8n publish:workflow --id=h7bSyiwiI3aJUcwF
docker exec n8n n8n publish:workflow --id=OOrBZhH4GGub97tE
docker exec n8n n8n publish:workflow --id=c7RBrGZqOAyTLztF
docker exec n8n n8n publish:workflow --id=wp9fzn6Fra87yuMX
docker exec n8n n8n publish:workflow --id=editarVeiculoDash01
docker exec n8n n8n publish:workflow --id=atualizarStatusDash01
```

Nao ative ainda:

- `Fluxo Principal`
- `Atualizar Ferramenta de Estoque`
- `Captação de Leads - Apenas Planilhas`

## Checklist rapido para testes sem custo

- [ ] Gemini API key criada no AI Studio.
- [ ] Billing nao ativado no projeto Gemini, se a meta for custo zero.
- [ ] Credencial Gemini cadastrada no n8n.
- [ ] OpenAI nao cadastrada ou nao usada no DEV.
- [ ] Testes restritos a texto.
- [ ] Audio nao testado.
- [ ] Imagem nao testada ate validar custo/dependencias.
- [ ] Busca vetorial/RAG nao testada ate decidir sobre OpenAI/Cohere.
- [ ] Workflow DEV criado se o workflow principal reclamar de credenciais OpenAI.

## Observacoes para a proxima conversa

Quando pedir ajuda em uma etapa especifica, informe apenas:

- Qual etapa deste documento voce esta executando.
- Qual erro apareceu.
- Print ou texto do erro, se houver.
- Nome do workflow/node afetado.

Assim a continuidade fica baseada neste checklist, sem precisar refazer todo o plano.
