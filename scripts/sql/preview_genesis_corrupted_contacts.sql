-- =============================================================================
-- NORIA — PREVIEW SOMENTE-LEITURA: nomes corrompidos da Gênesis Automóveis
-- Recalcule imediatamente antes de qualquer escrita. Não contém DML.
-- =============================================================================

WITH corrupted_contacts AS (
  SELECT c.id AS contact_id, c.tenant_id, c.name AS current_name, c.phone,
         c.external_handle, c.created_at AS contact_created_at,
         c.updated_at AS contact_updated_at, c.metadata AS contact_metadata,
         COALESCE(c.metadata->>'whatsapp_owner_saved', 'false') = 'true' AS is_owner_saved
  FROM public.contacts c
  WHERE c.tenant_id = '74b57037-9349-4a9e-889c-b65fb63c983a'
    AND c.deleted_at IS NULL
    AND c.source_channel = 'whatsapp'
    AND lower(regexp_replace(trim(coalesce(c.name, '')), '\s+', ' ', 'g')) = 'gênesis automóveis'
    AND nullif(trim(c.external_handle), '') IS NOT NULL
    AND c.external_handle !~* '@(g\.us|broadcast)$'
),
all_inbound_events AS (
  SELECT cc.contact_id, count(*) AS total_inbound_events
  FROM corrupted_contacts cc
  JOIN public.channel_events ce
    ON ce.tenant_id = cc.tenant_id
   AND ce.channel_type = 'whatsapp'
   AND ce.external_conversation_id = cc.external_handle
  WHERE ce.direction = 'inbound' AND ce.sender_type = 'contact'
  GROUP BY cc.contact_id
),
inbound_evidences AS (
  SELECT cc.contact_id, ce.external_conversation_id,
         regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g') AS cleaned_name,
         lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) AS normalized_name,
         ce.id AS event_id, ce.created_at AS event_created_at
  FROM corrupted_contacts cc
  JOIN public.channel_events ce
    ON ce.tenant_id = cc.tenant_id
   AND ce.channel_type = 'whatsapp'
   AND ce.external_conversation_id = cc.external_handle
  WHERE ce.direction = 'inbound'
    AND ce.sender_type = 'contact'
    AND nullif(trim(ce.contact_name), '') IS NOT NULL
    AND length(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) >= 2
    AND ce.contact_name !~ '^\+?[0-9@._ -]+$'
    AND ce.contact_name !~ '^[\s._\-–—]+$'
    -- PostgreSQL uses \m / \M for word boundaries.  Reject only identities
    -- demonstrably commercial, not a human such as “Wesley Silva”.
    AND lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) !~
      '(?i)^\m(?:g[eê]nesis(?:\s+(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto))?|wesley\s+(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)|wesley_automoveis)\M$'
    AND lower(regexp_replace(trim(ce.contact_name), '\s+', ' ', 'g')) !~
      '(?i)^\m(?:atendente|operador(?:a)?|suporte|sac|central(?:\s+de\s+atendimento)?|sistema|administrador|admin|bot|rob[oô]|noria|whatsapp)\M$'
),
aggregated_candidates AS (
  SELECT contact_id,
         count(DISTINCT normalized_name) AS distinct_names_count,
         array_agg(DISTINCT cleaned_name ORDER BY cleaned_name) AS candidate_names,
         (array_agg(cleaned_name ORDER BY event_created_at DESC, event_id DESC))[1] AS newest_candidate_name,
         (array_agg(event_id ORDER BY event_created_at DESC, event_id DESC))[1] AS newest_evidence_event_id
  FROM inbound_evidences
  GROUP BY contact_id
)
SELECT cc.contact_id, cc.external_handle, cc.phone, cc.current_name, cc.is_owner_saved,
       coalesce(aie.total_inbound_events, 0) AS total_inbound_events,
       coalesce(ac.distinct_names_count, 0) AS distinct_valid_inbound_names,
       ac.newest_candidate_name AS suggested_name,
       ac.newest_evidence_event_id AS evidence_event_id, ac.candidate_names,
       CASE
         WHEN cc.is_owner_saved THEN 'MANUAL_REVIEW_OWNER_SAVED'
         WHEN ac.distinct_names_count = 1 THEN 'SAFE_RECOVERABLE'
         WHEN ac.distinct_names_count > 1 THEN 'AMBIGUOUS_MULTIPLE_NAMES'
         WHEN coalesce(aie.total_inbound_events, 0) > 0 THEN 'NO_VALID_INBOUND_NAME'
         ELSE 'NO_INBOUND_EVENTS'
       END AS recovery_classification
FROM corrupted_contacts cc
LEFT JOIN all_inbound_events aie ON aie.contact_id = cc.contact_id
LEFT JOIN aggregated_candidates ac ON ac.contact_id = cc.contact_id
ORDER BY recovery_classification, cc.contact_created_at DESC;
