-- Catalogo multi-tenant de servicos/produtos consultavel pela IA.
-- Para a JIW, este catalogo nasce da planilha de custos de servicos de TI.
-- Para Avvento, a mesma ideia pode ser usada para estoque de veiculos.

create extension if not exists unaccent;

create table if not exists tenant_service_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  external_source text not null default 'manual',
  external_id text not null,
  category text,
  name text not null,
  description text,
  billing_unit text,
  price numeric,
  estimated_hours numeric,
  notes text,
  searchable_text text generated always as (
    lower(
      coalesce(category, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(billing_unit, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored,
  metadata jsonb default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, external_source, external_id)
);

create index if not exists tenant_service_catalog_tenant_category_idx
  on tenant_service_catalog (tenant_id, category);

create index if not exists tenant_service_catalog_searchable_text_idx
  on tenant_service_catalog using gin (to_tsvector('portuguese', searchable_text));

alter table tenant_service_catalog enable row level security;

alter table channel_events
  add column if not exists catalog_matches jsonb default '[]'::jsonb,
  add column if not exists catalog_error text;

create or replace function search_tenant_service_catalog(
  p_tenant_slug text,
  p_query text,
  p_limit integer default 5
)
returns table (
  category text,
  name text,
  description text,
  billing_unit text,
  price numeric,
  estimated_hours numeric,
  notes text,
  rank numeric
)
language sql
stable
as $$
  with tenant_ref as (
    select id
    from tenants
    where slug = p_tenant_slug
    limit 1
  ),
  query_ref as (
    select
      nullif(trim(lower(unaccent(coalesce(p_query, '')))), '') as raw_query,
      regexp_split_to_array(nullif(trim(lower(unaccent(coalesce(p_query, '')))), ''), '\s+') as terms
  ),
  scored as (
    select
      c.category,
      c.name,
      c.description,
      c.billing_unit,
      c.price,
      c.estimated_hours,
      c.notes,
      (
        case when q.raw_query is null then 1 else 0 end
        + case when lower(unaccent(c.name)) ilike '%' || coalesce(q.raw_query, '') || '%' then 20 else 0 end
        + case when lower(unaccent(c.category)) ilike '%' || coalesce(q.raw_query, '') || '%' then 10 else 0 end
        + case when lower(unaccent(c.description)) ilike '%' || coalesce(q.raw_query, '') || '%' then 8 else 0 end
        + coalesce((
          select sum(
            case
              when lower(unaccent(c.name)) ilike '%' || term || '%' then 8
              when lower(unaccent(c.category)) ilike '%' || term || '%' then 5
              when lower(unaccent(c.description)) ilike '%' || term || '%' then 4
              when lower(unaccent(coalesce(c.notes, ''))) ilike '%' || term || '%' then 2
              else 0
            end
          )
          from unnest(coalesce(q.terms, array[]::text[])) as term
          where length(term) >= 3
        ), 0)
      )::numeric as rank
    from tenant_service_catalog c
    join tenant_ref t on t.id = c.tenant_id
    cross join query_ref q
    where c.active = true
  )
  select
    category,
    name,
    description,
    billing_unit,
    price,
    estimated_hours,
    notes,
    rank
  from scored
  where rank > 0
  order by
    rank desc,
    price nulls last,
    name
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

notify pgrst, 'reload schema';
