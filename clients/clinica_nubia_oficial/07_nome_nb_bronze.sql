-- Executar apenas este patch para corrigir o nome comercial vigente.
-- Nao reaplicar setups antigos: eles podem substituir regras personalizadas.
-- Nao exige publicacao de workflow. Preserva slug, canais, agenda e historico.
begin;
do $$
declare
  tid uuid;
  current_settings jsonb;
  current_prompt text;
  revision text;
  identity_rule constant text := 'IDENTIDADE COMERCIAL NB BRONZE: Use sempre NB Bronze como nome comercial, inclusive quando o historico ou a cliente usar um nome antigo. Nubia e o nome da responsavel, nao o nome comercial.';
begin
  select id into strict tid from public.tenants
    where slug='clinica_nubia_oficial' and status='active' and deleted_at is null
    for update;
  select settings into strict current_settings from public.tenant_settings
    where tenant_id=tid for update;
  if current_settings->>'grounding_mode' is distinct from 'canonical_v2'
    or current_settings->>'whatsapp_processing_mode' is distinct from 'conversation_core_v1'
    or nullif(btrim(current_settings->>'system_prompt'),'') is null then
    raise exception 'Configuracao canonica oficial nao encontrada; nenhuma alteracao aplicada';
  end if;
  if current_settings ? 'business_facts'
    and jsonb_typeof(current_settings->'business_facts') <> 'object' then
    raise exception 'business_facts deve ser um objeto; revisar antes de aplicar';
  end if;

  current_prompt := regexp_replace(current_settings->>'system_prompt',
    U&'Cl[i\00ED]nica[[:space:]]+(da[[:space:]]+)?N[u\00FA]bia', 'NB Bronze', 'gi');
  if position(identity_rule in current_prompt)=0 then
    current_prompt := current_prompt || E'\n\n' || identity_rule;
  end if;
  -- Exclui respostas antigas da selecao de contexto verificado, sem apagar eventos.
  revision := coalesce(nullif(current_settings->>'prompt_revision',''),'canonical_v2');
  if right(revision,length('-nb-bronze-v1')) <> '-nb-bronze-v1' then
    revision := revision || '-nb-bronze-v1';
  end if;
  update public.tenant_settings set settings=current_settings || jsonb_build_object(
    'system_prompt',current_prompt,
    'prompt_revision',revision,
    'business_facts',coalesce(current_settings->'business_facts','{}'::jsonb)
      || jsonb_build_object('name','NB Bronze')),
    updated_at=now() where tenant_id=tid;
  update public.tenants set name='NB Bronze' where id=tid;
end $$;
commit;

-- Conferencia sem expor o prompt completo ou dados de clientes.
select t.slug,t.name,s.settings->'business_facts'->>'name' as business_name,
  s.settings->>'prompt_revision' as prompt_revision,
  (s.settings->>'system_prompt' ~* U&'Cl[i\00ED]nica[[:space:]]+(da[[:space:]]+)?N[u\00FA]bia') as prompt_tem_nome_antigo
from public.tenants t join public.tenant_settings s on s.tenant_id=t.id
where t.slug='clinica_nubia_oficial';
