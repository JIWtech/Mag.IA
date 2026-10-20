# Exports históricos de nós n8n

Estes arquivos estavam soltos na raiz e foram movidos sem alterar o conteúdo ou a
codificação original. Incluem cópias UTF-16 e UTF-8 de nós extraídos de workflows.

Não são fontes canônicas nem devem ser executados/publicados diretamente.
As fontes atuais ficam em `n8n/sources/`; gere os workflows usando
`node scripts/build_noria_workflows.cjs`.

O script histórico de alteração de workflow está em
`scripts/archive/update_workflow.js`. Ele ainda contém o caminho da máquina de
origem e se refere a um workflow legado removido: não o use no fluxo atual.
