ALTER TABLE resources ADD COLUMN IF NOT EXISTS vcpu_count integer NOT NULL DEFAULT 0 CHECK (vcpu_count >= 0);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS memory_gb integer NOT NULL DEFAULT 0 CHECK (memory_gb >= 0);

CREATE OR REPLACE VIEW current_compute_usage AS
SELECT region, project_id, kind,
       COALESCE(SUM(gpu_count), 0)::bigint AS gpu_count,
       COALESCE(SUM(vcpu_count), 0)::bigint AS vcpu_count,
       COALESCE(SUM(memory_gb), 0)::bigint AS memory_gb
FROM resources
WHERE deleted_at IS NULL AND status IN ('running', 'provisioning')
GROUP BY region, project_id, kind;
