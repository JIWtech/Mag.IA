-- Run AFTER supabase/migrations/016_channel_events_read_isolation.sql.
-- Creates a NEW tenant; never deletes or updates the source clinic or other clients.
-- Copies configuration only, not conversations, contacts, appointments or users.
-- The WhatsApp channel stays pending until its connection and credentials are verified.
begin;

do $setup$
declare
  source_id uuid;
  target_id uuid;
  agent_id uuid;
  board_id_new uuid;
  owner_id constant uuid := '81b9161a-152b-4f49-867a-3bcbcfbf0c7e';
  owner_email text;
  source_settings public.tenant_settings%rowtype;
  source_agent public.ai_agents%rowtype;
  source_prompt public.ai_prompt_versions%rowtype;
  clean_settings jsonb;
begin
  -- Protect concurrent runs of this exact onboarding.
  perform pg_advisory_xact_lock(hashtext('onboarding:clinica_nubia_oficial'));

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'channel_events'
      and policyname = 'channel_events_read_isolation' and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Execute primeiro a migration 016_channel_events_read_isolation.sql';
  end if;

  select email into owner_email from auth.users where id = owner_id;
  if owner_email is null then
    raise exception 'Usuario Auth nao encontrado pelo UID informado';
  end if;
  if exists (select 1 from public.tenants where slug = 'clinica_nubia_oficial') then
    raise exception 'O ambiente oficial ja existe. Nada foi alterado. Nao repita o cadastro.';
  end if;
  if exists (select 1 from public.tenant_members where user_id = owner_id) then
    raise exception 'Este usuario ja tem vinculos. Revise-os antes de criar um ambiente exclusivo.';
  end if;

  select id into source_id from public.tenants
    where slug = 'clinica_nubia' and deleted_at is null;
  if source_id is null then raise exception 'Clinica de origem nao encontrada'; end if;
  if (select count(*) from public.tenant_settings where tenant_id = source_id) <> 1 then
    raise exception 'A origem deve ter exatamente um registro em tenant_settings';
  end if;
  if exists (
    select 1 from public.channels
    where type = 'whatsapp'
      and (external_id = 'clinica_nubia' or config->>'instance_name' = 'clinica_nubia')
  ) then
    raise exception 'Instancia clinica_nubia ja vinculada a um tenant. Revisar antes de duplicar o roteamento.';
  end if;

  select * into source_settings from public.tenant_settings where tenant_id = source_id;
  select * into source_agent from public.ai_agents where tenant_id = source_id
    order by case when name = 'Atendente principal' then 0 else 1 end, created_at, id limit 1;
  if source_agent.id is null then raise exception 'Agente de origem nao encontrado'; end if;
  select * into source_prompt from public.ai_prompt_versions
    where tenant_id = source_id and ai_agent_id = source_agent.id and active = true
    order by version desc, created_at desc, id limit 1;
  if source_prompt.id is null then raise exception 'Prompt ativo de origem nao encontrado'; end if;

  insert into public.tenants (slug, name, industry, plan, status)
  select 'clinica_nubia_oficial', 'Clínica da Núbia', industry, plan, 'active'
  from public.tenants where id = source_id returning id into target_id;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean_settings
  from jsonb_each(coalesce(source_settings.settings, '{}'::jsonb))
  where key not ilike '%telegram%' and key not in ('bot_username', 'bot_token');
  clean_settings := clean_settings || jsonb_build_object(
    'enabled_channels', jsonb_build_array('whatsapp'), 'default_channel', 'whatsapp'
  );
  insert into public.tenant_settings
    (tenant_id, timezone, business_hours, fallback_message, handoff_message, settings)
  values (target_id, source_settings.timezone, source_settings.business_hours,
    source_settings.fallback_message, source_settings.handoff_message, clean_settings);

  insert into public.ai_agents
    (tenant_id, name, provider, model, temperature, max_tokens, active_prompt_version, settings)
  values (target_id, source_agent.name, source_agent.provider, source_agent.model,
    source_agent.temperature, source_agent.max_tokens, source_prompt.version, source_agent.settings)
  returning id into agent_id;
  insert into public.ai_prompt_versions
    (tenant_id, ai_agent_id, version, prompt, guardrails, tools, active)
  values (target_id, agent_id, source_prompt.version, source_prompt.prompt,
    source_prompt.guardrails, source_prompt.tools, true);

  insert into public.tenant_service_catalog
    (tenant_id, external_source, external_id, category, name, description,
     billing_unit, price, estimated_hours, notes, metadata, active)
  select target_id, external_source, external_id, category, name, description,
    billing_unit, price, estimated_hours, notes, metadata, active
  from public.tenant_service_catalog where tenant_id = source_id;

  -- Some installations create a default board automatically. Reuse it if present.
  select id into board_id_new from public.kanban_boards
    where tenant_id = target_id and is_default = true order by created_at, id limit 1;
  if board_id_new is null then
    insert into public.kanban_boards (tenant_id, name, is_default)
      values (target_id, 'Atendimento Clínica da Núbia', true) returning id into board_id_new;
  end if;
  -- Only freshly created target columns are replaced; there are no operational cards.
  delete from public.kanban_columns where tenant_id = target_id and board_id = board_id_new;
  insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
  select target_id, board_id_new, c.name, c.position, c.automation_key
  from (values
    ('Conversas IA', 1, 'conversas_ia'),
    ('Aguardando humano', 2, 'aguardando_humano'),
    ('Verificar Sinal', 3, 'verificar_sinal'),
    ('Com humano', 4, 'com_humano'),
    ('Finalizadas', 5, 'finalizadas'),
    ('Agendamentos', 6, 'agendamentos'),
    ('Conversas abandonadas', 7, 'conversas_abandonadas')
  ) c(name, position, automation_key);

  insert into public.channels
    (tenant_id, type, name, external_id, status, credentials_ref, config, webhook_path)
  values (target_id, 'whatsapp', 'WhatsApp Clínica da Núbia', 'clinica_nubia', 'pending',
    'EVOLUTION_API_KEY_CLINICA_NUBIA_OFICIAL',
    jsonb_build_object('instance_name', 'clinica_nubia', 'phone', '5524998696802'),
    '/webhook/magia-whatsapp');

  insert into public.tenant_members (tenant_id, user_id, email, role, status)
    values (target_id, owner_id, owner_email, 'owner', 'active');
end;
$setup$;

commit;

-- Expected: owner UID above, WhatsApp pending, 7 columns, 0 events and 0 appointments.
select t.slug, tm.user_id, tm.email, tm.role, c.type as channel, c.status as channel_status,
  c.external_id as evolution_instance, c.config->>'phone' as phone,
  (select count(*) from public.tenant_service_catalog s where s.tenant_id = t.id) as services,
  (select count(*) from public.kanban_columns k where k.tenant_id = t.id) as kanban_columns,
  (select count(*) from public.channel_events e where e.tenant_slug = t.slug) as events,
  (select count(*) from public.appointments a where a.tenant_id = t.id) as appointments
from public.tenants t
join public.tenant_members tm on tm.tenant_id = t.id
join public.channels c on c.tenant_id = t.id
where t.slug = 'clinica_nubia_oficial';
