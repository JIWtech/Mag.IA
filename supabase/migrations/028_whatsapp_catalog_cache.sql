-- WhatsApp catalog cache.  Idempotent for a fresh project and for production,
-- where noria_catalog_auth_read_isolation_20261008 has already installed the
-- same public read contract.  This migration is intentionally NOT executed here.

create table if not exists public.whatsapp_catalog_products (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  instance_name text not null,
  product_id text not null,
  retailer_id text,
  title text not null default '',
  description text not null default '',
  currency text,
  regular_price_cents bigint,
  sale_price_cents bigint,
  effective_price_cents bigint,
  price_source text not null default 'none',
  availability text,
  visibility text,
  image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  collection_id text,
  matched_inventory_id text,
  match_status text not null default 'unmatched',
  active boolean not null default true,
  price_evidence_source text,
  price_observed_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, instance_name, product_id)
);

create table if not exists public.whatsapp_catalog_sync_state (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  instance_name text not null,
  status text not null default 'pending',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  product_count integer not null default 0,
  reported_count integer not null default 0,
  truncated boolean not null default false,
  error_code text,
  endpoint text,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (tenant_id, instance_name)
);
alter table public.whatsapp_catalog_products add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table public.whatsapp_catalog_products add column if not exists created_at timestamptz not null default now();
alter table public.whatsapp_catalog_products alter column synced_at set default now();
alter table public.whatsapp_catalog_products alter column match_status set default 'unmatched';
alter table public.whatsapp_catalog_sync_state add column if not exists created_at timestamptz not null default now();
alter table public.whatsapp_catalog_sync_state add column if not exists lease_token uuid;
alter table public.whatsapp_catalog_sync_state add column if not exists lease_expires_at timestamptz;

alter table public.whatsapp_catalog_products enable row level security;
alter table public.whatsapp_catalog_sync_state enable row level security;

-- Browser clients get only display-safe columns.  No write privilege and no
-- raw provider payload is present in either table.
revoke all on public.whatsapp_catalog_products, public.whatsapp_catalog_sync_state from anon, authenticated;
grant select (tenant_id, instance_name, product_id, title, currency, regular_price_cents,
  sale_price_cents, effective_price_cents, price_source, price_evidence_source,
  price_observed_at, image_url, image_urls, active, synced_at, updated_at)
  on public.whatsapp_catalog_products to authenticated;
grant select (tenant_id, instance_name, status, last_attempt_at, last_success_at,
  product_count, reported_count, truncated, error_code, endpoint, updated_at)
  on public.whatsapp_catalog_sync_state to authenticated;

drop policy if exists whatsapp_catalog_products_select_tenant on public.whatsapp_catalog_products;
create policy whatsapp_catalog_products_select_tenant on public.whatsapp_catalog_products
  for select to authenticated using (
    exists (select 1 from public.tenant_members m
      where m.tenant_id = whatsapp_catalog_products.tenant_id
        and m.user_id = (select auth.uid()) and m.status = 'active')
    and whatsapp_catalog_products.active is true
    and exists (select 1 from public.tenants t where t.id=whatsapp_catalog_products.tenant_id and t.status='active' and t.deleted_at is null)
  );
drop policy if exists whatsapp_catalog_sync_state_select_tenant on public.whatsapp_catalog_sync_state;
create policy whatsapp_catalog_sync_state_select_tenant on public.whatsapp_catalog_sync_state
  for select to authenticated using (
    exists (select 1 from public.tenant_members m
      where m.tenant_id = whatsapp_catalog_sync_state.tenant_id
        and m.user_id = (select auth.uid()) and m.status = 'active')
    and exists (select 1 from public.tenants t where t.id=whatsapp_catalog_sync_state.tenant_id and t.status='active' and t.deleted_at is null)
  );

-- n8n calls this with service_role only.  The row lock makes refresh cooldown
-- effective across concurrent browser requests and n8n executions.
drop function if exists public.claim_whatsapp_catalog_sync(uuid, text, integer);
create or replace function public.claim_whatsapp_catalog_sync(
  p_tenant_id uuid, p_instance_name text, p_cooldown_seconds integer default 120,
  p_lease_seconds integer default 180
) returns jsonb language plpgsql security definer set search_path = public as $$
declare previous public.whatsapp_catalog_sync_state%rowtype;
declare token uuid := gen_random_uuid();
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required';
  end if;
  insert into public.whatsapp_catalog_sync_state (tenant_id, instance_name, status)
  values (p_tenant_id, p_instance_name, 'idle')
  on conflict (tenant_id, instance_name) do nothing;
  select * into previous from public.whatsapp_catalog_sync_state
    where tenant_id=p_tenant_id and instance_name=p_instance_name for update;
  if previous.status = 'running' and previous.lease_expires_at is not null and previous.lease_expires_at > now() then
    return jsonb_build_object('claimed', false, 'reason', 'running');
  elsif previous.status = 'running' then
    update public.whatsapp_catalog_sync_state set status='idle', lease_token=null, lease_expires_at=null where tenant_id=p_tenant_id and instance_name=p_instance_name;
  elsif previous.last_attempt_at is not null and previous.last_attempt_at > now() - make_interval(secs => greatest(1, p_cooldown_seconds)) then
    return jsonb_build_object('claimed', false, 'reason', 'cooldown');
  end if;
  update public.whatsapp_catalog_sync_state
    set status='running', last_attempt_at=now(), error_code=null, lease_token=token,
        lease_expires_at=now()+make_interval(secs => greatest(30, p_lease_seconds)), updated_at=now()
    where tenant_id=p_tenant_id and instance_name=p_instance_name;
  return jsonb_build_object('claimed', true, 'lease_token', token, 'lease_expires_at', now()+make_interval(secs => greatest(30, p_lease_seconds)));
end $$;
revoke all on function public.claim_whatsapp_catalog_sync(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_catalog_sync(uuid, text, integer, integer) to service_role;

-- Single transaction: an expired/replaced lease cannot write cache rows.
create or replace function public.finish_whatsapp_catalog_sync(
  p_tenant_id uuid, p_instance_name text, p_lease_token uuid, p_products jsonb,
  p_status text, p_error_code text default null, p_endpoint text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare state public.whatsapp_catalog_sync_state%rowtype; written integer := 0;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  select * into state from public.whatsapp_catalog_sync_state where tenant_id=p_tenant_id and instance_name=p_instance_name for update;
  if not found or state.status <> 'running' or state.lease_token <> p_lease_token or state.lease_expires_at <= now() then
    return jsonb_build_object('ok',false,'reason','lease_invalid');
  end if;
  if p_status='ok' then
    insert into public.whatsapp_catalog_products (tenant_id,instance_name,product_id,retailer_id,title,currency,regular_price_cents,sale_price_cents,effective_price_cents,price_source,price_evidence_source,price_observed_at,image_url,image_urls,active,synced_at,updated_at,raw_payload)
    select p_tenant_id,p_instance_name,x.product_id,x.retailer_id,coalesce(x.title,''),x.currency,x.regular_price_cents,x.sale_price_cents,x.effective_price_cents,x.price_source,x.price_evidence_source,x.price_observed_at,x.image_url,coalesce(x.image_urls,'[]'::jsonb),true,now(),now(),coalesce(x.raw_payload,'{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_products,'[]'::jsonb)) as x(product_id text,retailer_id text,title text,currency text,regular_price_cents bigint,sale_price_cents bigint,effective_price_cents bigint,price_source text,price_evidence_source text,price_observed_at timestamptz,image_url text,image_urls jsonb,raw_payload jsonb)
    on conflict (tenant_id,instance_name,product_id) do update set title=excluded.title,currency=excluded.currency,regular_price_cents=excluded.regular_price_cents,sale_price_cents=excluded.sale_price_cents,effective_price_cents=excluded.effective_price_cents,price_source=excluded.price_source,price_evidence_source=excluded.price_evidence_source,price_observed_at=excluded.price_observed_at,image_url=excluded.image_url,image_urls=excluded.image_urls,active=true,synced_at=now(),updated_at=now(),raw_payload=excluded.raw_payload;
    get diagnostics written = row_count;
  end if;
  update public.whatsapp_catalog_sync_state set status=p_status,last_success_at=case when p_status='ok' then now() else last_success_at end,product_count=written,error_code=p_error_code,endpoint=p_endpoint,lease_token=null,lease_expires_at=null,updated_at=now() where tenant_id=p_tenant_id and instance_name=p_instance_name;
  return jsonb_build_object('ok',true,'written',written);
end $$;
revoke all on function public.finish_whatsapp_catalog_sync(uuid,text,uuid,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_whatsapp_catalog_sync(uuid,text,uuid,jsonb,text,text,text) to service_role;
