# Apresentação de anexos

Cards e estados de erro de mídia visual e áudio usam rótulos legíveis no lugar de nomes técnicos de arquivos. A foto de catálogo `veiculo-catalogo.jpg` aparece como Foto do veículo. As legendas reais e os nomes de documentos continuam preservados. Uma legenda idêntica ao nome do arquivo é omitida em mídia visual.

Corrigida também a navegação da galeria: o grupo agora respeita a sequência de anexos e o remetente, em vez de reunir toda a conversa. O teste comportamental existente que falhava com três imagens em vez de duas passou após o ajuste.

Validação: 5/5 testes direcionados aprovados, build do frontend aprovado. A suíte completa continua apresentando falhas em testes de arquitetura, localização e estrutura de componentes; não foram modificados para esconder falhas. Nenhuma publicação ou alteração de dados foi feita.

Rollback: reverter somente as alterações deste ajuste em MediaAttachment.jsx, nos dois módulos mediaPresentation.js e remover friendlyMediaLabels.test.js. Preservar os ajustes anteriores do CORE, Kanban e landing.
