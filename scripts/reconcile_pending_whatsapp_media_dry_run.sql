-- READ ONLY. Run against production only for review; it never updates data.
-- Candidates require same tenant, exact sanitized conversation/message path,
-- a single unreferenced object, and a coherent size before any future backfill.
with pending as (
  select e.id, e.tenant_id, e.tenant_slug, e.channel_type,
         e.external_conversation_id, e.external_message_id, e.created_at,
         e.raw_payload->'media' as media
  from public.channel_events e
  where e.tenant_slug = 'wesley_automoveis'
    and e.raw_payload->'media'->>'status' = 'pending'
), matched as (
  select p.*, o.bucket_id, o.name, o.metadata->>'size' as object_size,
         o.metadata->>'mimetype' as object_mime,
         count(*) over (partition by p.id) as object_matches,
         count(*) filter (where other.id is not null) over (partition by p.id) as conflicting_references
  from pending p
  left join storage.objects o on o.bucket_id = 'channel-media'
    and o.name like 'wesley_automoveis/whatsapp/'
      || regexp_replace(p.external_conversation_id, '[^a-zA-Z0-9._-]', '_', 'g') || '/'
      || regexp_replace(p.external_message_id, '[^a-zA-Z0-9._-]', '_', 'g') || '.%'
  left join public.channel_events other on other.id <> p.id
    and other.raw_payload->'media'->>'storagePath' = o.name
)
select id as event_id, tenant_slug, channel_type,
       md5(external_conversation_id) as conversation_fingerprint,
       md5(external_message_id) as message_fingerprint,
       media->>'kind' as media_kind, media->>'status' as previous_status,
       bucket_id, object_size, object_mime, object_matches, conflicting_references,
       case when bucket_id is not null and object_matches = 1 and conflicting_references = 0
                 and coalesce(nullif(object_size, '')::bigint, 0) > 0
            then 'stored' else 'blocked' end as proposed_status
from matched
order by created_at;
