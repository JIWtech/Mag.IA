-- Metadados de uso de IA por evento de canal.
-- Execute no Supabase SQL Editor antes dos testes reais com Gemini.

alter table channel_events
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists ai_error text,
  add column if not exists ai_usage jsonb default '{}'::jsonb,
  add column if not exists gemini_daily_limit integer,
  add column if not exists gemini_used_today_before_request integer;

create index if not exists channel_events_ai_provider_idx
  on channel_events (tenant_slug, ai_provider, created_at desc);

notify pgrst, 'reload schema';
