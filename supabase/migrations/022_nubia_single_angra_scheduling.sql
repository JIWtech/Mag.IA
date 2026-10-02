-- Clínica da Núbia: uma única unidade operacional e uma única fonte de prompt.
-- Publicar primeiro o Core compativel com unidade unica. Requer migration 018.
begin;

do $$
declare
  nubia_tenant_id uuid;
  current_settings jsonb;
  angra_unit jsonb;
  angra_location jsonb;
  current_prompt text;
  updated_prompt text;
  live_unit_instruction constant text :=
    'O atendimento presencial e exclusivamente em Angra dos Reis. Se a cliente pedir outra cidade, informe com gentileza que atendemos somente em Angra dos Reis. Use state.unit_id "angra" e unit_evidence apenas quando a cliente mencionar Angra, Nova Angra ou a unidade. Nunca suponha unidade pelo DDD, perfil ou endereco de outra pessoa.';
  legacy_unit_instruction constant text :=
    'Antes de conduzir o agendamento, pergunte em qual regiao a cliente quer atendimento: Angra dos Reis ou Rio. Se ela ja informou, nao pergunte novamente. As agendas sao independentes. Nunca suponha unidade pelo DDD, perfil ou endereco de outra pessoa. Use state.unit_id (angra ou rio) e unit_evidence com o ID da mensagem da cliente. A referencia do Rio deve ser informada exatamente como cadastrada, sem completar rua, numero ou bairro.';
  single_unit_instruction constant text :=
    'A Clínica atende somente em Angra dos Reis. Não pergunte região ou unidade e não cite Rio ou Salão Esthefany Campos. Para qualquer agendamento, use state.unit_id="angra" e deixe unit_evidence vazio: a unidade é um fato do sistema e não precisa de evidência textual da cliente.';
begin
  select id into nubia_tenant_id
  from public.tenants
  where slug = 'clinica_nubia_oficial'
    and status = 'active'
    and deleted_at is null;

  if nubia_tenant_id is null then
    raise exception 'Tenant clinica_nubia_oficial ativo não encontrado';
  end if;

  select settings into current_settings
  from public.tenant_settings
  where tenant_id = nubia_tenant_id
  for update;

  if current_settings is null
    or current_settings->>'whatsapp_processing_mode' is distinct from 'conversation_core_v1'
    or current_settings->>'grounding_mode' is distinct from 'canonical_v2' then
    raise exception 'Configuração canonical_v2/conversation_core_v1 da Núbia não encontrada';
  end if;

  angra_unit := current_settings #> '{appointment_scheduling,units,angra}';
  angra_location := (
    select location
    from jsonb_array_elements(coalesce(current_settings #> '{business_facts,locations}', '[]'::jsonb)) location
    where location->>'id' = 'angra'
      and location->>'verified' = 'true'
    limit 1
  );

  if angra_unit is null or angra_location is null then
    raise exception 'Unidade ou endereço verificado de Angra não encontrado';
  end if;

  current_prompt := coalesce(current_settings->>'system_prompt', '');
  if position(legacy_unit_instruction in current_prompt) = 0
    and position(live_unit_instruction in current_prompt) = 0
    and position(single_unit_instruction in current_prompt) = 0 then
    raise exception 'Trecho legado de unidades não encontrado no system_prompt; revisão manual necessária';
  end if;
  updated_prompt := replace(current_prompt, legacy_unit_instruction, single_unit_instruction);
  updated_prompt := replace(updated_prompt, live_unit_instruction, single_unit_instruction);
  updated_prompt := replace(updated_prompt,
    E'Colete e confirme, usando somente dados informados pela cliente:\n1. unidade;\n2. servico;\n3. data;\n4. horario;\n5. nome completo.',
    E'A unidade angra e definida pelo sistema e nao exige confirmacao.\nColete e confirme, usando somente dados informados pela cliente:\n1. servico;\n2. data;\n3. horario;\n4. nome completo.');
  updated_prompt := replace(updated_prompt, 'algum desses cinco dados estiver vazio', 'algum desses quatro dados estiver vazio');
  updated_prompt := replace(updated_prompt,
    'Use action=create_appointment somente quando unidade, servico, data, horario e nome completo estiverem preenchidos e sustentados por mensagens da cliente.',
    'Use action=create_appointment somente quando servico, data, horario e nome completo estiverem sustentados por mensagens da cliente; a unidade angra vem da configuracao.');

  update public.tenant_settings
  set settings = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(current_settings, '{appointment_scheduling,units}', jsonb_build_object('angra', angra_unit), true),
          '{business_facts,locations}', jsonb_build_array(angra_location), true
        ),
        '{system_prompt}', to_jsonb(updated_prompt), true
      ),
      '{prompt_revision}', to_jsonb('nubia-2026-09-29-angra-sessoes-v5'::text), true
    ),
    updated_at = now()
  where tenant_id = nubia_tenant_id;

  -- canonical_v2 não consulta estas versões. Elas ficam desativadas para que
  -- nenhum fluxo legado volte a usar regras ou dados de pagamento obsoletos.
  update public.ai_prompt_versions
  set active = false
  where tenant_id = nubia_tenant_id
    and active = true;
end $$;

-- Conferência após a execução: uma unidade, um endereço e nenhuma versão legada ativa.
select
  settings->>'prompt_revision' as prompt_revision,
  jsonb_object_keys(settings #> '{appointment_scheduling,units}') as unit_id,
  locations.location->>'id' as location_id,
  (select count(*) from public.ai_prompt_versions p where p.tenant_id = s.tenant_id and p.active) as active_legacy_prompts
from public.tenant_settings s
cross join lateral jsonb_array_elements(s.settings #> '{business_facts,locations}') locations(location)
where s.tenant_id = (
  select id from public.tenants where slug = 'clinica_nubia_oficial' and deleted_at is null
);

commit;
