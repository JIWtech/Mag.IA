# Wesley Automoveis

Tenant no Supabase e workflow WhatsApp existentes, sem copia por cliente.
Instancia `wesley-carros`, telefone `5521992923139`, carros e motos.

**Roteiro vigente: [PASSO_A_PASSO.md](PASSO_A_PASSO.md).**
Suporte comercial `sales_v1` implementado localmente. Esta entrega nao publicou
workflow/painel nem executou a ativacao em producao.

## Ordem restante

1. Supabase: [migration 025](../../supabase/migrations/025_sales_capability.sql).
2. n8n: substituir o conteudo do workflow WhatsApp compartilhado pelo
   [JSON atualizado](../../n8n/workflows/magia_whatsapp_evolution_mvp.json).
3. Publicar frontend atualizado de `app/` e conferir variaveis Wesley no n8n.
4. Supabase: [04_ativar_sales.sql](04_ativar_sales.sql).
5. Supabase: [05_validar_ativacao.sql](05_validar_ativacao.sql), depois homologar
   WhatsApp e painel com numero controlado conforme roteiro.

Cadastro 01/03 ja executado nao precisa ser repetido. Nao executar arquivos da
Nubia. Para pausar apenas Wesley: [06_pausar_sales.sql](06_pausar_sales.sql).

## Fontes e comportamento

- [system_prompt.md](system_prompt.md): prompt publicado pelo 04; nao usar rascunho antigo.
- [sales.json](sales.json): planilha, documentos e semantica de etapas no Supabase.
- [Escopo PDF](../../docs/escopo_clientes/wesley/Estrategia_SDR_Wesley_Automoveis.pdf).
- Estoque por turno: planilha publica, nao `estoque_referencia.json`.
- Interesse em `sales_leads`, nunca em `appointments`.
- Nome/CPF/CNH/nascimento extraidos em `sales_documents`, com RLS e conferencia
  humana. Arquivos binarios nao sao arquivados por este pacote.
- Duas etapas com IA; demais bloqueiam respostas. Oitava coluna humana cobre
  excecoes, compra a vista e entrada abaixo do limiar, sem falso lead quente.
- Sem aprovacao de credito, preco de avaliacao automatico, reserva de veiculo,
  alerta externo ou follow-up comercial automatico.

`prompt_sdr.rascunho.md`, `estoque_referencia.json` e `regras_sdr.cjs` sao
levantamento/testes, nao codigo a colar no n8n. Regenerar apos editar fontes:

```powershell
node scripts/build_whatsapp_core_workflow.cjs
node scripts/build_wesley_sales_sql.cjs
```
