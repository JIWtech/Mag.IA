# Auditoria de alinhamento — NORIA / Hotfix12

Data: 2026-10-08. Escopo local: nenhuma migration foi executada, workflow não foi publicado, e nenhum deploy, commit ou push foi realizado.

## Contrato adotado para produto WhatsApp

O Hotfix12 separa corretamente dois conceitos:

- `raw_payload.catalog_referral`: referência inbound mínima para o Core (`source`, `product_id`, `retailer_id`, `title`). Não contém preço ou mídia inferidos.
- `raw_payload.product_snapshot`: registro de uma mensagem de produto enviada manualmente (`source`, IDs, título, moeda, URL HTTPS sanitizada, miniatura JPEG limitada e `verified_price`).

O frontend converte ambos em uma mídia de categoria `product`. O cartão mostra título e referência quando existirem, usa somente URL HTTPS pública ou a miniatura limitada, e só mostra preço atual/anterior quando `verified_price === true`. `price_amount_1000_raw` de snapshot manual é auditoria, não cotação atual; portanto não é exibido como preço confirmado. Nenhum preço ou imagem é buscado do estoque interno.

## Alterações implementadas

- `n8n/code/whatsapp_enqueue_core.js`: preserva `externalAdReply` em envelopes Evolution conhecidos e adiciona `catalog_referral` limitado e `exclusion_phone` ao turn enfileirado.
- `n8n/code/whatsapp_capture_manual_reply.js`: captura `productMessage` manual em `product_snapshot`, remove o envelope bruto do evento persistido, limita URL/miniatura e deduplica somente no escopo tenant + WhatsApp + instância. A atividade manual continua cancelando follow-ups sem alterar o lock humano.
- `app/src/dataService.js`: normaliza `product_snapshot`, `productMessage` e `catalog_referral`; bloqueia URL privada/credenciada e não converte preço bruto não verificado.
- `app/src/main.jsx` e `app/src/styles.css`: adicionam cartão de produto responsivo com fallback visual, título, IDs e preços somente verificados. Imagem, áudio, vídeo, documento e texto mantêm seus caminhos existentes.
- `scripts/build_whatsapp_core.cjs`: deixa de reconstruir o Core a partir da baseline Telegram antiga. Agora reproduz, de forma verificável, o nó `Processar Conversa WhatsApp` do Hotfix12. `scripts/build_whatsapp_core_workflow.cjs` passa a registrar a revisão Hotfix12 caso seja usado posteriormente.
- `supabase/migrations/027_channel_events_provider_instance_dedup.sql`: migration pendente para escopo de unicidade por instância Evolution. Não foi aplicada.

## Identidade, duplicação e isolamento

`normalizeExternalConversationId()` já preservava `@lid` como identidade distinta, sem convertê-lo em telefone. Essa postura foi preservada: a UI não une JID/LID por semelhança numérica. A captura manual agora somente reconhece duplicata de JID/LID quando o mesmo `external_message_id` pertence ao mesmo tenant, canal e instância do provedor; para registros históricos sem instância, ela somente aceita a conversa exatamente igual.

A limitação remanescente é estrutural: o índice atual de `channel_events` usa tenant/canal/id da mensagem, sem instância. A migration pendente corrige esse índice usando `provider_instance` derivado do payload sanitizado. Ela exige revisão e aplicação coordenada antes de publicar o adaptador novo em produção.

## Compatibilidade Hotfix12 comprovada

- O gerador executado produziu `n8n/code/whatsapp_conversation_core.generated.js` idêntico ao Core do Hotfix12 após normalização de fim de linha.
- Os adaptadores-fonte agora emitem os mesmos contratos Hotfix12 relevantes: `referral`, `catalog_referral`, `product_snapshot`, `provider_event` sanitizado e revisão de Core.
- O frontend aceita eventos Hotfix12 e formatos históricos: mídia normalizada, `productMessage` Evolution direto e `catalog_referral` sem foto/preço.

## Validação executada

| Comando | Resultado |
| --- | --- |
| `node --test src/dataService.test.js` em `app/` | 136 aprovados, 0 falhos |
| `npm run build` em `app/` | aprovado (Vite) |
| `node scripts/build_whatsapp_core.cjs` + comparação normalizada | aprovado; Core igual ao Hotfix12 |
| `node scripts/test_whatsapp_manual_reply.cjs` | 5 aprovados, 0 falhos, 1 ignorado |
| compilação assíncrona dos dois adaptadores n8n | aprovada |

Os testes adicionados cobrem snapshot manual não verificado, produto verificado com preço promocional/anterior, referência de catálogo sem foto/preço e separação JID/LID/tenant. A suíte existente cobre mídias normalizadas, timeline, estados de controle humano/IA e isolamento de tenant.

## Pendências externas e limites de validação

- Não houve conexão com Evolution, Supabase remoto ou n8n publicado; testes de ponta a ponta reais dependem desses ambientes.
- A migration `027` não foi aplicada. Enquanto ela não for revisada/aplicada, IDs idênticos entre instâncias no mesmo tenant continuam limitados pelo índice histórico do banco.
- O workflow local `n8n/workflows/magia_whatsapp_evolution_mvp.json` já estava ausente no worktree antes desta entrega; ele não foi recriado nem publicado. O Hotfix12 permanece como referência local intacta.
- Os componentes históricos do Core (`whatsapp_sales.js`, etc.) ainda existem para auditoria, mas o gerador não os sobrepõe ao Core Hotfix12: fazê-lo reintroduziria divergência até que cada função seja extraída e validada individualmente.
- `node scripts/test_whatsapp_core.cjs` executou 66 testes: 56 passaram e 10 falharam. São expectativas de agendamento do Core antigo/clinic baseline e divergem do comportamento do Core Hotfix12 reproduzido agora; não foram alteradas para mascarar a incompatibilidade. O teste de roteamento do workflow manual ficou ignorado porque seu fixture (`magia_whatsapp_evolution_mvp.json`) não existe no worktree.

## Complemento — cartões de catálogo

O painel agora remove identificadores técnicos visíveis e consulta `whatsapp_catalog_products` somente por `tenant_id`, `instance_name` e `product_id`. Ausência de cache mantém o cartão histórico somente com título e “Produto do catálogo”. Uma solicitação autenticada e limitada por cooldown pode pedir ao command router que atualize o cache via Evolution; nenhuma chave é enviada ao navegador. A migration pendente `028_whatsapp_catalog_cache.sql` cria a tabela/RLS quando ela ainda não existir.
