-- Migration 013: Kanban Standard 4 Columns for all Tenants
-- Padronização do Kanban em 4 colunas gerenciadas por IA para todos os tenants

-- 1. Cria boards padrão para todos os tenants ativos que ainda não tenham um board
INSERT INTO public.kanban_boards (tenant_id, name, is_default)
SELECT 
  t.id, 
  'Funil de Atendimento Principal', 
  true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.kanban_boards b 
  WHERE b.tenant_id = t.id AND b.is_default = true
);

-- 2. Insere as 4 colunas padrão para os boards principais de cada tenant
INSERT INTO public.kanban_columns (tenant_id, board_id, name, position, automation_key)
SELECT 
  b.tenant_id,
  b.id,
  col.name,
  col.position,
  col.automation_key
FROM public.kanban_boards b
CROSS JOIN (VALUES 
  ('Novas conversas', 1, 'novas_conversas'),
  ('Conversas em andamento', 2, 'conversas_andamento'),
  ('Conversas com humanos', 3, 'conversas_humanos'),
  ('Agendamentos', 4, 'agendamentos')
) AS col(name, position, automation_key)
WHERE b.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM public.kanban_columns c
    WHERE c.board_id = b.id AND c.automation_key = col.automation_key
  );

-- 3. Habilita RLS e atualiza políticas de leitura
alter table if exists public.kanban_boards enable row level security;
alter table if exists public.kanban_columns enable row level security;
alter table if exists public.kanban_cards enable row level security;

drop policy if exists "kanban_boards_select_policy" on public.kanban_boards;
create policy "kanban_boards_select_policy"
on public.kanban_boards
for select
to anon, authenticated
using (
  tenant_id in (select id from public.tenants where status in ('active', 'trial', 'pilot', 'Piloto'))
  or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = kanban_boards.tenant_id
      and (tm.user_id = auth.uid() or auth.uid() is null)
  )
);

drop policy if exists "kanban_columns_select_policy" on public.kanban_columns;
create policy "kanban_columns_select_policy"
on public.kanban_columns
for select
to anon, authenticated
using (
  tenant_id in (select id from public.tenants where status in ('active', 'trial', 'pilot', 'Piloto'))
  or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = kanban_columns.tenant_id
      and (tm.user_id = auth.uid() or auth.uid() is null)
  )
);

drop policy if exists "kanban_cards_select_policy" on public.kanban_cards;
create policy "kanban_cards_select_policy"
on public.kanban_cards
for select
to anon, authenticated
using (
  tenant_id in (select id from public.tenants where status in ('active', 'trial', 'pilot', 'Piloto'))
  or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = kanban_cards.tenant_id
      and (tm.user_id = auth.uid() or auth.uid() is null)
  )
);

-- 4. Notificar PostgREST para recarregar o schema cache
notify pgrst, 'reload schema';
