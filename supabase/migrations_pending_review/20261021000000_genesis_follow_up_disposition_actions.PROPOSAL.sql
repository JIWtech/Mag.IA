-- PROPOSTA, NAO APLICADA. Depende de aprovacao comercial explicita da Genesis.
-- Define o que a EXT Genesis faz com follow-ups pendentes quando o cliente manifesta uma disposicao.
-- O Gemini identifica a disposicao; a EXT le esta politica e decide; o CORE apenas executa 'cancel'.
-- Sem esta chave (ou sem a disposicao nela) a EXT devolve 'undecided' e NADA e cancelado.
--
--   declined             -> cancel   (proposta)
--   closed_by_customer   -> cancel   (proposta)
--   deferred_by_customer -> AUSENTE de proposito: permanece 'undecided' ate decisao explicita ('cancel' ou 'keep').
--
-- Estado lido em 2026-10-21 (somente leitura): sales_follow_up = {enabled, messages{3h,24h,15d}, revision}; sem disposition_actions.
-- Efeito: preserva todas as chaves existentes de sales_follow_up e acrescenta apenas:
--   disposition_actions                  as duas disposicoes acima
--   disposition_actions_proposal         marcador desta proposta, usado pelo rollback para saber o que foi aplicado por ela
-- Qualquer aprovacao posterior que altere disposition_actions deve REMOVER o marcador (ele deixa de descrever o estado).
-- So afeta o tenant wesley_automoveis e so se disposition_actions ainda nao existir.
-- Aplicacao (apos aprovacao): exportar tenant_settings da Genesis antes; aplicar em transacao; validar com o executor de homologacao.

update public.tenant_settings ts
   set settings = jsonb_set(
         ts.settings,
         '{sales_follow_up}',
         coalesce(ts.settings->'sales_follow_up', '{}'::jsonb)
           || jsonb_build_object(
                'disposition_actions', jsonb_build_object('declined', 'cancel', 'closed_by_customer', 'cancel'),
                'disposition_actions_proposal', '20261021'),
         true)
  from public.tenants t
 where t.id = ts.tenant_id
   and t.slug = 'wesley_automoveis'
   and jsonb_typeof(ts.settings->'sales_follow_up') = 'object'
   and not (ts.settings->'sales_follow_up' ? 'disposition_actions');
