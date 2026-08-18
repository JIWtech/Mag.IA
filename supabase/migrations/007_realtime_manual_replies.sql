-- Suporte para Conversas em tempo quase real e respostas manuais.

alter table channel_events
  add column if not exists sender_type text default 'contact',
  add column if not exists sent_by_user text,
  add column if not exists delivery_status text default 'received',
  add column if not exists command_id text;

create index if not exists channel_events_conversation_created_idx
  on channel_events (tenant_slug, channel_type, external_conversation_id, created_at);

create unique index if not exists channel_events_command_unique
  on channel_events (tenant_slug, command_id)
  where command_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'channel_events'
  ) then
    alter publication supabase_realtime add table public.channel_events;
  end if;
end $$;

notify pgrst, 'reload schema';
