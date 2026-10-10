-- PENDING REVIEW / NOT APPLIED. Scope an Evolution message identity to the
-- tenant, WhatsApp channel and provider instance. This prevents a coincidental
-- provider message id from one instance suppressing a legitimate event in a
-- different instance, while retaining the historical fallback for rows with no
-- instance audit metadata.
begin;

alter table public.channel_events
  add column if not exists provider_instance text generated always as (
    nullif(coalesce(raw_payload->'provider_event'->>'instance', raw_payload->>'provider_instance'), '')
  ) stored;

drop index if exists public.channel_events_external_message_unique;

create unique index if not exists channel_events_provider_message_unique
  on public.channel_events (
    tenant_slug,
    channel_type,
    coalesce(provider_instance, ''),
    external_message_id
  )
  where external_message_id is not null;

create index if not exists channel_events_instance_conversation_created_idx
  on public.channel_events (tenant_id, channel_type, provider_instance, external_conversation_id, created_at desc);

commit;
