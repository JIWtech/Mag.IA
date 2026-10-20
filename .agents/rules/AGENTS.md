# NORIA — DIRETRIZES DE ARQUITETURA CONVERSACIONAL E REGRAS PERMANENTES CONTRA HARDCODING

> **STATUS:** REGRA ARQUITETURAL PERMANENTE MANDATÓRIA (P0)  
> **APLICAÇÃO:** Todos os módulos, workflows, extensões e tenants do NORIA (Gênesis Automóveis, Clínica Núbia, etc.)  
> **ESCOPO:** Todo e qualquer agente de IA, desenvolvedor ou assistente de código atuando no repositório.

---

## Regras Permanentes Obrigatórias (Diretrizes Fundamentais)

### REGRA 1 — PROIBIDO HARDCODE CONVERSACIONAL
Nunca implementar respostas comerciais prontas, decisões de intenção baseadas em regex, whitelists de frases ou atalhos semânticos que substituam a interpretação do Gemini.
Regex continua permitida para parsing técnico, validações estruturais e formatos determinísticos (CPF, placa, datas, montantes monetários), mas **NUNCA** como autoridade da intenção comercial ou substituta de atos de fala.

### REGRA 2 — EXT É A AUTORIDADE COMERCIAL
Toda política específica de um tenant pertence à sua EXT (Extensão de Domínio).
- As políticas comerciais da Gênesis Automóveis pertencem à **EXT Gênesis**, nunca ao CORE.
- As políticas de agendamento e serviços da Clínica Núbia pertencem à **EXT Núbia**, nunca ao CORE.
A EXT é responsável por definir: regras de financiamento, exigência documental (CNH/CPF), aceitação de troca sob avaliação, compra independente, faixas de lead, leilão, vistoria e disponibilidade autorizada.

### REGRA 3 — CORE É GENÉRICO E MULTITENANT
O CORE é o motor compartilhado e **não pode incorporar regras comerciais de um cliente específico**, mesmo que condicionadas ao slug do tenant (`if (tenantSlug === '...')`).
O CORE é responsável por: orquestração, chamada única ao Gemini, contratos estruturados, validação factual neutra, controle de sessões, concorrência, idempotência, fencing, persistência e envio. O CORE somente consome contratos estruturados, validados e vinculados ao tenant (`noria_commercial_policy_v1`, `noria_commercial_decision_v1`).

### REGRA 4 — ORDEM SEMÂNTICA OBRIGATÓRIA
Quando uma operação comercial depende da interpretação do Gemini (ex.: troca de veículo, intenção de compra vs venda, simulação de parcelas), a EXT deve receber a intenção validada (`semantic_intent.valid === true`) **antes da finalização da resposta**.
É terminantemente proibido executar decisões comerciais dependentes de semântica ausente ou chutar estados via regex/heurística para compensar a falta de interpretação semântica prévia.

### REGRA 5 — PRESERVAR O QUE JÁ FUNCIONA
Toda alteração deve preservar catálogo, SKU, quilometragem, `grounded_catalog`, OCR privado de documentos, documentos alternativos, handoff humano seguro, isolamento multi-tenant estrito e idempotência de turnos.
Não refatorar módulos estáveis sem relação com o defeito ou arquitetura em escopo.

---

## 1. Proibição Expressa de Hardcoding Conversacional

**O NORIA UTILIZA MODELOS FUNDACIONAIS (GEMINI) PARA COMPREENDER, INTERPRETAR E DIALOGAR. É EXPRESSAMENTE PROIBIDO CONVERTER O SISTEMA EM UM CHATBOT DE REGEX DISFARÇADO DE INTELIGÊNCIA ARTIFICIAL.**

É categoricamente proibido:
1. **Respostas Comerciais Fixas:** Escrever mensagens conversacionais pré-fabricadas ou frases literais no CORE/EXT para mascarar ou contornar deficiências de interpretação ou prompt do Gemini.
2. **Substituição de Resposta Rejeitada por Frase Pronta:** Ao auditar uma resposta e detectar inadequação factual ou de contrato, é proibido substituir o diálogo rejeitado por outra frase comercial de preenchimento (ex.: *"Temos ótimas opções..."*, *"Anotado o ano do seu veículo! Qual é o modelo e marca dele?"*).
3. **Árvores Decisórias `if/else` Conversacionais:** Criar ramificações procedurais que tentem simular um script de atendimento humano.
4. **Regex como Autoridade Primária de Intenção:** Utilizar expressões regulares para decidir intenção semântica, seleção de produtos ou troca de assunto. Regex deve ser restrita à validação sintática (ex.: formatos de CPF, placa, datas).
5. **Listas de Palavras-Chave para Decisão Comercial:** Usar dicionários de termos para adivinhar se o cliente deseja comprar, vender, trocar ou financiar. A interpretação contextual e os atos de fala pertencem ao Gemini.
6. **Variações Aleatórias de Frases:** Gerar rotações ou variações estocásticas de textos pré-escritos para simular naturalidade.
7. **Repetição de Perguntas de Formulário:** Forçar a repetição de perguntas procedurais quando a mensagem atual do cliente aborda outro assunto ou já satisfez a solicitação.
8. **Tratamento Especial por Nome de Cliente:** Inserir lógica condicional ou exceções vinculadas a contatos específicos (ex.: João Victor Santos, Raphael Rega, Michel, Bruno). O motor deve ser 100% generalizável.
9. **Veículos, Preços ou Disponibilidade Hardcoded:** Escrever modelos, marcas, anos ou valores de veículos diretamente no código das funções. Todas as informações comerciais devem emanar dinamicamente do inventário autorizado.
10. **Mascaramento de Erro de Infraestrutura:** Responder com frases de venda ou conversas falsas para esconder falhas de banco de dados, rede ou provedores. Erros técnicos devem seguir protocolos operacionais transparentes ou contingência controlada.

> **Regra de Ouro:** *Se uma solução proposta para um defeito de diálogo requer uma nova string comercial hardcoded no código JavaScript, a solução está no nível arquitetural errado.*

---

## 2. Responsabilidade Semântica do Gemini

O modelo Gemini (atualmente `gemini-3.5-flash-lite`, operando com saída estruturada via JSON Schema e `thinkingLevel: 'low'`) é a **única autoridade semântica** responsável por:

- **Compreensão de Intenção Atual:** Identificar a finalidade imediata de cada turno do cliente.
- **Interpretação de Referências Contextuais:** Resolver pronomes, elipses, seleções demonstrativas (*"essa"*, *"a segunda"*, *"a branca"*) e histórico recente.
- **Reconhecimento de Mudança de Assunto:** Detectar quando o cliente abandona um fluxo anterior (ex.: sai de simulação de financiamento e pergunta sobre fotos ou disponibilidade).
- **Consolidação de Informações Progressivas:** Compreender dados entregues em múltiplos turnos ou mensagens fragmentadas.
- **Interpretação de Correções do Cliente:** Priorizar a correção imediata sobre tópicos ou perguntas pendentes.
- **Resolução de Ambiguidades Linguísticas:** Solicitar esclarecimento natural quando múltiplos sentidos forem plausíveis, sem chutar estados.
- **Identificação de Perguntas Já Respondidas:** Reconhecer o que já foi fornecido e não re-perguntar dados conhecidos.
- **Determinação do Próximo Ato Conversacional:** Decidir a próxima interação necessária com base no plano de diálogo.
- **Formulação Natural de Respostas:** Redigir respostas em português brasileiro fluido, sem scripts artificiais ou frases repetitivas.

*Arquitetura de Chamadas:* Manter a chamada primária única ao Gemini (`salesGenerate`) com JSON Schema estruturado contendo `state`, `dialogue_plan`, `response_contract` e `semantic_intent`. Não multiplicar chamadas desnecessárias que aumentem a latência e criem cascatas frágeis de raciocínio.

---

## 3. Responsabilidade Determinística do CORE

O CORE do NORIA permanece como o **guardião operacional e de integridade**, responsável por:

- **Segurança & Permissões:** Garantir controle de acesso e autenticação nas integrações.
- **Isolamento Multi-tenant Estrito:** Blindar estados, tabelas, filas e memórias entre diferentes organizações (ex.: Gênesis Automóveis vs Clínica Núbia).
- **Controle de Sessões & Idempotência:** Prevenir reprocessamento de mensagens, gerenciar tokens e demarcar limites de sessão.
- **Validação de Fatos & Políticas:** Verificar se os fatos declarados pelo Gemini (`response_contract.facts`) estão estritamente fundamentados no ledger autorizado (`fact_ledger`), sem tolerar alucinações de preço, estoque ou disponibilidade.
- **Autorização Positiva de Estoque:** Apresentar apenas produtos autorizados dinamicamente pelo banco de dados do tenant, nunca assumindo disponibilidade por ausência de negação.
- **Persistência de Estado & Mídia:** Gravar leads, etapas do funil, documentos e transições de estágio no Supabase.
- **Handoff Humano Seguro:** Executar transferências de atendimento baseadas em regras de negócio verificadas (solicitação explícita ou avaliação comercial concreta), garantindo o bloqueio seguro da IA (`ai_locked: true`).

> **Princípio de Separação:** *A validação determinística do CORE deve auditar fatos, proteger o negócio e controlar transições de estado, NUNCA ditar o fraseamento ou substituir o raciocínio conversacional do LLM.*

---

## 4. Exceções Técnicas Legítimas vs Hardcoding Conversacional

Não confundir hardcoding conversacional com constantes técnicas indispensáveis.

| Categoria | Permitido? | Exemplos Válidos |
| :--- | :---: | :--- |
| **Constantes Técnicas & Enums** | **SIM** | Chaves de etapa (`sales_qualifying`, `sales_human`), identificadores de erro (`SALES_USAGE_LIMIT`), status (`announced`, `sold`). |
| **JSON Schemas & Contratos** | **SIM** | Definições estruturais de campos (`dialogue_plan`, `response_contract`, tipos e restrições). |
| **Limites de Segurança & Configurações** | **SIM** | `maxOutputTokens: 8192`, tempos de timeout, limites de fotos de vistoria. |
| **Políticas Comerciais Parametrizadas** | **SIM** | Regras de dias úteis, horários de expediente, exigência documental lida do banco/JSON do cliente. |
| **Avisos Operacionais de Erro Técnico** | **SIM** | Mensagens de sistema indicando instabilidade temporária (quando o LLM estiver comprovadamente inacessível). |
| **Frases Comerciais Prontas em `reply`** | **NÃO** | Substituir respostas do Gemini por frases prontas de vendas, perguntas fixas de modelo/ano, ou saudações artificiais. |
| **Branching Linguístico por Regex** | **NÃO** | Decidir fluxo conversacional com regex do tipo `if (/qual.*ano/.test(texto)) reply = "..."`. |

---

## 5. Política Obrigatória para Fallbacks e Contingências

Quando a chamada ao modelo falhar tecnicamente ou for rejeitada pela auditoria de fatos:
1. **Preservar a Intenção do Turno Atual:** O fallback nunca pode regredir para assuntos anteriores, ressuscitar propostas de financiamento já encerradas ou inventar interesse em produtos não mencionados.
2. **Sem Falsas Ofertas Comerciais:** O fallback não pode prometer condições, veículos ou financiamentos.
3. **Não Repetir Perguntas Já Satisfeitas:** Se o cliente já forneceu o ano ou documento, o fallback não pode voltar a exigir esses dados.
4. **Contingência Transparente:** Se a resposta não puder ser validada com segurança, a contingência deve propor um próximo passo neutro e operacional, ou acionar o encaminhamento para atendente humano, sem forjar um diálogo comercial inexistente.

---

## 6. Processo Obrigatório de Validação e Qualidade (Checklist de 10 Passos)

Antes de considerar qualquer correção conversacional como concluída:
1. **Reproduzir o Defeito:** Isolar a entrada do cliente e o histórico que geraram o comportamento incorreto.
2. **Identificar a Causa-Raiz Arquitetural:** Investigar falhas no schema, no ledger de fatos, no sanitizador de estado ou nas instruções do prompt.
3. **Corrigir na Camada Adequada:** Ajustar o contrato, o filtro dinâmico ou a regra semântica — **NUNCA injetar strings de texto fixas**.
4. **Criar Teste de Regressão Automatizado:** Criar teste que valide o comportamento estrutural e o estado resultante.
5. **Exercitar o CORE Gerado Real:** Executar o código compilado (`whatsapp_conversation_core.generated.js`) via suíte de testes.
6. **Validar o Estado Comercial:** Inspecionar os campos persistidos (`sell_vehicle`, `buy_interest`, `payment_mode`, `trade_in_status`).
7. **Inspecionar a Resposta Final:** Confirmar que a resposta enviada respeita os fatos oficiais sem depender de templates fixos.
8. **Auditoria Anti-Hardcode:** Executar verificação automatizada comprovando que nenhum texto comercial literal foi inserido no diff.
9. **Executar Regressões Multi-tenant:** Rodar os testes da Clínica Núbia e de fluxos genéricos para assegurar que nada foi quebrado.
10. **Documentar Evidências Factualmente:** Apresentar logs reais, métricas de tokens e relatórios reprodutíveis.

---

## 7. Verificação Automatizada Contínua

Todo diff ou PR deve ser validado pelo script de auditoria anti-hardcode:
```bash
node scripts/audit_anti_hardcode.cjs
```
Qualquer atribuição direta de strings conversacionais em variáveis de resposta (`reply`, `visibleReply`, `recoveredDialogue`) fora das constantes operacionais de erro do sistema resultará em reprovação imediata do build.
