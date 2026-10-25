CREATE TABLE deployment_configuration (
  id integer PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL
);
INSERT INTO deployment_configuration(id, data)
SELECT 1, jsonb_build_object(
  'serverFlavors', (SELECT jsonb_agg(jsonb_build_object('vcpu', n, 'memoryGb', n * 2) ORDER BY n) FROM generate_series(8, 96, 8) n),
  'gpuCounts', '[1,2,4,8]'::jsonb,
  'k8sVersions', '["1.31","1.32","1.33","1.34","1.35","1.36","1.37"]'::jsonb
);
CREATE TRIGGER catalog_changed AFTER INSERT OR UPDATE OR DELETE ON deployment_configuration
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_version();
