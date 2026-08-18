-- Mag.IA: Tabela padrao do sistema para Agentes Humanos da Equipe (Multi-tenant)
-- Permite que cada tenant/estabelecimento cadastre e gerencie sua propria equipe de atendentes

CREATE TABLE IF NOT EXISTS public.team_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    tenant_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Atendente',
    phone TEXT,
    email TEXT,
    branch TEXT DEFAULT 'Matriz',
    shift TEXT DEFAULT 'Integral',
    channel TEXT DEFAULT 'WhatsApp',
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'standby', 'offline')),
    max_active_chats INT DEFAULT 5,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices de alta performance para busca por tenant
CREATE INDEX IF NOT EXISTS idx_team_agents_tenant_slug ON public.team_agents (tenant_slug);
CREATE INDEX IF NOT EXISTS idx_team_agents_status ON public.team_agents (status);
CREATE INDEX IF NOT EXISTS idx_team_agents_branch_shift ON public.team_agents (tenant_slug, branch, shift);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.team_agents ENABLE ROW LEVEL SECURITY;

-- Politicas de acesso
CREATE POLICY "team_agents_select_policy"
ON public.team_agents
FOR SELECT
USING (true);

CREATE POLICY "team_agents_insert_policy"
ON public.team_agents
FOR INSERT
WITH CHECK (true);

CREATE POLICY "team_agents_update_policy"
ON public.team_agents
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "team_agents_delete_policy"
ON public.team_agents
FOR DELETE
USING (true);

-- Habilitar Supabase Realtime para a tabela team_agents
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_agents;
