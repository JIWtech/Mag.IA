-- Migration 029: Self-Service Tenant Onboarding & RLS Policies
-- Permite que novos usuários criem seu tenant, membros, funil kanban, canal e configurações de IA de forma 100% autônoma.

begin;

-- 1. Políticas RLS de Leitura e Edição para tenant_settings por membros autenticados
drop policy if exists "tenant_settings_select_member" on public.tenant_settings;
create policy "tenant_settings_select_member"
on public.tenant_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "tenant_settings_update_member" on public.tenant_settings;
create policy "tenant_settings_update_member"
on public.tenant_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_settings.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin')
  )
);

-- 2. Políticas RLS para channels por membros autenticados
drop policy if exists "channels_select_member" on public.channels;
create policy "channels_select_member"
on public.channels
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = channels.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

drop policy if exists "channels_update_member" on public.channels;
create policy "channels_update_member"
on public.channels
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = channels.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin')
  )
);

-- 3. Função RPC de Onboarding Atômico de Tenant
create or replace function public.magia_create_tenant_onboarding(
  p_company_name text,
  p_segment text default 'general_services',
  p_tone text default 'consultative',
  p_business_facts text default '',
  p_catalog_highlights text default '',
  p_custom_rules text default '',
  p_system_prompt text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_tenant_id uuid;
  v_base_slug text;
  v_slug text;
  v_board_id uuid;
  v_channel_id uuid;
  v_capability text;
  v_profile text;
  v_policy jsonb;
  v_final_prompt text;
  v_settings jsonb;
begin
  -- 1. Verificar autenticação
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if trim(coalesce(p_company_name, '')) = '' then
    raise exception 'COMPANY_NAME_REQUIRED';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  -- 2. Gerar Slug Único e Limpo
  v_base_slug := lower(regexp_replace(trim(p_company_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_base_slug := trim(both '_' from v_base_slug);
  if length(v_base_slug) = 0 then
    v_base_slug := 'empresa_' || substr(md5(random()::text), 1, 6);
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := v_base_slug || '_' || substr(md5(random()::text), 1, 4);
  end loop;

  -- 3. Determinar Perfil e Capacidade
  if p_segment in ('vehicle_sales') then
    v_capability := 'sales_v1';
    v_profile := 'vehicle_sales_v1';
  elsif p_segment in ('retail_sales') then
    v_capability := 'sales_v1';
    v_profile := 'vehicle_sales_v1'; -- Usa motor comercial sales_v1
  elsif p_segment in ('aesthetic_clinic') then
    v_capability := 'standard';
    v_profile := 'nb_bronze_v1';
  else
    v_capability := 'standard';
    v_profile := 'general_services_v1';
  end if;

  -- 4. Criar Tenant
  insert into public.tenants (name, slug, industry, plan, status)
  values (trim(p_company_name), v_slug, p_segment, 'mvp', 'active')
  returning id into v_tenant_id;

  -- 5. Vincular Usuário como Owner
  insert into public.tenant_members (tenant_id, user_id, email, role, status)
  values (v_tenant_id, v_user_id, v_user_email, 'owner', 'active');

  -- 6. Criar Funil Kanban Padrão
  insert into public.kanban_boards (tenant_id, name, is_default)
  values (v_tenant_id, 'Funil de Atendimento Principal', true)
  returning id into v_board_id;

  -- 7. Criar Colunas Operacionais Reais (Estrutura idêntica à produção de alta performance)
  if v_capability = 'sales_v1' then
    -- Funil Comercial Completo (padrão Wesley Automóveis / Vendas)
    insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
    values
      (v_tenant_id, v_board_id, 'Novos contatos', 1, 'sales_new'),
      (v_tenant_id, v_board_id, 'IA - Qualificação', 2, 'sales_qualifying'),
      (v_tenant_id, v_board_id, 'Leads quentes', 3, 'sales_hot'),
      (v_tenant_id, v_board_id, 'Avaliação / Troca', 4, 'sales_appraisal'),
      (v_tenant_id, v_board_id, 'Fila de negociação', 5, 'sales_financing'),
      (v_tenant_id, v_board_id, 'Atendimento humano', 6, 'sales_human'),
      (v_tenant_id, v_board_id, 'Negócio fechado', 7, 'sales_closed'),
      (v_tenant_id, v_board_id, 'Follow Ups', 8, 'follow_ups');
  else
    -- Funil de Agendamentos & Atendimento Completo (padrão Clínica Núbia / Serviços)
    insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
    values
      (v_tenant_id, v_board_id, 'Conversas IA', 1, 'conversas_ia'),
      (v_tenant_id, v_board_id, 'Aguardando humano', 2, 'aguardando_humano'),
      (v_tenant_id, v_board_id, 'Verificar Sinal', 3, 'verificar_sinal'),
      (v_tenant_id, v_board_id, 'Em atendimento humano', 4, 'com_humano'),
      (v_tenant_id, v_board_id, 'Finalizadas', 5, 'finalizadas'),
      (v_tenant_id, v_board_id, 'Agendamentos', 6, 'agendamentos'),
      (v_tenant_id, v_board_id, 'Conversas abandonadas', 7, 'conversas_abandonadas'),
      (v_tenant_id, v_board_id, 'Follow Ups', 8, 'follow_ups');
  end if;

  -- 8. Criar Canal WhatsApp Inicial (Pendente de Conexão de Instância)
  insert into public.channels (tenant_id, type, name, status, config)
  values (
    v_tenant_id,
    'whatsapp',
    'WhatsApp Principal',
    'pending',
    jsonb_build_object('auto_created', true, 'created_at', now())
  )
  returning id into v_channel_id;

  -- 9. Política Noria para n8n
  v_policy := jsonb_build_object(
    'contract', 'noria_policy_v2',
    'tenant_id', v_tenant_id,
    'tenant_slug', v_slug,
    'profile', v_profile,
    'capability', v_capability,
    'audio_enabled', false,
    'scheduling_enabled', true,
    'modules', jsonb_build_object(
      'qualification', true,
      'kanban_source', 'tenant_settings.sales.stage_keys',
      'policies_source', 'tenant_settings.sales + tenant_settings.sdr_rules'
    )
  );

  -- 10. Prompt do Sistema
  if p_system_prompt is not null and length(trim(p_system_prompt)) > 20 then
    v_final_prompt := trim(p_system_prompt);
  else
    v_final_prompt := '# Assistente Virtual - ' || trim(p_company_name) || E'\n\n'
      || 'Você é a assistente de atendimento inteligente da ' || trim(p_company_name) || E'.\n'
      || 'Seu objetivo é acolher clientes, tirar dúvidas com cordialidade e conduzir para atendimento ou agendamento.' || E'\n\n'
      || '## Informações do Negócio' || E'\n' || coalesce(nullif(p_business_facts, ''), 'Atendimento especializado com foco no cliente.') || E'\n\n'
      || '## Destaques' || E'\n' || coalesce(nullif(p_catalog_highlights, ''), 'Consulte nossos serviços e condições especiais.') || E'\n\n'
      || '## Regras Importantes' || E'\n' || coalesce(nullif(p_custom_rules, ''), 'Sempre responda de forma educada, clara e objetiva.');
  end if;

  -- 11. Montar Settings JSON
  v_settings := jsonb_build_object(
    'ai_enabled', true,
    'ai_model', 'gemini-3.5-flash-lite',
    'ai_provider', 'gemini',
    'conversation_capability', v_capability,
    'whatsapp_processing_mode', 'conversation_core_v1',
    'system_prompt', v_final_prompt,
    'prompt_revision', 'saas-auto-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    'noria_client_policy', v_policy,
    'tone', p_tone,
    'debounce_window_ms', 25000,
    'fragment_debounce_window_ms', 12000,
    'enabled_channels', jsonb_build_array('whatsapp'),
    'business_facts', jsonb_build_object(
      'summary', p_business_facts,
      'catalog', p_catalog_highlights
    ),
    'onboarding_status', 'completed',
    'onboarding_created_at', now()
  );

  insert into public.tenant_settings (tenant_id, timezone, settings)
  values (v_tenant_id, 'America/Sao_Paulo', v_settings);

  -- 12. Retornar Resumo Estruturado
  return jsonb_build_object(
    'ok', true,
    'tenant', jsonb_build_object(
      'id', v_tenant_id,
      'slug', v_slug,
      'name', trim(p_company_name),
      'industry', p_segment,
      'plan', 'mvp',
      'status', 'active'
    ),
    'board_id', v_board_id,
    'channel_id', v_channel_id,
    'prompt_chars', length(v_final_prompt)
  );
end;
$$;

-- 13. Permissões de Execução
revoke all on function public.magia_create_tenant_onboarding from public;
grant execute on function public.magia_create_tenant_onboarding to authenticated;

commit;

notify pgrst, 'reload schema';
