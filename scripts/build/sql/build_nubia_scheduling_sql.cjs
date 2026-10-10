const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../../clients/clinica_nubia_oficial');
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const patch = {
  prompt_revision: 'nubia-2026-09-29-angra-sessoes-v5',
  system_prompt: fs.readFileSync(path.join(dir, 'prompt_canonico_v2.txt'), 'utf8').trim(),
  business_facts: read('business_facts_v2.json'),
  appointment_scheduling: read('scheduling.json'),
  appointment_duration_minutes: 90,
  payment_signal_confirmation_message: read('payment_update.json').confirmation_message,
};
const sqlJson = obj => {
  const json = JSON.stringify(obj, null, 2);
  if (json.includes('$settings$')) throw Error('SQL delimiter collision');
  return '$settings$' + json + '$settings$::jsonb';
};
fs.writeFileSync(path.join(dir, '05_unidades_agenda_pagamento.sql'), `-- Generated: node scripts/build/sql/build_nubia_scheduling_sql.cjs
-- ORDEM: publicar core compativel, executar migration 018, executar este arquivo.
-- Nao altera outros tenants, historico, usuarios ou reservas existentes.
begin;
do $$
declare affected integer; tid uuid; item jsonb; existing_id uuid; matches integer;
begin
  if to_regprocedure('public.magia_reserve_appointment(uuid,text,text,date,time without time zone,text,text,text,text,text)') is null
    then raise exception 'Execute a migration 018 primeiro'; end if;
  select id into strict tid from public.tenants where slug='clinica_nubia_oficial' and status='active';
  for item in select value from jsonb_array_elements(${sqlJson(read('catalog_document_update.json').services)}) loop
    select count(*), (array_agg(id))[1] into matches, existing_id
      from public.tenant_service_catalog where tenant_id=tid and external_id=item->>'external_id';
    if matches>1 then raise exception 'External_id de servico duplicado; revisar catalogo antes de aplicar'; end if;
    if matches=1 then
      update public.tenant_service_catalog set name=item->>'name', category=item->>'category',
        description=item->>'description', notes='', estimated_hours=(item->>'estimated_hours')::numeric,
        price=case when (item->>'preserve_price')::boolean then price else (item->>'price')::numeric end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verified_source','Movvy_Agendamento_Servicos.docx'),
        active=true, updated_at=now() where id=existing_id;
    else
      if (item->>'preserve_price')::boolean then raise exception 'Servico anterior nao encontrado para preservar preco'; end if;
      insert into public.tenant_service_catalog(tenant_id,external_source,external_id,name,category,description,price,estimated_hours,billing_unit,notes,metadata,active)
      values(tid,'official_document',item->>'external_id',item->>'name',item->>'category',item->>'description',
        (item->>'price')::numeric,(item->>'estimated_hours')::numeric,'sessao','',
        jsonb_build_object('verified_source','Movvy_Agendamento_Servicos.docx'),true);
    end if;
  end loop;
  update public.tenant_service_catalog set active=false,updated_at=now()
    where tenant_id=tid and external_id in (select jsonb_array_elements_text(${sqlJson(read('catalog_document_update.json').deactivate)}));
  update public.tenant_settings s set settings = (s.settings - 'conversation_style_instructions')
    || ${sqlJson(patch)}
    || jsonb_build_object('payment', coalesce(s.settings->'payment', '{}'::jsonb) || ${sqlJson(read('payment_update.json'))}), updated_at = now()
  from public.tenants t where t.id=s.tenant_id and t.slug='clinica_nubia_oficial'
    and s.settings->>'grounding_mode'='canonical_v2'
    and s.settings->>'whatsapp_processing_mode'='conversation_core_v1';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Tenant/core canonico oficial nao encontrado'; end if;
end $$;
commit;

-- Revisao obrigatoria: classificar unidade/servico das reservas futuras anteriores a esta migration.
select a.id, a.title, a.starts_at, a.ends_at, a.status, a.metadata->>'unit_id' as unit_id
from public.appointments a join public.tenants t on t.id=a.tenant_id
where t.slug='clinica_nubia_oficial' and a.starts_at>now()
  and a.status not in ('cancelled','canceled','completed','done','no_show')
  and not exists (select 1 from public.appointment_capacity_allocations x where x.appointment_id=a.id);
`);
console.log('Generated official unit, scheduling and payment configuration SQL.');
