CREATE TABLE IF NOT EXISTS app_state (
  id integer PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  auxiliary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  kind text NOT NULL CHECK (kind IN ('gpu_vm', 'gpu_baremetal', 'vgpu', 'inference')),
  status text NOT NULL CHECK (status IN ('provisioning', 'running', 'stopped', 'error', 'terminating')),
  gpu_count integer NOT NULL CHECK (gpu_count >= 0),
  deleted_at timestamptz,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS resources_scope_idx ON resources(project_id, region, kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS resources_region_status_idx ON resources(region, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS storage_volumes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  resource_id text REFERENCES resources(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  kind text NOT NULL CHECK (kind IN ('block', 'file')),
  size_gb integer NOT NULL CHECK (size_gb > 0),
  deleted_at timestamptz,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS storage_volumes_scope_idx ON storage_volumes(region, kind) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS storage_buckets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  resource_id text REFERENCES resources(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  quota_gb integer NOT NULL CHECK (quota_gb > 0),
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS storage_buckets_scope_idx ON storage_buckets(region);

CREATE TABLE IF NOT EXISTS network_vpcs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS network_subnets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  vpc_id text NOT NULL REFERENCES network_vpcs(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS network_security_groups (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  vpc_id text NOT NULL REFERENCES network_vpcs(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS network_interfaces (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  resource_id text NOT NULL REFERENCES resources(id) DEFERRABLE INITIALLY DEFERRED,
  vpc_id text NOT NULL REFERENCES network_vpcs(id) DEFERRABLE INITIALLY DEFERRED,
  subnet_id text NOT NULL REFERENCES network_subnets(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  private_ip inet NOT NULL,
  released_at timestamptz,
  data jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS network_private_ip_active_idx ON network_interfaces(subnet_id, private_ip) WHERE released_at IS NULL;
CREATE TABLE IF NOT EXISTS network_eips (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  address inet NOT NULL,
  interface_id text REFERENCES network_interfaces(id) DEFERRABLE INITIALLY DEFERRED,
  released_at timestamptz,
  data jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS network_eip_address_active_idx ON network_eips(address) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS network_eip_interface_active_idx ON network_eips(interface_id) WHERE interface_id IS NOT NULL AND released_at IS NULL;
CREATE TABLE IF NOT EXISTS network_tunnels (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  vpc_id text NOT NULL REFERENCES network_vpcs(id) DEFERRABLE INITIALLY DEFERRED,
  subnet_id text NOT NULL REFERENCES network_subnets(id) DEFERRABLE INITIALLY DEFERRED,
  eip_id text NOT NULL REFERENCES network_eips(id) DEFERRABLE INITIALLY DEFERRED,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_orders (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  resource_id text NOT NULL REFERENCES resources(id) DEFERRABLE INITIALLY DEFERRED,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_usage (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  resource_id text NOT NULL,
  amount numeric(16,4) NOT NULL,
  usage_hour timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_usage_scope_idx ON billing_usage(project_id, region, usage_hour);
CREATE TABLE IF NOT EXISTS billing_transactions (
  id text PRIMARY KEY,
  resource_id text,
  amount numeric(16,4) NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE OR REPLACE VIEW current_gpu_usage AS
SELECT region, project_id, kind, COALESCE(SUM(gpu_count), 0)::bigint AS gpu_count
FROM resources
WHERE deleted_at IS NULL AND status IN ('running', 'provisioning')
GROUP BY region, project_id, kind;

CREATE OR REPLACE VIEW current_storage_usage AS
SELECT region, kind, SUM(size_gb)::bigint AS used_gb
FROM storage_volumes WHERE deleted_at IS NULL GROUP BY region, kind
UNION ALL
SELECT region, 'object' AS kind, SUM(quota_gb)::bigint AS used_gb
FROM storage_buckets GROUP BY region;
