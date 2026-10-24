CREATE TABLE IF NOT EXISTS billing_rates (
  kind text NOT NULL,
  pool text,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  unit text NOT NULL,
  unit_price numeric(12,4) NOT NULL CHECK (unit_price >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_rates_key_idx
  ON billing_rates(kind, COALESCE(pool, ''), region, unit);

CREATE TABLE IF NOT EXISTS node_pools (
  code text PRIMARY KEY,
  display_name text NOT NULL,
  gpu_model text NOT NULL,
  gpus_per_node integer NOT NULL CHECK (gpus_per_node > 0),
  vram_gb integer NOT NULL CHECK (vram_gb > 0),
  cpu_architecture text NOT NULL,
  memory_system_gb integer NOT NULL,
  local_nvme_gb integer NOT NULL,
  network_technology text,
  network_ports integer,
  network_speed_gbps integer,
  bandwidth_gbs numeric NOT NULL,
  bf16_tflops numeric NOT NULL,
  tdp integer NOT NULL,
  cpu text NOT NULL,
  network text NOT NULL,
  mig_profile text NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_products (
  kind text NOT NULL,
  tier text NOT NULL,
  min_gb integer NOT NULL,
  max_gb integer NOT NULL,
  step_gb integer NOT NULL,
  usd_gb_month numeric(12,4) NOT NULL CHECK (usd_gb_month >= 0),
  PRIMARY KEY (kind, tier)
);

CREATE TABLE IF NOT EXISTS node_pool_inventory (
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  pool_code text NOT NULL REFERENCES node_pools(code),
  available_gpu integer NOT NULL CHECK (available_gpu >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, pool_code)
);

CREATE TABLE IF NOT EXISTS slice_skus (
  id text PRIMARY KEY,
  pool_code text NOT NULL REFERENCES node_pools(code),
  gpu_model text NOT NULL,
  profile text NOT NULL,
  memory_gb integer NOT NULL,
  layout_id text NOT NULL,
  slices_per_gpu integer NOT NULL,
  isolation text NOT NULL,
  kubernetes_resource text NOT NULL,
  cuda_baseline text NOT NULL,
  hourly_usd numeric(12,4) NOT NULL CHECK (hourly_usd >= 0),
  workload text NOT NULL,
  k8s_version text NOT NULL,
  gpu_operator text NOT NULL,
  driver_branch text NOT NULL
);

CREATE TABLE IF NOT EXISTS slice_inventory (
  id text PRIMARY KEY,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  sku_id text NOT NULL REFERENCES slice_skus(id),
  layout_id text NOT NULL,
  physical_gpu_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('free', 'reserved', 'allocated', 'maintenance')),
  resource_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slice_inventory_stock_idx ON slice_inventory(region, sku_id, state);
CREATE INDEX IF NOT EXISTS billing_usage_usage_hour_idx ON billing_usage(usage_hour);
