-- =============================================================================
-- NORIA — RECUPERAÇÃO CONTROLADA DE NOMES (NÃO EXECUTAR SEM AUTORIZAÇÃO)
--
-- Este arquivo não faz escrita ao ser aberto/executado por acidente: a operação
-- de aplicação está comentada e deve ser liberada somente após uma preview nova.
-- Não cria cópia de PII em public. O backup persistente exige uma tabela de
-- auditoria privada já provisionada pelo administrador, com RLS/grants/retenção.
-- =============================================================================

-- PASSO 1 (somente leitura): execute preview_genesis_corrupted_contacts.sql.
-- Aplique somente linhas SAFE_RECOVERABLE da prévia recalculada na mesma janela.

/*
-- PASSO 2 (escrita autorizada, transacional e reversível).
-- Pré-requisito administrativo, fora deste script:
--   private_ops.contact_name_recovery_audit(
--     run_id uuid, contact_id uuid, tenant_id uuid, original_name text,
--     original_metadata jsonb, recovered_name text, evidence_event_id uuid,
--     backed_up_at timestamptz, reverted_at timestamptz null,
--     primary key (run_id, contact_id)
--   )
-- A tabela deve ter RLS habilitada, sem grants para anon/authenticated, acesso
-- somente ao role operacional aprovado e uma política de retenção definida.

BEGIN;
SET LOCAL TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF current_setting('noria.contact_recovery_authorized', true) <> '2026-10-14' THEN
    RAISE EXCEPTION 'Defina SET LOCAL noria.contact_recovery_authorized = 2026-10-14 somente após autorização explícita';
  END IF;
  IF to_regclass('private_ops.contact_name_recovery_audit') IS NULL THEN
    RAISE EXCEPTION 'Tabela privada de auditoria ausente; não gravar backup em public';
  END IF;
END $$;

CREATE TEMP TABLE recovery_candidates ON COMMIT DROP AS
WITH corrupted_contacts AS (
  SELECT c.id AS contact_id, c.tenant_id, c.external_handle, c.name, c.metadata
  FROM public.contacts c
  WHERE c.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'
    AND c.deleted_at IS NULL AND c.source_channel = 'whatsapp'
    AND lower(regexp_replace(trim(coalesce(c.name, '')), '\s+', ' ', 'g')) = 'gênesis automóveis'
    AND nullif(trim(c.external_handle), '') IS NOT NULL
    AND c.external_handle !~* '@(g\.us|broadcast)$'
    AND COALESCE(c.metadata->>'whatsapp_owner_saved', 'false') <> 'true'
), valid_inbounds AS (
  SELECT cc.contact_id, regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g') AS candidate_name,
         lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) AS normalized_name,
         ce.id AS event_id, ce.created_at
  FROM corrupted_contacts cc JOIN public.channel_events ce
    ON ce.tenant_id = cc.tenant_id AND ce.channel_type = 'whatsapp'
   AND ce.external_conversation_id = cc.external_handle
  WHERE ce.direction = 'inbound' AND ce.sender_type = 'contact'
    AND nullif(trim(ce.contact_name), '') IS NOT NULL
    AND length(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) >= 2
    AND ce.contact_name !~ '^\+?[0-9@._ -]+$' AND ce.contact_name !~ '^[\s._\-–—]+$'
    AND lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) !~ '(?i)^\m(?:g[eê]nesis(?:\s+(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto))?|wesley\s+(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)|wesley_automoveis)\M$'
    AND lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) !~ '(?i)^\m(?:atendente|operador(?:a)?|suporte|sac|central(?:\s+de\s+atendimento)?|sistema|administrador|admin|bot|rob[oô]|noria|whatsapp)\M$'
), unambiguous AS (
  SELECT contact_id, count(DISTINCT normalized_name) AS names_count,
         (array_agg(candidate_name ORDER BY created_at DESC, event_id DESC))[1] AS recovered_name,
         (array_agg(event_id ORDER BY created_at DESC, event_id DESC))[1] AS evidence_event_id
  FROM valid_inbounds GROUP BY contact_id
)
SELECT cc.contact_id, cc.tenant_id, cc.name AS original_name, cc.metadata AS original_metadata,
       u.recovered_name, u.evidence_event_id
FROM corrupted_contacts cc JOIN unambiguous u ON u.contact_id = cc.contact_id
WHERE u.names_count = 1;

-- A prévia exata das linhas que a escrita abaixo atingirá.
SELECT * FROM recovery_candidates ORDER BY contact_id;

-- Troque este UUID por um novo UUID de execução, registrado no change ticket.
WITH run AS (SELECT '00000000-0000-0000-0000-000000000000'::uuid AS run_id), backup AS (
  INSERT INTO private_ops.contact_name_recovery_audit
    (run_id, contact_id, tenant_id, original_name, original_metadata, recovered_name, evidence_event_id, backed_up_at)
  SELECT run.run_id, r.contact_id, r.tenant_id, r.original_name, r.original_metadata,
         r.recovered_name, r.evidence_event_id, now()
  FROM recovery_candidates r CROSS JOIN run
  RETURNING contact_id
), updated AS (
  UPDATE public.contacts c SET name = r.recovered_name,
    metadata = jsonb_set(jsonb_set(jsonb_set(coalesce(c.metadata, '{}'::jsonb),
      '{name_recovery_source}', '"channel_events_inbound_push_name"'),
      '{name_recovery_evidence_event_id}', to_jsonb(r.evidence_event_id::text)),
      '{name_recovered_at}', to_jsonb(now()::text)), updated_at = now()
  FROM recovery_candidates r JOIN backup b ON b.contact_id = r.contact_id
  WHERE c.id = r.contact_id AND c.tenant_id = r.tenant_id
    AND lower(regexp_replace(trim(coalesce(c.name, '')), '\s+', ' ', 'g')) = 'gênesis automóveis'
    AND COALESCE(c.metadata->>'whatsapp_owner_saved', 'false') <> 'true'
  RETURNING c.id
)
SELECT (SELECT count(*) FROM recovery_candidates) AS previewed,
       (SELECT count(*) FROM backup) AS backed_up,
       (SELECT count(*) FROM updated) AS updated;

DO $$
DECLARE expected_count integer; backed_count integer; updated_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM recovery_candidates;
  SELECT count(*) INTO backed_count FROM private_ops.contact_name_recovery_audit
    WHERE run_id = '00000000-0000-0000-0000-000000000000'::uuid;
  SELECT count(*) INTO updated_count FROM public.contacts c
    JOIN private_ops.contact_name_recovery_audit a
      ON a.contact_id = c.id AND a.tenant_id = c.tenant_id
   WHERE a.run_id = '00000000-0000-0000-0000-000000000000'::uuid
     AND c.name = a.recovered_name;
  IF expected_count <> backed_count OR expected_count <> updated_count THEN
    RAISE EXCEPTION 'Recovery validation failed: expected %, backed %, updated %',
      expected_count, backed_count, updated_count;
  END IF;
END $$;

-- The default is always rollback. Only replace after the validation above returns.
ROLLBACK;

-- Rollback posterior (em nova transação autorizada; use o mesmo run_id):
-- UPDATE public.contacts c SET name = a.original_name, metadata = a.original_metadata,
--   updated_at = now()
-- FROM private_ops.contact_name_recovery_audit a
-- WHERE a.run_id = '<run-id>'::uuid AND a.contact_id = c.id
--   AND a.tenant_id = c.tenant_id AND a.reverted_at IS NULL;
-- UPDATE private_ops.contact_name_recovery_audit SET reverted_at = now()
-- WHERE run_id = '<run-id>'::uuid AND reverted_at IS NULL;
*/
