const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const settings = {
  attendance_lifecycle: 'session_v2',
  prompt_revision: 'nubia-2026-09-26-sessoes-v4',
  system_prompt: fs.readFileSync(path.join(root, 'clients/clinica_nubia_oficial/prompt_canonico_v2.txt'), 'utf8').trim(),
};
const sql = `-- Generated: node scripts/build_nubia_session_sql.cjs
-- Publicar primeiro o workflow atualizado. Executar migration 019 antes deste arquivo.
-- Preserva catalogo, reservas, pagamento, modelo, limite diario e outros clientes.
begin;
do $$
declare affected integer;
begin
  if to_regprocedure('public.magia_reserve_session_appointment(uuid,text,text,date,time without time zone,text,text,text,text,text,text)') is null
    then raise exception 'Execute migration 019 primeiro'; end if;
  update public.tenant_settings s set settings = s.settings || $session$${JSON.stringify(settings, null, 2)}$session$::jsonb, updated_at=now()
  from public.tenants t where t.id=s.tenant_id and t.slug='clinica_nubia_oficial' and t.status='active'
    and s.settings->>'grounding_mode'='canonical_v2'
    and s.settings->>'whatsapp_processing_mode'='conversation_core_v1';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Tenant/core oficial nao encontrado'; end if;
end $$;
commit;
`;
fs.writeFileSync(path.join(root, 'clients/clinica_nubia_oficial/06_sessoes_independentes.sql'), sql);
console.log('Generated official clinic session activation SQL.');
