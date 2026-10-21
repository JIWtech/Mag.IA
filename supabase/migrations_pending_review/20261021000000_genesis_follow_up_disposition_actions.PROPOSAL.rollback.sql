-- Rollback da PROPOSTA (nao aplicado). Reverte somente o que a proposta aplicou, e somente se o marcador ainda existir.
--   * exige disposition_actions_proposal = '20261021' (sem o marcador, nada e alterado);
--   * remove 'declined' e 'closed_by_customer' apenas se ainda forem exatamente 'cancel';
--   * preserva qualquer outra chave de disposition_actions (inclusive deferred_by_customer e valores alterados depois);
--   * remove disposition_actions somente se ficar vazio; remove o marcador; preserva enabled, messages, revision e demais chaves;
--   * afeta apenas o tenant wesley_automoveis.
-- Se uma decisao posterior alterou disposition_actions e removeu o marcador, este script nao faz nada: restaurar manualmente
-- a partir do export de tenant_settings feito antes da aplicacao, comparando chave a chave.

update public.tenant_settings ts
   set settings = jsonb_set(
         ts.settings,
         '{sales_follow_up}',
         case when r.remaining = '{}'::jsonb
              then r.sf - 'disposition_actions' - 'disposition_actions_proposal'
              else jsonb_set(r.sf - 'disposition_actions_proposal', '{disposition_actions}', r.remaining)
         end,
         false)
  from public.tenants t,
       lateral (
         select ts.settings->'sales_follow_up' as sf,
                (select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
                   from jsonb_each(ts.settings->'sales_follow_up'->'disposition_actions') as e(k, v)
                  where not (e.k in ('declined', 'closed_by_customer') and e.v = '"cancel"'::jsonb)) as remaining
       ) r
 where t.id = ts.tenant_id
   and t.slug = 'wesley_automoveis'
   and ts.settings->'sales_follow_up'->>'disposition_actions_proposal' = '20261021'
   and jsonb_typeof(ts.settings->'sales_follow_up'->'disposition_actions') = 'object';
