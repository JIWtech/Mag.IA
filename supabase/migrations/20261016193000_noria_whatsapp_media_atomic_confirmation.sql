-- Review-only migration: do not apply from local tooling.
create or replace function public.magia_confirm_whatsapp_media(
  p_tenant uuid, p_event uuid, p_channel text, p_conversation text,
  p_external_message text, p_media jsonb
) returns table (event_id uuid, applied boolean, reason text, stored_media jsonb)
language plpgsql security invoker set search_path = public as $$
declare
  current_raw jsonb;
  current_media jsonb;
  next_media jsonb;
  next_status text;
  object_row record;
  updated_id uuid;
  tenant_slug text;
  requested_size bigint;
  requested_mime text;
  requested_mime_base text;
  storage_mime text;
  storage_mime_base text;
  current_mime text;
  current_mime_base text;
begin
  if p_tenant is null or p_event is null or nullif(btrim(p_channel), '') is null
    or nullif(btrim(p_conversation), '') is null or nullif(btrim(p_external_message), '') is null then
    return query select p_event, false, 'invalid_identity', null::jsonb; return;
  end if;
  if p_media is null or jsonb_typeof(p_media) <> 'object' then
    return query select p_event, false, 'invalid_media_object', null::jsonb; return;
  end if;
  next_status := nullif(p_media->>'status', '');
  if next_status is null or next_status not in ('stored','storage_error','download_failed','unsupported','too_large','missing_binary','persistence_error') then
    return query select p_event, false, 'invalid_media_status', null::jsonb; return;
  end if;

  if next_status = 'stored' then
    -- Only the historical WhatsApp OGG/Opus parameter is accepted. The
    -- original MIME remains in raw_payload; these values are comparison-only.
    requested_mime := lower(regexp_replace(coalesce(p_media->>'mimeType', ''), '\s+', '', 'g'));
    requested_mime_base := split_part(requested_mime, ';', 1);
    if coalesce(p_media->>'verified', '') <> 'true' or p_media->>'bucket' <> 'channel-media'
      or coalesce(p_media->>'storagePath', '') = ''
      -- NORIA stores private WhatsApp uploads up to 10 MiB. The bounded
      -- decimal form makes the bigint cast below total and non-throwing.
      or coalesce(p_media->>'size', '') !~ '^[1-9][0-9]{0,7}$'
      or requested_mime = ''
      or not (requested_mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
        or requested_mime = 'audio/ogg;codecs=opus') then
      return query select p_event, false, 'invalid_stored_media', null::jsonb; return;
    end if;
    requested_size := (p_media->>'size')::bigint;
    if requested_size > 10485760 then
      return query select p_event, false, 'invalid_stored_media', null::jsonb; return;
    end if;
    select slug into tenant_slug from public.tenants where id = p_tenant;
    if tenant_slug is null
      or p_media->>'storagePath' !~ ('^' || regexp_replace(tenant_slug, '[^a-zA-Z0-9_-]', '', 'g') || '/') then
      return query select p_event, false, 'invalid_stored_media', null::jsonb; return;
    end if;
    select o.name,
      case when coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,8}$'
        then (o.metadata->>'size')::bigint else null end as size,
      lower(regexp_replace(coalesce(o.metadata->>'mimetype', ''), '\s+', '', 'g')) as mime
      into object_row
      from storage.objects o
      where o.bucket_id = p_media->>'bucket' and o.name = p_media->>'storagePath';
    if not found then
      return query select p_event, false, 'storage_object_missing', null::jsonb; return;
    end if;
    storage_mime := nullif(object_row.mime, '');
    storage_mime_base := split_part(coalesce(storage_mime, ''), ';', 1);
    if object_row.size is null or object_row.size <> requested_size
      or storage_mime is null
      or not (storage_mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
        or storage_mime = 'audio/ogg;codecs=opus')
      or storage_mime_base <> requested_mime_base
      or (requested_mime_base <> 'audio/ogg' and storage_mime <> requested_mime) then
      return query select p_event, false, 'storage_metadata_mismatch', null::jsonb; return;
    end if;
  end if;

  select ce.raw_payload, coalesce(ce.raw_payload->'media', '{}'::jsonb)
    into current_raw, current_media
    from public.channel_events as ce
    where ce.id = p_event and ce.tenant_id = p_tenant and ce.channel_type = p_channel
      and ce.external_conversation_id = p_conversation and ce.external_message_id = p_external_message
    for update;
  if not found then
    return query select p_event, false, 'event_scope_mismatch', null::jsonb; return;
  end if;
  if current_media->>'status' = 'stored' then
    current_mime := lower(regexp_replace(coalesce(current_media->>'mimeType', ''), '\s+', '', 'g'));
    current_mime_base := split_part(current_mime, ';', 1);
    if p_media->>'status' = 'stored'
      and current_media->>'verified' = 'true' and p_media->>'verified' = 'true'
      and current_media->>'bucket' = p_media->>'bucket'
      and current_media->>'storagePath' = p_media->>'storagePath'
      and (current_mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
        or current_mime = 'audio/ogg;codecs=opus')
      and current_mime_base = requested_mime_base
      and (requested_mime_base = 'audio/ogg' or current_mime = requested_mime)
      and coalesce(current_media->>'size', '') = coalesce(p_media->>'size', '') then
      return query select p_event, false, 'already_stored', current_media; return;
    end if;
    return query select p_event, false, 'stored_media_conflict', current_media; return;
  end if;

  next_media := current_media || p_media;
  update public.channel_events
    set raw_payload = jsonb_set(coalesce(current_raw, '{}'::jsonb), '{media}', next_media, true)
    where id = p_event and tenant_id = p_tenant and channel_type = p_channel
      and external_conversation_id = p_conversation and external_message_id = p_external_message
    returning id into updated_id;
  if updated_id is null then
    return query select p_event, false, 'update_not_applied', current_media; return;
  end if;
  return query select updated_id, true, 'confirmed', next_media;
end $$;

-- Atomic top-level merge for the known non-media writers. The scope is the same
-- as the media confirmation RPC, so a UUID from another tenant/conversation is
-- never sufficient to change raw_payload.
create or replace function public.magia_merge_channel_event_raw(
  p_tenant uuid, p_event uuid, p_channel text, p_conversation text,
  p_external_message text, p_patch jsonb, p_expected_product_snapshot jsonb default null
) returns table (applied boolean, reason text, merged_payload jsonb)
language plpgsql security invoker set search_path = public as $$
declare
  current_raw jsonb;
  current_snapshot jsonb;
  patch_to_merge jsonb;
  next_raw jsonb;
  updated_raw jsonb;
  merge_reason text := 'merged';
begin
  if p_tenant is null or p_event is null or nullif(btrim(p_channel), '') is null
    or nullif(btrim(p_conversation), '') is null or nullif(btrim(p_external_message), '') is null then
    return query select false, 'invalid_identity', null::jsonb; return;
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch ? 'media'
    or not (p_patch - 'audio_processing' - 'evolution_echo' - 'product_snapshot' - 'sales_media' - 'exclusion_phone' - 'contact_exclusion' = '{}'::jsonb) then
    return query select false, 'invalid_raw_patch', null::jsonb; return;
  end if;
  if p_expected_product_snapshot is not null and jsonb_typeof(p_expected_product_snapshot) <> 'object' then
    return query select false, 'invalid_product_snapshot_expectation', null::jsonb; return;
  end if;
  select coalesce(ce.raw_payload, '{}'::jsonb) into current_raw
    from public.channel_events as ce
    where ce.id = p_event and ce.tenant_id = p_tenant and ce.channel_type = p_channel
      and ce.external_conversation_id = p_conversation and ce.external_message_id = p_external_message
    for update;
  if not found then
    return query select false, 'event_scope_mismatch', null::jsonb; return;
  end if;
  patch_to_merge := p_patch;
  if p_patch ? 'product_snapshot' then
    if jsonb_typeof(p_patch->'product_snapshot') <> 'object' then
      return query select false, 'invalid_product_snapshot', current_raw; return;
    end if;
    current_snapshot := current_raw->'product_snapshot';
    if (current_snapshot is null and p_expected_product_snapshot is null)
      or (current_snapshot is not null and p_expected_product_snapshot is not null
        and current_snapshot is not distinct from p_expected_product_snapshot) then
      null; -- Compare-and-set succeeds while the event row is locked.
    else
      patch_to_merge := p_patch - 'product_snapshot';
      merge_reason := 'merged_product_snapshot_stale';
    end if;
  end if;
  next_raw := current_raw || patch_to_merge;
  if next_raw = current_raw then
    return query select false,
      case when merge_reason = 'merged_product_snapshot_stale' then 'product_snapshot_stale' else 'already_applied' end,
      current_raw;
    return;
  end if;
  update public.channel_events as ce set raw_payload = next_raw
    where ce.id = p_event and ce.tenant_id = p_tenant and ce.channel_type = p_channel
      and ce.external_conversation_id = p_conversation and ce.external_message_id = p_external_message
    returning ce.raw_payload into updated_raw;
  if updated_raw is null then
    return query select false, 'update_not_applied', current_raw; return;
  end if;
  return query select true, merge_reason, updated_raw;
end $$;

revoke all on function public.magia_confirm_whatsapp_media(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.magia_merge_channel_event_raw(uuid,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.magia_confirm_whatsapp_media(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.magia_merge_channel_event_raw(uuid,uuid,text,text,text,jsonb,jsonb) to service_role;
