CREATE TABLE billing_modes (
  mode text PRIMARY KEY CHECK (mode IN ('on_demand', 'spot', 'reserved')),
  multiplier numeric(8,6) NOT NULL CHECK (multiplier > 0 AND multiplier <= 1)
);
INSERT INTO billing_modes(mode, multiplier) VALUES
  ('on_demand', 1), ('spot', 0.55), ('reserved', 0.7);

CREATE TRIGGER catalog_changed AFTER INSERT OR UPDATE OR DELETE ON billing_modes
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_version();
CREATE TRIGGER catalog_changed AFTER INSERT OR UPDATE OR DELETE ON app_templates
  FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_version();
