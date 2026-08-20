-- Padroniza o Kanban operacional em 4 colunas oficiais para todos os tenants.
-- Mantem colunas antigas no banco por compatibilidade, mas o frontend passa a
-- renderizar somente as automation_key oficiais abaixo.

begin;

alter table public.kanban_boards
  add column if not exists updated_at timestamptz default now();

alter table public.kanban_columns
  add column if not exists updated_at timestamptz default now();

insert into public.kanban_boards (tenant_id, name, is_default)
select t.id, 'Kanban Principal', true
from public.tenants t
where not exists (
  select 1
  from public.kanban_boards b
  where b.tenant_id = t.id
    and b.is_default = true
);

with default_boards as (
  select distinct on (tenant_id)
    id,
    tenant_id
  from public.kanban_boards
  where is_default = true
  order by tenant_id, created_at asc
),
official_columns as (
  select *
  from (values
    ('Novas conversas', 1, 'novas_conversas'),
    ('Conversas em andamento', 2, 'conversas_andamento'),
    ('Conversas com humanos', 3, 'conversas_humanos'),
    ('Agendamentos', 4, 'agendamentos')
  ) as col(name, position, automation_key)
)
insert into public.kanban_columns (tenant_id, board_id, name, position, automation_key)
select
  b.tenant_id,
  b.id,
  c.name,
  c.position,
  c.automation_key
from default_boards b
cross join official_columns c
where not exists (
  select 1
  from public.kanban_columns existing
  where existing.tenant_id = b.tenant_id
    and existing.board_id = b.id
    and existing.automation_key = c.automation_key
)
on conflict (tenant_id, board_id, name) do update
set
  position = excluded.position,
  automation_key = excluded.automation_key,
  updated_at = now();

with default_boards as (
  select distinct on (tenant_id)
    id,
    tenant_id
  from public.kanban_boards
  where is_default = true
  order by tenant_id, created_at asc
),
official_columns as (
  select *
  from (values
    ('Novas conversas', 1, 'novas_conversas'),
    ('Conversas em andamento', 2, 'conversas_andamento'),
    ('Conversas com humanos', 3, 'conversas_humanos'),
    ('Agendamentos', 4, 'agendamentos')
  ) as col(name, position, automation_key)
)
update public.kanban_columns kc
set
  name = c.name,
  position = c.position
from default_boards b
cross join official_columns c
where kc.tenant_id = b.tenant_id
  and kc.board_id = b.id
  and kc.automation_key = c.automation_key;

notify pgrst, 'reload schema';

commit;
