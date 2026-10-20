# NORIA — Regras Permanentes de Arquitetura Conversacional (Anti-Hardcode & Separação CORE ↔ EXT)

> **STATUS:** REGRA ARQUITETURAL PERMANENTE MANDATÓRIA (P0)  
> **APLICAÇÃO:** Todos os módulos, workflows, extensões e tenants do NORIA (Gênesis Automóveis, Clínica Núbia, etc.)  
> **ESCOPO:** Todo e qualquer agente de IA, desenvolvedor ou assistente de código atuando no repositório.

---

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
Consulte a especificação detalhada em `AGENTS.md`.
