-- Durable catalog entities referenced by the deployment wizards.
CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_templates (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS images_type_idx ON images ((data->>'type'));
CREATE INDEX IF NOT EXISTS models_modality_idx ON models ((data->>'modality'));

-- The API reloads catalog tables when this version changes, so direct SQL updates
-- become visible without restarting the process.
CREATE TABLE IF NOT EXISTS catalog_state (
  id integer PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0
);

INSERT INTO catalog_state(id, version) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
