-- available_gpu is the free supply at the inventory baseline. Persist the
-- corresponding allocations once so releases/orders never depend on fixtures.
ALTER TABLE node_pool_inventory
  ADD COLUMN IF NOT EXISTS baseline_allocated_gpu integer
  CHECK (baseline_allocated_gpu >= 0);

CREATE OR REPLACE FUNCTION bump_catalog_version() RETURNS trigger AS $$
BEGIN
  UPDATE catalog_state SET version = version + 1 WHERE id = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE catalog_table text;
BEGIN
  FOREACH catalog_table IN ARRAY ARRAY[
    'billing_rates', 'node_pools', 'node_pool_inventory', 'storage_products',
    'slice_skus', 'region_quotas', 'images', 'models'
  ] LOOP
    EXECUTE format('CREATE TRIGGER catalog_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_version()', catalog_table);
  END LOOP;
END;
$$;
