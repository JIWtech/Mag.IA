# Plano do produto generalista - Plataforma de automacao e IA

Atualizado em: 2026-07-25

## Mudanca de escopo

O projeto deixa de ser uma solucao nichada para lojas de veiculos e passa a ser uma plataforma generalista de automacao, atendimento, CRM operacional e IA para multiplos nichos.

Tudo que foi construido ate aqui continua valido:

- n8n como motor de automacao;
- Evolution/WhatsApp como primeiro canal;
- Supabase/Postgres como base operacional;
- Redis como apoio;
- workflows de atendimento, handoff, agenda e painel;
- estrategia multi-tenant;
- custo e arquitetura em nuvem;
- possibilidade de usar Gemini/OpenAI/outros modelos por tenant.

A mudanca principal e de produto:

- antes: "assistente IA para concessionarias";
- agora: "plataforma omnichannel de automacao e IA para qualquer negocio".

## Referencia estudada: OpenBox PRO

Manuais analisados:

- `MANUAL DO ADMINISTRADOR OPENBOX PRO.pdf`
- `MANUAL DE USUARIO OPENBOX PROFESSIONAL.pdf`
- `MANUAL DE USUARIO OPENBOX PRO MOBILE.pdf`

Pontos relevantes extraidos da referencia:

- Dashboard com indicadores operacionais.
- Visualizacao de conversas abertas, tarefas abertas, oportunidades abertas e proximos eventos.
- Menu lateral com painel, empresas, contatos, oportunidades, smart flows, disparos, agendamento, chat ao vivo e configuracoes.
- Chat ao vivo com filtros, pastas, conversas minhas, nao lidas e movimentacao entre pastas.
- Perfil do agente com idioma, notificacoes e tema.
- Gestao de agentes, equipes, funcoes e permissoes.
- Pipeline/funil com oportunidades e agentes responsaveis.
- Respostas pre-definidas.
- Campos do sistema e campos personalizados.
- Etiquetas/tags.
- Galeria de midia.
- Canais: WhatsApp, Instagram, Messenger, Telegram, SMS, Voz e WebChat.
- IA com assistentes de chat, assistentes de voz, base de conhecimento, temas, itens, topicos e produtos.
- Integracoes e API.

Conclusao:

O OpenBox deve ser usado como referencia de experiencia e escopo funcional, mas o nosso produto deve nascer mais enxuto no MVP, com foco em automacao + IA + painel operacional.

## Posicionamento do produto

Proposta:

```text
Uma plataforma de atendimento e automacao com IA, multi-canal e multi-nicho, onde empresas configuram conversas, funis, automacoes, prompts e canais de contato sem depender de uma implementacao nova por cliente.
```

Nomes conceituais possiveis:

- plataforma de atendimento inteligente;
- CRM conversacional com IA;
- automacao omnichannel para negocios;
- central de conversas, funis e IA.

O produto deve atender:

- clinicas;
- imobiliarias;
- escolas/cursos;
- restaurantes;
- e-commerces;
- prestadores de servico;
- escritorios;
- lojas fisicas;
- concessionarias e lojas automotivas;
- negocios locais em geral.

## Menus da interface do usuario final

### 1. Dashboard geral

Objetivo:

- mostrar a saude operacional do atendimento e das automacoes.

Indicadores iniciais:

- conversas totais;
- conversas em andamento;
- conversas com IA;
- conversas em atendimento humano;
- conversas aguardando resposta;
- leads/oportunidades criadas;
- agendamentos criados;
- vendas/conversoes;
- tempo medio de primeira resposta;
- tempo medio de resolucao;
- volume por canal;
- volume por agente;
- custo estimado de IA por periodo.

Filtros:

- hoje;
- ontem;
- ultimos 7 dias;
- mes atual;
- canal;
- agente;
- status;
- funil.

### 2. Conversas

Objetivo:

- permitir que o cliente acompanhe e assuma atendimentos.

Deve conter:

- lista de conversas;
- filtros por canal, status, agente, nao lidas, IA ativa, atendimento humano;
- visualizacao da conversa;
- envio manual de mensagem;
- botao para pausar IA;
- botao para retomar IA;
- transferir para agente/equipe;
- adicionar nota interna;
- adicionar etiqueta;
- atualizar etapa do kanban/funil;
- historico de eventos da automacao;
- origem do contato;
- dados do lead/contato.

Estados principais:

- `ia_ativa`;
- `aguardando_cliente`;
- `atendimento_humano`;
- `finalizada`;
- `erro`;
- `bloqueada`;
- `spam_fora_contexto`.

### 3. Kanban

Objetivo:

- representar categorias operacionais personalizaveis por negocio.

Exemplos por nicho:

```text
Clinica:
Novo contato -> Triagem -> Consulta agendada -> Compareceu -> Retorno -> Fechado

Imobiliaria:
Novo lead -> Interesse identificado -> Visita marcada -> Proposta -> Contrato

Automotivo:
Novo lead -> Veiculo escolhido -> Simulacao -> Visita agendada -> Negociacao -> Venda

Escola/curso:
Novo lead -> Curso de interesse -> Aula experimental -> Proposta -> Matricula
```

Requisitos:

- colunas personalizaveis por tenant;
- cards arrastaveis;
- contagem por coluna;
- filtros por canal, agente, etiqueta e data;
- automacoes podem mover cards;
- agentes podem mover cards manualmente;
- historico de mudanca de etapa.

### 4. Funil

Objetivo:

- exibir oportunidades de forma comercial classica.

Diferença entre Kanban e Funil:

- Kanban: visualizacao operacional flexivel;
- Funil: visao comercial de conversao, valor e previsao.

Campos iniciais:

- nome da oportunidade;
- contato;
- etapa;
- valor estimado;
- probabilidade;
- responsavel;
- origem;
- data prevista;
- status;
- observacoes.

### 5. Automacoes

Objetivo:

- permitir que o cliente crie regras simples para movimentar conversas, atualizar funil e acionar eventos.

MVP recomendado:

- automacoes baseadas em palavras-chave;
- automacoes baseadas em intencao detectada pela IA;
- automacoes baseadas em status de conversa;
- automacoes baseadas em canal;
- automacoes baseadas em horario.

Exemplos:

```text
Se a mensagem contiver "agendar consulta":
-> mover para "Consulta solicitada"
-> notificar equipe de recepcao

Se a IA detectar "venda confirmada":
-> mover para "Venda"
-> criar oportunidade fechada
-> notificar gestor

Se o usuario pedir humano:
-> pausar IA
-> mover para "Atendimento humano"
-> atribuir a uma equipe

Se mensagem fora do horario:
-> responder mensagem de ausencia
-> manter conversa em "Aguardando atendimento"
```

Campos de uma automacao:

- nome;
- ativa/inativa;
- gatilho;
- condicoes;
- acoes;
- prioridade;
- tenant_id;
- canal;
- funil/kanban alvo;
- logs de execucao.

### 6. IA

Objetivo:

- configurar o comportamento da IA por cliente, sem editar manualmente workflow para cada alteracao simples.

Importante:

No MVP, podemos atualizar nodes especificos do n8n por cliente se isso acelerar. Mas o produto correto deve salvar prompt e configuracoes em banco, e o workflow deve carregar dinamicamente pelo `tenant_id`.

Configuracoes iniciais:

- nome da IA;
- objetivo da IA;
- prompt principal;
- tom de voz;
- regras do negocio;
- perguntas obrigatorias;
- criterios de handoff;
- mensagens de fallback;
- modelo;
- temperatura;
- limite de tokens;
- ferramentas permitidas;
- canais permitidos;
- horario de funcionamento;
- base de conhecimento;
- versao ativa do prompt.

Recursos futuros:

- testes A/B de prompt;
- simulador de conversa;
- historico de versoes;
- aprovacao antes de publicar;
- metricas por versao;
- base de conhecimento por arquivos, links e textos;
- itens estruturados por nicho.

## Canais de contato

### MVP

Prioridade:

1. WhatsApp via Evolution API.
2. Telegram via BotFather/API oficial.

Racional:

- WhatsApp e o canal mais importante comercialmente no Brasil.
- Telegram e simples para desenvolvimento e testes.
- Telegram permite validar arquitetura multi-canal sem depender de QR code, Baileys ou custo de Meta.

### Proximos canais

- Instagram DM;
- WebChat;
- Messenger;
- email;
- SMS;
- voz.

## Arquitetura recomendada apos mudanca de escopo

### Principio

O produto nao deve ser organizado por nicho no codigo. O nicho deve ser configuracao.

Exemplo:

```text
tenant.industry = "clinica"
tenant.prompt = prompt da clinica
tenant.kanban = etapas da clinica
tenant.automations = regras da clinica
tenant.channels = whatsapp + telegram
```

O mesmo motor atende todos.

### Componentes

```text
Canais
WhatsApp / Telegram / Instagram / WebChat

Gateway de entrada
Recebe eventos, identifica canal e tenant

n8n
Executa automacoes, orquestra IA, handoff, agenda, notificacoes

Supabase/Postgres
Tenants, usuarios, conversas, mensagens, funis, automacoes, prompts, canais

Dashboard web
Interface do cliente final

IA
Gemini/OpenAI/outros modelos, configurados por tenant
```

### Estrategia n8n

Curto prazo:

- manter workflows atuais;
- criar fluxo Telegram de teste;
- criar workflow principal mais generico;
- usar Supabase para configuracoes basicas por tenant.

Produto real:

- um workflow principal multi-tenant por tipo de evento;
- workflows auxiliares reutilizaveis;
- nada de copiar workflow inteiro por cliente como regra;
- prompt e regras no banco;
- n8n recebe `tenant_id` e executa conforme configuracao.

## Schema generalista sugerido

Tabelas principais:

```sql
tenants
tenant_settings
users
teams
team_members
roles
permissions
channels
channel_accounts
contacts
companies
conversations
messages
conversation_events
tags
contact_tags
kanban_boards
kanban_columns
kanban_cards
funnels
funnel_stages
opportunities
automation_rules
automation_executions
ai_agents
ai_prompt_versions
knowledge_bases
knowledge_items
handoffs
appointments
media_files
api_keys
audit_logs
```

Campos obrigatorios em quase todas as tabelas:

```sql
id uuid
tenant_id uuid
created_at timestamptz
updated_at timestamptz
deleted_at timestamptz null
```

O `tenant_id` e indispensavel.

## Plano de execucao recomendado

### Etapa 1 - Formalizar produto generalista

Status:

- em andamento.

Tarefas:

- documentar mudanca de escopo;
- mapear referencia OpenBox;
- definir menus do MVP;
- decidir nome/reposicionamento;
- separar conceitos automotivos de conceitos da plataforma.

### Etapa 2 - Criar base multi-tenant generalista

Tarefas:

- criar schema inicial generalista;
- criar tenant Avvento como primeiro tenant;
- criar tenant de teste generico;
- migrar conceitos de `leads_teste` para `contacts`, `conversations`, `messages` e `opportunities`;
- manter tabelas antigas se necessario durante transicao.

### Etapa 3 - Criar canal Telegram

Tarefas:

- criar bot no BotFather;
- salvar token no n8n;
- criar workflow de webhook Telegram;
- normalizar payload para o mesmo formato usado pelo WhatsApp;
- identificar tenant por bot/token;
- salvar conversa e mensagem;
- responder via IA mock ou IA real.

### Etapa 4 - Criar dashboard web MVP

Menus do MVP:

- Dashboard;
- Conversas;
- Kanban;
- Funil;
- Automacoes;
- IA;
- Configuracoes.

Tecnologia sugerida:

- Next.js ou React/Vite;
- Supabase Auth;
- Supabase/Postgres;
- API propria quando necessario;
- UI responsiva desktop-first, com mobile depois.

### Etapa 5 - Adaptar workflows n8n

Tarefas:

- criar payload canonico de mensagem;
- criar lookup de tenant;
- carregar configuracoes do tenant;
- carregar prompt ativo;
- carregar automacoes ativas;
- gravar conversa/mensagem/eventos;
- executar IA;
- aplicar automacoes;
- responder no canal correto.

### Etapa 6 - Preparar produto comercial

Tarefas:

- logs por tenant;
- limites por plano;
- custo de IA por tenant;
- controle de usuarios e permissoes;
- onboarding de cliente;
- backup;
- monitoramento;
- politicas de seguranca;
- termos e LGPD;
- billing.

## Decisoes importantes

1. A plataforma sera multi-nicho.
2. O nicho sera configuracao, nao codigo especifico.
3. O fluxo automotivo atual vira primeiro caso de uso, nao produto inteiro.
4. A interface final sera igual para todos os clientes.
5. Cada cliente tera configuracoes proprias de canais, prompt, kanban, funil e automacoes.
6. Telegram entra como segundo canal para facilitar desenvolvimento multi-canal.
7. No futuro, Instagram DM e WhatsApp Cloud API oficial devem ser avaliados.
8. O OpenBox e referencia funcional, nao copia literal.

## Proximo passo tecnico sugerido

Criar o schema generalista MVP no Supabase e um fluxo Telegram simples.

Ordem recomendada:

1. Desenhar `tenant`, `channels`, `contacts`, `conversations`, `messages`.
2. Criar tenant `avvento` e tenant `teste`.
3. Criar bot Telegram pelo BotFather.
4. Criar workflow n8n para receber mensagem Telegram.
5. Normalizar payload Telegram e WhatsApp para o mesmo formato interno.
6. Persistir conversa/mensagem.
7. Responder com MOCK ou Gemini quando houver credito.
8. Depois iniciar o dashboard web.
