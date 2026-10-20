-- Migration: 20261017180000_genesis_inventory_vehicle_images.sql
-- Description: Tabela de imagens autorizadas do estoque Gênesis vinculadas por tenant e vehicle_id
-- PENDING REVIEW: apply only after the operational mapping/hash review.
BEGIN;

CREATE TABLE IF NOT EXISTS public.genesis_inventory_vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'product-catalog',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  width INTEGER,
  height INTEGER,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_genesis_vehicle FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES public.genesis_inventory_vehicles(tenant_id, vehicle_id) ON DELETE CASCADE,
  CONSTRAINT uq_genesis_vehicle_image_path UNIQUE (tenant_id, storage_path)
  ,CONSTRAINT ck_genesis_image_sha256 CHECK (sha256 ~ '^[a-f0-9]{64}$')
  ,CONSTRAINT ck_genesis_image_size CHECK (file_size_bytes BETWEEN 1 AND 10485760)
  ,CONSTRAINT ck_genesis_image_mime CHECK (mime_type = 'image/jpeg')
  ,CONSTRAINT ck_genesis_image_bucket CHECK (storage_bucket = 'product-catalog')
  ,CONSTRAINT ck_genesis_image_path CHECK (
    storage_path LIKE 'genesis/' || tenant_id::text || '/%'
    AND storage_path !~ '(^|/)\.\.?(/|$)' AND storage_path !~ '[%?#[:space:]\\]'
  )
);

-- Índices para consultas eficientes por veículo e deduplicação de hash
CREATE INDEX IF NOT EXISTS idx_genesis_vehicle_images_tenant_vehicle
  ON public.genesis_inventory_vehicle_images(tenant_id, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_genesis_vehicle_images_sha256
  ON public.genesis_inventory_vehicle_images(tenant_id, sha256);

-- Habilitação de RLS para isolamento por tenant
ALTER TABLE public.genesis_inventory_vehicle_images ENABLE ROW LEVEL SECURITY;

-- A public object URL is not permission to enumerate another tenant's mapping.
REVOKE ALL ON public.genesis_inventory_vehicle_images FROM anon, authenticated;
GRANT SELECT ON public.genesis_inventory_vehicle_images TO authenticated;
GRANT ALL ON public.genesis_inventory_vehicle_images TO service_role;
DROP POLICY IF EXISTS "Public read genesis inventory images" ON public.genesis_inventory_vehicle_images;
DROP POLICY IF EXISTS "Tenant members can manage genesis inventory images" ON public.genesis_inventory_vehicle_images;
DROP POLICY IF EXISTS "Tenant members read genesis inventory images" ON public.genesis_inventory_vehicle_images;
CREATE POLICY "Tenant members read genesis inventory images"
  ON public.genesis_inventory_vehicle_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = genesis_inventory_vehicle_images.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.status = 'active'
    )
  );

COMMENT ON TABLE public.genesis_inventory_vehicle_images IS 'Galeria de imagens autorizadas do estoque de veículos da Gênesis Automóveis vinculadas por (tenant_id, vehicle_id).';
COMMIT;
