-- Aplicar depois da migration 028 e de publicar o Core atualizado.
-- Apenas Genesis. Preserva prompt existente, ativacao, modelo, limites, follow-up e exclusoes.
begin;
do $$
declare tid uuid; cfg jsonb; marker text:='[QUALIFICACAO FINANCIAMENTO V1]';
begin
  if to_regprocedure('public.magia_sales_financing_qualification(jsonb,jsonb,jsonb)') is null then
    raise exception 'Aplicar migration 028 primeiro'; end if;
  select t.id,s.settings into strict tid,cfg from public.tenants t
    join public.tenant_settings s on s.tenant_id=t.id
    where t.slug='wesley_automoveis' and t.status='active' and t.deleted_at is null
      and s.settings->>'conversation_capability'='sales_v1'
      and s.settings->>'whatsapp_processing_mode'='conversation_core_v1'
    for update of s;
  if nullif(cfg->>'system_prompt','') is null then raise exception 'Prompt comercial ausente'; end if;
  if cfg#>>'{sales,document_ocr_enabled}' is distinct from 'true' then
    raise exception 'OCR de documentos precisa estar habilitado para receber CNH'; end if;
  if cfg#>>'{sales,stages,sales_hot,allow_ai}' is distinct from 'false' then
    raise exception 'Revisar etapa quente: deve exigir atendimento humano'; end if;
  if position(marker in (cfg->>'system_prompt'))=0 then
    cfg:=jsonb_set(cfg,'{system_prompt}',to_jsonb((cfg->>'system_prompt')||E'\n\n'||marker||E'\n'
      ||'Na compra financiada de um veiculo listado, qualifique a entrada disponivel e a documentacao para financiamento. '
      ||'Registre o valor real da entrada, inclusive zero ou valor abaixo do minimo; nao substitua pelo valor desejado. '
      ||'Entrada suficiente significa pelo menos 30% do preco do veiculo escolhido. '
      ||'Documentacao completa significa CPF, data de nascimento e CNH recebidos, nao o documento do carro. '
      ||'Use document_status; nao repita pedidos de dados ja recebidos. Uma pergunta por vez. '
      ||'Nao considere somente entrada ou somente documento como lead quente. O backend calcula a classificacao; voce nao decide o score. '
      ||'Antes de encaminhar uma compra financiada apenas por ter recebido preferencias, colete a entrada e os dados faltantes. '
      ||'Pedido explicito de humano, recusa de fornecer dados, falha tecnica, pos-venda e veiculo nao listado continuam seguindo os encaminhamentos existentes. '
      ||'Compra a vista ou cartao e avaliacao de veiculo vendido para a loja continuam com suas regras, sem impor documentos de financiamento. '
      ||'Recebimento nao significa autenticacao, simulacao realizada ou credito aprovado. Nunca repita CPF, nascimento ou CNH na resposta ou no state.'));
  end if;
  update public.tenant_settings set settings=cfg||jsonb_build_object('sales',coalesce(cfg->'sales','{}'::jsonb)
    ||'{"hot_lead_rule":"deposit_30_and_financing_documents_v1","collect_documents":true,"birth_date_required":true}'::jsonb),
    updated_at=now() where tenant_id=tid;
end $$;
commit;
select t.slug,s.settings#>>'{sales,hot_lead_rule}' as hot_lead_rule,
  s.settings#>>'{sales,collect_documents}' as collect_documents
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id where t.slug='wesley_automoveis';
