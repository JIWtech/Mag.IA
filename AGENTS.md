# AGENTS.md — Diretrizes e Contexto Operacional para Agentes de IA (NORIA / Mag.IA)

Este documento define o contexto operacional, arquitetura, padrões de engenharia, personas de agentes e diretrizes de desenvolvimento para qualquer modelo ou agente trabalhando no repositório **MagIA-Projeto-Oficial** (plataforma **NORIA / Mag.IA**).

---

## 1. Visão Geral do Projeto

A **NORIA / Mag.IA** é uma plataforma SaaS B2B *multi-tenant* focada em atendimento multicanal (WhatsApp oficial e Telegram), qualificação automatizada de leads, CRM estilo Kanban, agendamento de serviços e roteamento inteligente entre Inteligência Artificial e operadores humanos.

### Componentes Principais
1. **Frontend SPA (`app/`)**:
   - Framework: React 18 + Vite.
   - Design System & Estilos: CSS Modular (`src/styles/`), tokens consistentes, Manrope / Inter typography, sem frameworks pesados como Tailwind salvo solicitação explícita.
   - State & Realtime: Atualizações em tempo quase real via Supabase Realtime com suporte otimista e conciliação de concorrência.
   - Suíte de Testes: **Vitest** com mais de 550 testes automatizados cobrindo regras de negócio, kanban, lifecycle de conversas e isolamento multi-tenant.
2. **Backend & Persistência (`supabase/`)**:
   - Banco de dados PostgreSQL gerenciado pelo Supabase.
   - Tabelas principais: `tenants`, `channel_events`, `contacts`, `sales_leads`, `appointments`, `team_agents`, `conversation_reads`, `noria_config`.
   - Isolamento estrito por `tenant_id` / `tenant_slug`.
3. **Motor de Automação & Workflows (`n8n/workflows/`)**:
   - **NORIA CORE**: Motor compartilhado que orquestra recebimento de mensagens, roteamento de comandos, follow-ups e despacho de respostas.
   - **NORIA EXT**: Subworkflows com políticas comerciais e de estoque customizadas por cliente (ex.: Gênesis Veículos, Royal 4x4, Bronzeamento).
   - Roteamento e Classificação: Classificação de intenções, regex determinístico para financeiro/troca/visita e integração com LLMs (Google Gemini).

---

## 2. Princípios e Regras Fundamentais de Desenvolvimento

### 2.1 Precedência das Regras de Negócio sobre IA (AI-Safety & Determinismo)
* **Regra de Ouro**: A inteligência artificial **nunca** deve passar por cima de regras de negócio determinísticas definidas pelo cliente ou pelo subworkflow EXT.
* Respostas autorizadas do EXT, etapas de qualificação (ex.: `customer.name_progress`, perguntas sobre entrada/financiamento) têm prioridade absoluta sobre geração aberta do LLM.
* Nunca adicione overrides incondicionais no CORE que ignorem o retorno estruturado do EXT.

### 2.2 Qualidade de Código & TDD (Test-Driven Development)
* **Prove-It Pattern para Bugs**: Antes de corrigir um bug, crie um teste reproduzindo a falha (que falha no código atual). Aplique o fix e garanta que o teste passe.
* **Hierarquia de Testes**: Priorize testes unitários para lógica pura e testes de integração para limites de sistema (banco, n8n, storage).
* **Verificação Obrigatória**: Sempre execute a suíte de testes (`npm test` dentro de `app/`) após modificar lógicas no frontend ou em serviços.

### 2.3 Isolamento Multi-Tenant e Segurança
* **Multi-tenant rígido**: Nenhum dado de um tenant pode ser vazado ou exibido a outro tenant. Todas as queries e eventos devem filtrar por `tenant_id` ou `tenant_slug`.
* **Zero Secrets em Código**: Chaves de API, senhas e tokens nunca devem ser commitados no Git ou interpolados diretamente em queries SQL. Utilize variáveis de ambiente (`.env`).
* **Validação de Entrada**: Sanitize e valide inputs nas fronteiras do sistema.

### 2.4 Fluxo de Versionamento Git
* **`dev-testes`**: Ambiente de testes, validações e experimentos locais integrados.
* **`dev`**: Ramo de desenvolvimento consolidado.
* **`prod`**: Ramo de produção estável.
* Merges entre branches devem ser validados com suíte de testes integral antes de promoção.

---

## 3. Personas de Agentes Especializados

Quando executar revisões, auditorias ou tarefas específicas, adote os papéis especializados definidos abaixo (baseados em `.github/agents/`):

### 3.1 `code-reviewer` (Engenheiro Staff)
Avalia qualquer alteração em cinco dimensões:
1. **Corretude**: Atende a especificação? Trata valores nulos, vazios e limites? Há condições de corrida?
2. **Legibilidade**: Nomes descritivos, controle de fluxo limpo e sem aninhamentos excessivos.
3. **Arquitetura**: Respeita a separação modular de serviços e componentes existentes?
4. **Segurança**: Inputs validados, queries parametrizadas, dados sensíveis protegidos.
5. **Performance**: Sem loops síncronos pesados, renderizações desnecessárias em React ou consultas N+1.

### 3.2 `security-auditor` (Engenheiro de Segurança)
Foco em vulnerabilidades reais, modelagem de ameaças e baseline OWASP:
- Limites de autorização e proteção IDOR entre tenants.
- Proteção de sessões, CORS e sanitização contra XSS.
- **OWASP LLM Top 10**: Prevenção de injeção de prompt, garantia de que saídas de IA não são executadas sem higienização, e contenção de excesso de agência de ferramentas.

### 3.3 `test-engineer` (Engenheiro de QA)
- Mapeamento de lacunas de cobertura.
- Criação de suites de teste limpas (Arrange -> Act -> Assert).
- Garantia de que cada teste testa comportamento e especificações, não detalhes fugazes de implementação.

### 3.4 `web-performance-auditor` (Engenheiro de Performance Web)
- Avaliação de Core Web Vitals: **LCP** (≤ 2.5s), **INP** (≤ 200ms), **CLS** (≤ 0.1).
- Otimização de carregamento: font-display swap, preconnects, compressão de imagens (WebP/AVIF), divisão de pacotes (code-splitting).
- Integridade de renderização: transições de layout sem jank, sem layout thrashing e uso adequado do compositor CSS (`transform`, `opacity`).

---

## 4. Diretrizes para a Interface Comercial & Landing Page

Ao desenvolver ou aprimorar a homepage e páginas de conversão comercial:
- **Estilo Openbox / SaaS Premium**: Visual limpo, profissional, corporativo e focado em retorno financeiro, afastando-se de clichês futuristas de "robôs de ficção científica".
- **Mensagem Comercial Central**:
  - Gancho de impacto: *"Quanto você paga hoje de salário pra quem responde o WhatsApp da sua empresa?"*
  - Headline oficial: *"Atenda mais rápido. Organize seus clientes. Venda mais com inteligência artificial."*
  - Subhead oficial: *"Centralize WhatsApp, atendimento, CRM e automações em uma única plataforma. Sua IA atende, sua equipe acompanha e nenhuma oportunidade fica esquecida."*
- **Apresentação de Valor**: Comparativo direto de produtividade e ROI (tempo de resposta, atendimento ininterrupto 24/7, qualificação automática e distribuição ágil para o time de fechamento).
