-- Migration: 20261017190000_enable_sales_leads_realtime_optional.sql
-- Description: Publicação controlada de sales_leads no supabase_realtime com REPLICA IDENTITY FULL
-- NOTA: Arquivo preparado exclusivamente para revisão e governança.
-- NÃO APLICAR EM PRODUÇÃO sem autorização expressa da equipe de engenharia/operações.

DO $$
BEGIN
  -- 1. Assegurar REPLICA IDENTITY FULL para que filtros RLS e tenant_id funcionem em UPDATE/DELETE
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sales_leads'
  ) THEN
    ALTER TABLE public.sales_leads REPLICA IDENTITY FULL;
  END IF;

  -- 2. Adicionar public.sales_leads à publicação supabase_realtime de forma estritamente idempotente
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'sales_leads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_leads;
    END IF;
  END IF;
END $$;
