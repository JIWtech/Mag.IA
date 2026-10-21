# Homologação isolada da Gênesis com Gemini real

O executor roda os nós reais (identidade da EXT, bootstrap, `prepare` do CORE, `commercial.decide` da EXT, `finalize` do CORE com o
auditor) contra um mundo simulado. Supabase e Evolution são simulados; qualquer outro host, exceto Gemini `generateContent`, é bloqueado.
Nada é enviado por WhatsApp e nada é gravado em produção. As RPCs da fila seguem as funções publicadas (limites em `genesis_executor.cjs`).

## Estado

**Bloqueado apenas por credencial e autorização.** Os snapshots estão prontos em `%USERPROFILE%\.noria-homolog\` (fora do repositório).
Verificar sem rede:

```bash
D="$USERPROFILE/.noria-homolog"
HOMOLOG_SETTINGS_SNAPSHOT="$D/genesis_settings_snapshot.json" HOMOLOG_INVENTORY_SNAPSHOT="$D/genesis_inventory_snapshot.json" HOMOLOG_IMAGES_SNAPSHOT="$D/genesis_images_snapshot.json" node scripts/homolog/genesis_executor.cjs --preflight --scenarios=scripts/homolog/fixtures/genesis_dialogues_real_inventory.json
```

Sai com código 0 somente quando tudo está pronto. Não faz chamada de rede.

## Requisitos

| Requisito | Variável | Observação |
|---|---|---|
| Autorização explícita | `HOMOLOG_GEMINI_AUTHORIZED=1` | dada pelo responsável, por execução |
| Credencial exclusiva | `HOMOLOG_GEMINI_KEY` | nunca `GEMINI_API_KEY`; o executor recusa chave igual à do ambiente ou à do `.env` |
| Settings da Gênesis | `HOMOLOG_SETTINGS_SNAPSHOT` | export autorizado, com `system_prompt`, `sales`, `sdr_rules`, `business_facts`, `sales_follow_up`; sem credenciais |
| Estoque | `HOMOLOG_INVENTORY_SNAPSHOT` | 12 veículos reais com observações e datas originais |
| Registro de imagens | `HOMOLOG_IMAGES_SNAPSHOT` | metadados (sem baixar arquivos). Obrigatório quando o tenant habilita fotos |

Os snapshots não contêm dados de clientes e não devem ser versionados.

## Arquivos de diálogos

- `fixtures/genesis_dialogues_real_inventory.json`: **homologação principal**, estoque real. Seis diálogos, 20 turnos, com um veículo inexistente intencional.
- `fixtures/genesis_dialogues.json`: estoque sintético anterior (CG 160, Corsa). Mantido como estava, para regressão.
- `fixtures/genesis_scenarios.json`: cenários canônicos com respostas enlatadas (regressão, sem Gemini).

## Execução gradual

Registrar os pedidos sem enviá-los (modo `dry`, sem chave, usa os snapshots se as variáveis estiverem definidas):

```bash
node scripts/homolog/genesis_executor.cjs --mode=dry --scenarios=scripts/homolog/fixtures/genesis_dialogues_real_inventory.json
```

Primeira chamada real: **um** diálogo curto e completo (o 3: menção, interesse e seleção), com a chave e a autorização:

```bash
node scripts/homolog/genesis_executor.cjs --mode=real --only=3 --scenarios=scripts/homolog/fixtures/genesis_dialogues_real_inventory.json --out="$USERPROFILE/.noria-homolog/resultado-3.json"
```

Só depois de avaliar esse diálogo seguir para os demais (`--only=1`, `--only=2`, …). O modo `fixtures` recusa arquivos de diálogos, pois
não há respostas enlatadas e passaria sem interpretar nada.

## Fotos

O registro de imagens entra no banco simulado em memória. A EXT decide a autorização com a própria lógica (`decideProductPhotoAction`):
produto identificado e elegível, prova de imagem do tenant, MIME, hash, tamanho e URL pública conferidos. O executor só traduz o tenant e o host do
snapshot para os simulados. O envio é simulado (`sendMedia` registra a URL, nunca a busca). Verificação, sem Gemini:

```bash
node scripts/homolog/photo_authorization_checks.cjs
```

Cobre: veículo elegível com imagem, elegível sem imagem registrada, vendido, não verificado, pedido sem veículo e fotos desabilitadas. Falha (não
ignora) se os snapshots não existirem. A interpretação do modelo é enlatada nessas verificações; elas provam a EXT e o CORE, não o Gemini.

## O que ler no resultado

Para cada turno, `interpretation` mostra o que o Gemini interpretou (intenção, tópicos, papel do produto, disposição, resposta a oferta,
propósito do veículo do cliente, pedido de atendente) e o veredito do auditor. `reply` é a resposta produzida pelo fluxo; `state` o efeito
comercial; `simulated_media` as fotos que seriam enviadas. Os diálogos não têm expectativas automáticas: a avaliação é de leitura.
