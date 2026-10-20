begin;

alter table public.broadcast_campaigns
  add column if not exists send_interval_seconds smallint not null default 3,
  add column if not exists consent_confirmed_at timestamptz,
  add column if not exists consent_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists started_at timestamptz,
  add column if not exists last_error text;

alter table public.broadcast_campaigns
  drop constraint if exists broadcast_campaigns_status_check;

alter table public.broadcast_campaigns
  add constraint broadcast_campaigns_status_check
    check (status in ('draft', 'queued', 'scheduled', 'sending', 'sent', 'partial_error', 'failed', 'cancelled'));

alter table public.broadcast_campaigns
  drop constraint if exists broadcast_campaigns_send_interval_seconds_check;

alter table public.broadcast_campaigns
  add constraint broadcast_campaigns_send_interval_seconds_check
    check (send_interval_seconds between 2 and 10);

create index if not exists broadcast_campaigns_queued_idx
  on public.broadcast_campaigns (status, created_at)
  where status in ('queued', 'scheduled', 'sending');

commit;
