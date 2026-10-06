-- Somente leitura; executar depois da migration 028. Nao mostra CPF, CNH, nascimento ou telefones.
select t.slug,s.settings#>>'{sales,hot_lead_rule}' as qualification_rule,
  s.settings#>>'{sales,document_ocr_enabled}' as document_ocr_enabled,
  s.settings#>>'{sales,stages,sales_hot,allow_ai}' as hot_stage_allow_ai,
  s.settings->>'contact_exclusion_enabled' as contact_exclusion_enabled,
  s.settings->>'follow_up_enabled' as follow_up_enabled
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id where t.slug='wesley_automoveis';

select l.id as lead_id,l.updated_at,l.stage_key,l.ai_locked,l.hot,
  l.state->>'intent' as intent,l.product->>'name' as vehicle,
  l.deposit_cents, l.state->'financing_qualification' as recorded_qualification,
  public.magia_sales_financing_qualification(l.state,l.product,coalesce(d.docs,'[]'::jsonb)) as qualification_from_stored_data,
  l.session_id=coalesce((select e.id::text from public.channel_events e
    where e.tenant_id=l.tenant_id and e.channel_type=l.channel_type and e.external_conversation_id=l.chat_id
      and (e.service='conversation_closed' or e.ai_provider in ('conversation_closed','conversation_reset'))
    order by e.created_at desc,e.id desc limit 1),'initial') as current_session
from public.sales_leads l join public.tenants t on t.id=l.tenant_id
left join lateral (select jsonb_agg(extracted) as docs from public.sales_documents
  where tenant_id=l.tenant_id and lead_id=l.id and verification_status<>'rejected') d on true
where t.slug='wesley_automoveis'
order by l.updated_at desc limit 100;
