const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../../../clients/wesley_automoveis');
const sales=JSON.parse(fs.readFileSync(path.join(dir,'sales.json'),'utf8'));
const settings={conversation_capability:'sales_v1',whatsapp_processing_mode:'conversation_core_v1',grounding_mode:'canonical_v2',
  attendance_lifecycle:'session_v2',ai_enabled:true,ai_model:'gemini-3.5-flash-lite',ai_provider:'gemini',gemini_daily_limit:80,
  whatsapp_audio_enabled:true,follow_up_enabled:false,payment_signal_enabled:false,appointment_scheduling:{enabled:false},
  debounce_window_ms:8000,fragment_debounce_window_ms:12000,prompt_revision:'wesley-sales-v2-2026-10-07',
  system_prompt:fs.readFileSync(path.join(dir,'system_prompt.md'),'utf8').trim(),sales,onboarding_status:'sales_v1_enabled'};
const literal=JSON.stringify(settings,null,2);
if(literal.includes('$config$'))throw Error('SQL delimiter collision');
const sql=`-- Generated: node scripts/build/sql/build_wesley_sales_sql.cjs
-- ORDEM: migration 025, publicar Core/painel atualizados, depois este arquivo.
-- Ativa apenas Wesley. Nao publica n8n, nao muda outros tenants.
begin;
do $$
declare tid uuid; bid uuid; item record; affected integer;
begin
  if to_regprocedure('public.magia_sales_move(uuid,text,integer)') is null then raise exception 'Execute migration 025'; end if;
  select id into strict tid from public.tenants where slug='wesley_automoveis' and status='active' and deleted_at is null;
  if not exists(select 1 from public.tenant_members where tenant_id=tid and user_id='8fb2bc06-94d5-4abe-83b2-1aed41a346ae' and role='owner' and status='active') then raise exception 'Owner incorreto'; end if;
  if not exists(select 1 from public.channels where tenant_id=tid and type='whatsapp' and external_id='wesley-carros'
    and status in ('pending','active') and config->>'phone'='5521992923139') then raise exception 'Execute 03 e confira canal'; end if;
  if exists(select 1 from public.channels where tenant_id<>tid and type='whatsapp' and external_id='wesley-carros') then raise exception 'Instancia duplicada'; end if;
  if (select count(*) from public.kanban_boards where tenant_id=tid)>1 then raise exception 'Revisar quadros existentes'; end if;
  select id into bid from public.kanban_boards where tenant_id=tid;
  if bid is not null and exists(select 1 from public.kanban_boards where id=bid and settings->>'capability' is distinct from 'sales_v1')
    then raise exception 'Quadro anterior exige revisao, nao sobrescrever'; end if;
  if bid is null then insert into public.kanban_boards(tenant_id,name,is_default,settings)
    values(tid,'SDR - Wesley Automoveis',true,'{"capability":"sales_v1"}') returning id into bid; end if;
  update public.tenant_settings set settings=settings || $config$${literal}$config$::jsonb,updated_at=now() where tenant_id=tid;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Settings ausentes ou duplicados'; end if;
  update public.tenant_settings set settings=jsonb_set(settings,'{sdr_rules}',
    coalesce(settings->'sdr_rules','{}'::jsonb)||'{"document_processing":"private_ocr_human_review","hot_lead_percent":20}'::jsonb)
    where tenant_id=tid;
  update public.kanban_boards set settings=jsonb_build_object('capability','sales_v1','stages',
    (select settings->'sales'->'stages' from public.tenant_settings where tenant_id=tid)) where id=bid;
  for item in select key,value,ordinality from jsonb_each((select settings->'sales'->'stages' from public.tenant_settings where tenant_id=tid)) with ordinality loop
    if not exists(select 1 from public.kanban_columns where board_id=bid and automation_key=item.key) then
      insert into public.kanban_columns(tenant_id,board_id,name,position,automation_key)
      values(tid,bid,item.value->>'name',case item.key when 'sales_new' then 1 when 'sales_qualifying' then 2
        when 'sales_hot' then 3 when 'sales_appraisal' then 4 when 'sales_financing' then 5 when 'sales_after_sales' then 6
        when 'sales_human' then 7 else 8 end,item.key);
    end if;
  end loop;
  update public.ai_prompt_versions set active=false where tenant_id=tid and active;
  update public.channels set status='active',updated_at=now() where tenant_id=tid and type='whatsapp' and external_id='wesley-carros';
end $$;
commit;
select t.slug,s.settings->>'conversation_capability' as capability,s.settings->>'ai_enabled' as ai_enabled,
  c.external_id,c.status from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
  join public.channels c on c.tenant_id=t.id where t.slug='wesley_automoveis';
`;
fs.writeFileSync(path.join(dir,'04_ativar_sales.sql'),sql);
console.log('Built tenant-only Wesley activation SQL.');
