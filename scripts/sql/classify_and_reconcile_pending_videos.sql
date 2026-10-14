-- =============================================================================
-- NORIA — AUDITORIA E RECUPERAÇÃO CONTROLADA DE VÍDEOS (SOMENTE LEITURA)
-- Não executa download, update ou marca indisponibilidade automaticamente.
-- =============================================================================

WITH videos AS (
  SELECT ce.*,
    coalesce(ce.raw_payload->'media'->>'status', ce.raw_payload->>'status', 'sem_status') AS media_status,
    nullif(ce.raw_payload->'media'->>'storagePath', '') AS storage_path,
    coalesce(nullif(ce.raw_payload->'media'->>'size', '')::bigint, 0) AS media_size
  FROM public.channel_events ce
  WHERE ce.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'
    AND ce.channel_type = 'whatsapp'
    -- Este predicado é obrigatório também em toda escrita abaixo.
    AND (ce.raw_payload->'media'->>'kind' = 'video'
      OR ce.raw_payload->>'content_type' = 'video'
      OR ce.raw_payload->'source_media'->>'kind' = 'video'
      OR ce.raw_payload->'data'->'message' ? 'videoMessage')
)
SELECT media_status, direction, sender_type, count(*) AS total_eventos,
       min(created_at) AS evento_mais_antigo, max(created_at) AS evento_mais_recente
FROM videos GROUP BY 1, 2, 3 ORDER BY total_eventos DESC;

-- Prévia exata da fila de recuperação: estes continuam pending para permitir
-- reprocessamento pela infraestrutura; idade não é evidência de perda.
WITH videos AS (
  SELECT ce.*, nullif(ce.raw_payload->'media'->>'storagePath', '') AS storage_path,
    coalesce(nullif(ce.raw_payload->'media'->>'size', '')::bigint, 0) AS media_size
  FROM public.channel_events ce
  WHERE ce.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a' AND ce.channel_type = 'whatsapp'
    AND (ce.raw_payload->'media'->>'kind' = 'video' OR ce.raw_payload->>'content_type' = 'video'
      OR ce.raw_payload->'source_media'->>'kind' = 'video' OR ce.raw_payload->'data'->'message' ? 'videoMessage')
)
SELECT id AS event_id, external_conversation_id AS chat_id, external_message_id, contact_name,
       created_at, now() - created_at AS age, raw_payload->'media'->>'status' AS media_status,
       media_size, storage_path, raw_payload->'media'->>'bucket' AS bucket,
       raw_payload->'media'->>'verified' AS verified, raw_payload->'media'->>'error' AS last_error,
       CASE WHEN id IS NULL THEN 'INVALID_EVENT_ID'
            WHEN external_message_id IS NULL OR btrim(external_message_id) = '' THEN 'MISSING_EVOLUTION_REFERENCE'
            WHEN created_at >= now() - interval '24 hours' THEN 'WAIT_FOR_INGESTION'
            WHEN storage_path IS NOT NULL OR media_size > 0 THEN 'VERIFY_STORAGE_BEFORE_RETRY'
            ELSE 'ELIGIBLE_FOR_REPROCESSING' END AS recovery_action
FROM videos
WHERE raw_payload->'media'->>'status' = 'pending'
ORDER BY created_at DESC;

/*
-- Escrita autorizada 1: a fila/worker de reprocessamento deve usar event_id,
-- external_message_id e o identificador Evolution preservados acima. Só ela pode
-- gravar media.recovery_attempted_at / media.recovery_outcome após a tentativa.
-- Não baixe mídias manualmente neste script.

-- Escrita autorizada 2, definitiva: somente após uma tentativa registrada ter
-- confirmado que a fonte Evolution não existe mais. Nunca por idade isoladamente.
BEGIN;
DO $$
BEGIN
  IF current_setting('noria.video_reconciliation_authorized', true) <> '2026-10-14' THEN
    RAISE EXCEPTION 'Defina SET LOCAL noria.video_reconciliation_authorized = 2026-10-14 somente após autorização explícita';
  END IF;
END $$;
UPDATE public.channel_events ce
SET raw_payload = jsonb_set(jsonb_set(jsonb_set(coalesce(ce.raw_payload, '{}'::jsonb),
      '{media,status}', '"unavailable"'), '{media,error}', '"evolution_source_unavailable_confirmed"'),
      '{media,reconciled_at}', to_jsonb(now()::text))
WHERE ce.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'
  AND ce.channel_type = 'whatsapp'
  AND (ce.raw_payload->'media'->>'kind' = 'video'
    OR ce.raw_payload->>'content_type' = 'video'
    OR ce.raw_payload->'source_media'->>'kind' = 'video'
    OR ce.raw_payload->'data'->'message' ? 'videoMessage')
  AND ce.raw_payload->'media'->>'status' = 'pending'
  AND ce.created_at < now() - interval '24 hours'
  AND nullif(ce.raw_payload->'media'->>'storagePath', '') IS NULL
  AND coalesce(nullif(ce.raw_payload->'media'->>'size', '')::bigint, 0) = 0
  AND ce.raw_payload->'media'->>'recovery_outcome' = 'source_unavailable_confirmed';
-- Inspect the returned count/rows; COMMIT requires separate explicit approval.
ROLLBACK;
*/
