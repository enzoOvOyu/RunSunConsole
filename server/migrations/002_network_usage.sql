CREATE OR REPLACE VIEW current_network_usage AS
SELECT region, 'vpc' AS metric, COUNT(*)::bigint AS used_value
FROM network_vpcs WHERE data->>'deletedAt' IS NULL GROUP BY region
UNION ALL
SELECT region, 'subnet', COUNT(*)::bigint
FROM network_subnets WHERE data->>'deletedAt' IS NULL GROUP BY region
UNION ALL
SELECT region, 'security_group', COUNT(*)::bigint
FROM network_security_groups WHERE data->>'deletedAt' IS NULL GROUP BY region
UNION ALL
SELECT region, 'tunnel', COUNT(*)::bigint
FROM network_tunnels WHERE data->>'deletedAt' IS NULL GROUP BY region
UNION ALL
SELECT region, 'ip', COUNT(*)::bigint
FROM network_eips WHERE released_at IS NULL GROUP BY region;
