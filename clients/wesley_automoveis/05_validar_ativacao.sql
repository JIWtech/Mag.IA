-- Somente leitura. Executar depois da migration 025 e do arquivo 04.
select t.id,t.slug,s.settings->>'conversation_capability' as capability,
  s.settings->>'whatsapp_processing_mode' as processing_mode,
  s.settings->>'grounding_mode' as grounding_mode,
  s.settings->>'ai_enabled' as ai_enabled,s.settings->>'ai_model' as ai_model,
  s.settings->>'gemini_daily_limit' as daily_limit,
  s.settings->>'whatsapp_audio_enabled' as audio_enabled,
  s.settings->'sales'->>'document_ocr_enabled' as ocr_enabled,
  s.settings->>'prompt_revision' as prompt_revision,
  s.settings->>'payment_signal_enabled' as payment_signal_enabled,
  c.external_id,c.status as channel_status
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
join public.channels c on c.tenant_id=t.id and c.type='whatsapp'
where t.slug='wesley_automoveis';

select c.position,c.name,c.automation_key,
  b.settings->'stages'->c.automation_key->>'allow_ai' as allow_ai
from public.kanban_boards b join public.kanban_columns c on c.board_id=b.id
join public.tenants t on t.id=b.tenant_id where t.slug='wesley_automoveis'
order by c.position;

select count(*) as active_legacy_prompts from public.ai_prompt_versions p
join public.tenants t on t.id=p.tenant_id where t.slug='wesley_automoveis' and p.active;

-- Nenhum dado pessoal extraido e retornado abaixo.
select l.id,l.stage_key,l.ai_locked,l.revision,l.hot,l.interest_registered,l.session_id,
  (select count(*) from public.sales_documents d where d.lead_id=l.id) as documents_to_review,
  l.updated_at
from public.sales_leads l join public.tenants t on t.id=l.tenant_id
where t.slug='wesley_automoveis' order by l.updated_at desc limit 20;

select e.created_at,e.direction,e.ai_provider,e.ai_error,e.stage,e.handoff
from public.channel_events e join public.tenants t on t.id=e.tenant_id
where t.slug='wesley_automoveis' order by e.created_at desc limit 30;

-- Comparar antes/depois dos testes: SDR nao deve criar appointments.
select count(*) as appointments_count from public.appointments a
join public.tenants t on t.id=a.tenant_id where t.slug='wesley_automoveis';

select tablename,policyname,roles,cmd from pg_policies where schemaname='public'
and tablename in ('sales_leads','sales_documents');
select has_table_privilege('anon','public.sales_documents','select') as anon_must_be_false,
  has_function_privilege('authenticated',
    'public.magia_sales_save(uuid,text,text,uuid,integer,text,jsonb,jsonb,text,boolean,jsonb)','execute') as direct_save_must_be_false,
  has_function_privilege('authenticated','public.magia_sales_move(uuid,text,integer)','execute') as operator_move_must_be_true;
