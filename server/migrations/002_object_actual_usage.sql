-- Object quota tracks stored object bytes, including retained versions, never configured Bucket limits.
DROP VIEW IF EXISTS current_storage_usage;
CREATE VIEW current_storage_usage AS
SELECT region, kind, SUM(size_gb)::numeric AS used_gb
FROM storage_volumes WHERE deleted_at IS NULL GROUP BY region, kind
UNION ALL
SELECT b.region, 'object' AS kind,
  COALESCE(SUM(
    COALESCE((o.value->>'size')::numeric, 0) +
    COALESCE((SELECT SUM((v.value->>'size')::numeric)
      FROM jsonb_array_elements(COALESCE(o.value->'previousVersions', '[]'::jsonb)) AS v(value)), 0)
  ), 0) / 1000000000 AS used_gb
FROM storage_buckets AS b
LEFT JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'objects', '[]'::jsonb)) AS o(value) ON true
GROUP BY b.region;
