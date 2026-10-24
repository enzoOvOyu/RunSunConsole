ALTER TABLE billing_rates DROP CONSTRAINT IF EXISTS billing_rates_pkey;
ALTER TABLE billing_rates ALTER COLUMN pool DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_rates_key_idx
  ON billing_rates(kind, COALESCE(pool, ''), region, unit);

CREATE TABLE IF NOT EXISTS node_pool_inventory (
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  pool_code text NOT NULL REFERENCES node_pools(code),
  available_gpu integer NOT NULL CHECK (available_gpu >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, pool_code)
);

ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS gpu_model text;
ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS layout_id text;
ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS slices_per_gpu integer;
ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS isolation text;
ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS kubernetes_resource text;
ALTER TABLE slice_skus ADD COLUMN IF NOT EXISTS cuda_baseline text;

UPDATE slice_skus s
SET gpu_model = p.gpu_model,
    layout_id = s.pool_code || '-7x-' || s.profile,
    slices_per_gpu = 7,
    isolation = 'MIG hardware partition',
    kubernetes_resource = 'nvidia.com/mig-' || s.profile,
    cuda_baseline = 'CUDA 12'
FROM node_pools p
WHERE p.code = s.pool_code AND (s.gpu_model IS NULL OR s.layout_id IS NULL);

ALTER TABLE slice_skus ALTER COLUMN gpu_model SET NOT NULL;
ALTER TABLE slice_skus ALTER COLUMN layout_id SET NOT NULL;
ALTER TABLE slice_skus ALTER COLUMN slices_per_gpu SET NOT NULL;
ALTER TABLE slice_skus ALTER COLUMN isolation SET NOT NULL;
ALTER TABLE slice_skus ALTER COLUMN kubernetes_resource SET NOT NULL;
ALTER TABLE slice_skus ALTER COLUMN cuda_baseline SET NOT NULL;

CREATE INDEX IF NOT EXISTS billing_usage_usage_hour_idx ON billing_usage(usage_hour);
