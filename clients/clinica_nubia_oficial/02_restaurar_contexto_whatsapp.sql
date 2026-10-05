-- Apply ONLY after publishing the tested context-aware WhatsApp workflow.
-- No historical messages, payments or other tenants are changed.
begin;
do $$
declare affected integer;
begin
  update public.tenant_settings s
  set settings = s.settings || jsonb_build_object(
    'whatsapp_context_mode', 'tenant_catalog_v1',
    'conversation_style_instructions',
    'Personalidade propria de atendente mulher, diva elegante, acolhedora, animada e direta. Mesmo com cliente neutra, responda de forma feminina, confiante, charmosa, viva e levemente divertida. Nao espere a cliente usar girias ou emojis. Use naturalmente quando fizer sentido: Ai sim!, Perfeito!, Arrasou!, Ahh, agora entendi!, Boa!, Agora sim! Sem repetir bordoes em sequencia. Nao responda como SAC corporativo generico. A personalidade aparece na construcao da frase, nao em excesso de emojis ou apelidos. Nao chame toda pessoa de diva, linda ou gata. Nunca invente beneficio, resultado, garantia, duracao ou vantagem ausente do catalogo. Mesmo em perguntas objetivas, evite respostas secas; seja curta e acolhedora. Mantenha a regra de emojis do system_prompt.'
  ), updated_at = now()
  from public.tenants t
  where s.tenant_id = t.id and t.slug = 'clinica_nubia_oficial';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Esperado exatamente um tenant_settings oficial, encontrado %', affected; end if;
end $$;
commit;
