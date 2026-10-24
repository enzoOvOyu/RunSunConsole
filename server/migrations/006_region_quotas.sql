CREATE TABLE IF NOT EXISTS region_quotas (
  region text NOT NULL CHECK (region IN ('jp', 'sg', 'us')),
  metric text NOT NULL,
  kind text,
  limit_value numeric(16,2) NOT NULL CHECK (limit_value >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS region_quotas_key_idx
  ON region_quotas(region, metric, COALESCE(kind, ''));

INSERT INTO region_quotas(region, metric, kind, limit_value) VALUES
  ('jp', 'gpu', NULL, 528),
  ('jp', 'vcpu', NULL, 8448),
  ('jp', 'memory', NULL, 135168),
  ('jp', 'ip', NULL, 24),
  ('jp', 'storage', 'block', 450000),
  ('jp', 'storage', 'file', 350000),
  ('jp', 'storage', 'object', 200000),
  ('jp', 'vpc', NULL, 30),
  ('jp', 'subnet', NULL, 150),
  ('jp', 'security_group', NULL, 150),
  ('jp', 'tunnel', NULL, 30),
  ('sg', 'gpu', NULL, 320),
  ('sg', 'vcpu', NULL, 5120),
  ('sg', 'memory', NULL, 90112),
  ('sg', 'ip', NULL, 12),
  ('sg', 'storage', 'block', 225000),
  ('sg', 'storage', 'file', 175000),
  ('sg', 'storage', 'object', 100000),
  ('sg', 'vpc', NULL, 20),
  ('sg', 'subnet', NULL, 100),
  ('sg', 'security_group', NULL, 100),
  ('sg', 'tunnel', NULL, 20),
  ('us', 'gpu', NULL, 1152),
  ('us', 'vcpu', NULL, 18432),
  ('us', 'memory', NULL, 262144),
  ('us', 'ip', NULL, 32),
  ('us', 'storage', 'block', 450000),
  ('us', 'storage', 'file', 325000),
  ('us', 'storage', 'object', 225000),
  ('us', 'vpc', NULL, 30),
  ('us', 'subnet', NULL, 150),
  ('us', 'security_group', NULL, 150),
  ('us', 'tunnel', NULL, 30)
ON CONFLICT DO NOTHING;
