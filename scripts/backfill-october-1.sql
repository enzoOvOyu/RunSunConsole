-- Idempotent correction for the three demo resources created on 2026-10-04.
-- Run in one transaction while holding the same advisory lock as the API.
BEGIN;
SELECT pg_advisory_xact_lock(728154093);
CREATE TEMP TABLE backfill_targets ON COMMIT DROP AS
SELECT id, project_id, region,
       (data->>'createdAt')::timestamptz AS created_old,
       (data->>'runningSince')::timestamptz AS running_old
FROM resources
WHERE data->>'createdAt' LIKE '2026-10-04%' AND data->>'runningSince' LIKE '2026-10-04%';
CREATE TEMP TABLE backfill_before ON COMMIT DROP AS
SELECT t.id, COALESCE(SUM(u.amount), 0)::numeric AS amount
FROM backfill_targets t LEFT JOIN billing_usage u ON u.resource_id = t.id
GROUP BY t.id;
CREATE TEMP TABLE backfill_meters ON COMMIT DROP AS
SELECT t.id AS resource_id, t.project_id, t.region,
       date_trunc('hour', t.running_old) AS first_hour,
       first.data AS first_data, full_row.data AS full_data,
       first.data->>'unit' AS unit
FROM backfill_targets t
JOIN billing_usage first ON first.resource_id = t.id
  AND first.usage_hour = date_trunc('hour', t.running_old)
JOIN billing_usage full_row ON full_row.resource_id = t.id
  AND full_row.usage_hour = date_trunc('hour', t.running_old) + interval '1 hour'
  AND full_row.data->>'unit' = first.data->>'unit';
INSERT INTO billing_usage(id, project_id, region, resource_id, amount, usage_hour, data)
SELECT m.resource_id || '-' || (extract(epoch FROM slot.hour)*1000)::bigint || '-' || m.unit,
       m.project_id, m.region, m.resource_id,
       (CASE WHEN slot.hour = m.first_hour - interval '3 days' THEN m.first_data ELSE m.full_data END->>'amount')::numeric,
       slot.hour,
       (CASE WHEN slot.hour = m.first_hour - interval '3 days' THEN m.first_data ELSE m.full_data END) ||
       jsonb_build_object(
         'id', m.resource_id || '-' || (extract(epoch FROM slot.hour)*1000)::bigint || '-' || m.unit,
         'usageHour', to_char(slot.hour AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
FROM backfill_meters m
CROSS JOIN LATERAL generate_series(m.first_hour - interval '3 days', m.first_hour - interval '1 hour', interval '1 hour') AS slot(hour)
ON CONFLICT (id) DO NOTHING;
UPDATE billing_usage u
SET amount = (m.full_data->>'amount')::numeric,
    data = m.full_data || jsonb_build_object('id', u.id, 'usageHour', u.data->>'usageHour')
FROM backfill_meters m
WHERE u.resource_id = m.resource_id AND u.usage_hour = m.first_hour;
UPDATE resources r
SET data = r.data || jsonb_build_object(
  'createdAt', to_char((t.created_old - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'provisioningSince', to_char((t.created_old - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'runningSince', to_char((t.running_old - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM backfill_targets t WHERE r.id = t.id;
UPDATE deployment_orders o
SET data = jsonb_set(o.data, '{createdAt}', to_jsonb(to_char((t.created_old - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
FROM backfill_targets t WHERE o.resource_id = t.id;
CREATE TEMP TABLE backfill_delta ON COMMIT DROP AS
SELECT t.id, ROUND(SUM(u.amount)::numeric - b.amount, 4) AS amount
FROM backfill_targets t JOIN backfill_before b ON b.id = t.id
JOIN billing_usage u ON u.resource_id = t.id
GROUP BY t.id, b.amount;
CREATE TEMP TABLE backfill_balance ON COMMIT DROP AS
SELECT d.id, d.amount,
  ROUND((SELECT (auxiliary->'account'->>'creditBalance')::numeric FROM app_state WHERE id = 1)
    - SUM(d.amount) OVER (ORDER BY d.id), 4) AS balance_after
FROM backfill_delta d;
INSERT INTO billing_transactions(id, resource_id, amount, at, data)
SELECT 'backfill-oct1-' || id, id, -amount, now(),
       jsonb_build_object('id', 'backfill-oct1-' || id, 'resourceUuid', id,
         'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'type', 'charge', 'amount', -amount, 'balanceAfter', balance_after,
         'referenceId', 'backfill-oct1-' || id)
FROM backfill_balance WHERE amount > 0
ON CONFLICT (id) DO NOTHING;
UPDATE app_state s
SET version = version + CASE WHEN EXISTS (SELECT 1 FROM backfill_targets) THEN 1 ELSE 0 END,
    auxiliary = jsonb_set(
      jsonb_set(s.auxiliary, '{account,creditBalance}',
        to_jsonb(ROUND((s.auxiliary->'account'->>'creditBalance')::numeric
          - COALESCE((SELECT SUM(amount) FROM backfill_delta), 0), 4))),
      '{events}',
      (SELECT jsonb_agg(
        CASE WHEN e.value->>'resourceUuid' IN (SELECT id FROM backfill_targets)
                  AND e.value->>'at' LIKE '2026-10-04%'
          THEN jsonb_set(e.value, '{at}',
            to_jsonb(to_char(((e.value->>'at')::timestamptz - interval '3 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
          ELSE e.value END ORDER BY e.ordinality)
       FROM jsonb_array_elements(s.auxiliary->'events') WITH ORDINALITY AS e(value, ordinality))
    )
WHERE s.id = 1 AND EXISTS (SELECT 1 FROM backfill_targets);
SELECT COUNT(*) AS shifted_resources, COALESCE(SUM(amount),0) AS added_usage_charge FROM backfill_delta;
COMMIT;
