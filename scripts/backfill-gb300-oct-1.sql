-- Idempotent: move the four GB300 NVL72 bare-metal machines to 2026-10-01 and
-- backfill hourly billing from their real runningSince up to the last full hour.
-- Rates come from billing_rates / the order price snapshot; storage from the
-- bundled volume quantity in that snapshot. Re-running is a no-op.
BEGIN;
SELECT pg_advisory_xact_lock(728154093);

CREATE TEMP TABLE gb300_targets ON COMMIT DROP AS
SELECT r.id,
       r.project_id,
       r.region,
       r.data->>'displayId' AS display_id,
       r.data->>'name' AS name,
       r.data->>'nodePool' AS pool,
       (o.data->'price_snapshot'->'lines') AS price_lines
FROM resources r
JOIN deployment_orders o ON o.resource_id = r.id
WHERE r.kind = 'gpu_baremetal'
  AND r.data->>'nodePool' = 'GB300_NVL72'
  AND r.data->>'name' LIKE 'gb300-nvl72-oct01-%';

-- Remove the few minutes of metering produced right after creation so the
-- retroactive history starts cleanly on 2026-10-01.
CREATE TEMP TABLE gb300_recent_charge ON COMMIT DROP AS
SELECT COALESCE(SUM((data->>'amount')::numeric), 0)::numeric AS amount
FROM billing_transactions
WHERE data->>'type' = 'charge'
  AND resource_id IN (SELECT id FROM gb300_targets);

DELETE FROM billing_transactions
WHERE data->>'type' = 'charge'
  AND resource_id IN (SELECT id FROM gb300_targets);

DELETE FROM billing_usage
WHERE resource_id IN (SELECT id FROM gb300_targets);

-- 1. Resource timestamps: created 2026-10-01 00:00, running 00:03 (180s provisioning).
UPDATE resources r
SET status = 'running',
    data = r.data || jsonb_build_object(
      'status', 'running',
      'createdAt', '2026-10-01T00:00:00.000Z',
      'provisioningSince', '2026-10-01T00:00:00.000Z',
      'runningSince', '2026-10-01T00:03:00.000Z',
      'stoppedAt', NULL,
      'deletedAt', NULL
    )
FROM gb300_targets t
WHERE r.id = t.id;

UPDATE deployment_orders o
SET data = o.data || jsonb_build_object('createdAt', '2026-10-01T00:00:00.000Z', 'status', 'completed')
FROM gb300_targets t
WHERE o.resource_id = t.id;

UPDATE storage_volumes v
SET data = v.data || jsonb_build_object('createdAt', '2026-10-01T00:00:00.000Z')
FROM gb300_targets t
WHERE v.resource_id = t.id;

-- 2. Hourly usage for compute and bundled storage.
CREATE TEMP TABLE gb300_hours ON COMMIT DROP AS
SELECT t.id, t.project_id, t.region, t.display_id,
       slot.hour,
       LEAST(1.0, EXTRACT(EPOCH FROM (slot.hour + interval '1 hour' -
             GREATEST(slot.hour, '2026-10-01T00:03:00.000Z'::timestamptz))) / 3600.0)::numeric AS hours,
       (line->>'unit') AS unit,
       (line->>'unitPrice')::numeric AS unit_price,
       (line->>'quantity')::numeric AS line_quantity
FROM gb300_targets t
CROSS JOIN LATERAL generate_series('2026-10-01T00:00:00.000Z'::timestamptz,
                                   date_trunc('hour', now()) - interval '1 hour',
                                   interval '1 hour') AS slot(hour)
CROSS JOIN LATERAL jsonb_array_elements(t.price_lines) AS line
WHERE line->>'unit' IN ('per_machine_hour', 'per_gb_hour')
  AND slot.hour + interval '1 hour' > '2026-10-01T00:03:00.000Z'::timestamptz;

INSERT INTO billing_usage(id, project_id, region, resource_id, amount, usage_hour, data)
SELECT h.id || '-' || (EXTRACT(EPOCH FROM h.hour) * 1000)::bigint || '-' || h.unit,
       h.project_id, h.region, h.id,
       ROUND(
         CASE h.unit
           WHEN 'per_machine_hour' THEN h.hours * h.unit_price
           ELSE h.line_quantity * h.hours * h.unit_price
         END, 4),
       h.hour,
       jsonb_build_object(
         'id', h.id || '-' || (EXTRACT(EPOCH FROM h.hour) * 1000)::bigint || '-' || h.unit,
         'resourceUuid', h.id,
         'displayId', h.display_id,
         'projectId', h.project_id,
         'region', h.region,
         'kind', 'gpu_baremetal',
         'usageHour', to_char(h.hour AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'unit', h.unit,
         'quantity', ROUND(CASE h.unit WHEN 'per_machine_hour' THEN h.hours ELSE h.line_quantity * h.hours END, 4),
         'unitPrice', h.unit_price,
         'amount', ROUND(CASE h.unit WHEN 'per_machine_hour' THEN h.hours * h.unit_price ELSE h.line_quantity * h.hours * h.unit_price END, 4),
         'status', 'running'
       )
FROM gb300_hours h
ON CONFLICT (id) DO NOTHING;

-- 3. Ledger: the prepaid credit covers exactly these retroactive charges, so
-- the account balance keeps its current value and nothing auto-stops.
CREATE TEMP TABLE gb300_charge ON COMMIT DROP AS
SELECT t.id, ROUND(COALESCE(SUM(u.amount), 0)::numeric, 4) AS amount
FROM gb300_targets t
LEFT JOIN billing_usage u ON u.resource_id = t.id
GROUP BY t.id;

CREATE TEMP TABLE gb300_balance ON COMMIT DROP AS
WITH totals AS (
  SELECT SUM(c.amount) AS total FROM gb300_charge c
), base AS (
  SELECT (auxiliary->'account'->>'creditBalance')::numeric AS balance,
         (SELECT amount FROM gb300_recent_charge) AS restored
  FROM app_state WHERE id = 1
)
SELECT c.id, c.amount, base.balance - base.restored AS final_balance,
       t.total,
       ROUND(base.balance - base.restored - SUM(c.amount) OVER (ORDER BY c.id), 4) AS balance_after
FROM gb300_charge c CROSS JOIN totals t CROSS JOIN base;

INSERT INTO billing_transactions(id, resource_id, amount, at, data)
SELECT 'oct01-gb300-prepaid', NULL, total, '2026-10-01T00:00:00.000Z',
       jsonb_build_object('id', 'oct01-gb300-prepaid', 'resourceUuid', NULL,
         'at', '2026-10-01T00:00:00.000Z', 'type', 'credit', 'amount', total,
         'balanceAfter', final_balance + total,
         'referenceId', 'prepaid-oct-2026-gb300')
FROM gb300_balance WHERE amount > 0 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO billing_transactions(id, resource_id, amount, at, data)
SELECT 'oct01-gb300-charge-' || id, id, -amount, now(),
       jsonb_build_object('id', 'oct01-gb300-charge-' || id, 'resourceUuid', id,
         'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'type', 'charge', 'amount', -amount, 'balanceAfter', balance_after,
         'referenceId', 'oct01-gb300-charge-' || id)
FROM gb300_balance WHERE amount > 0
ON CONFLICT (id) DO NOTHING;

-- 4. Reset cursors to the start of the current hour so the running server bills
-- only new time, and register the retroactive lifecycle events.
UPDATE app_state s
SET version = version + 1,
    auxiliary = jsonb_set(
      jsonb_set(
        s.auxiliary,
        '{billingCursors}',
        COALESCE(s.auxiliary->'billingCursors', '{}'::jsonb) ||
        (SELECT jsonb_object_agg(t.id, (EXTRACT(EPOCH FROM date_trunc('hour', now())) * 1000)::bigint)
         FROM gb300_targets t)
      ),
      '{account,creditBalance}',
      to_jsonb(ROUND((s.auxiliary->'account'->>'creditBalance')::numeric -
        (SELECT amount FROM gb300_recent_charge), 4))
    )
WHERE s.id = 1 AND EXISTS (SELECT 1 FROM gb300_targets);

UPDATE app_state s
SET auxiliary = jsonb_set(
      s.auxiliary, '{events}',
      (SELECT jsonb_agg(e.value ORDER BY e.ordinality)
       FROM jsonb_array_elements(s.auxiliary->'events') WITH ORDINALITY AS e(value, ordinality))
      || (SELECT jsonb_agg(jsonb_build_object(
            'id', t.id || '-oct01-' || step.type,
            'resourceUuid', t.id,
            'type', step.type,
            'at', step.at,
            'actor', 'enzoOvOyu',
            'component', 'gpu_baremetal',
            'reason', step.reason,
            'before', step.before,
            'after', step.after,
            'metric', 'gpu_count',
            'value', 72,
            'threshold', 1,
            'action', '—'
          ) ORDER BY t.id, step.ord)
         FROM gb300_targets t
         CROSS JOIN LATERAL (VALUES
           (1, 'provisioning', '2026-10-01T00:00:00.000Z', '下单已受理，正在分配区域内 GPU 与网络资源', 'requested', 'provisioning'),
           (2, 'ready', '2026-10-01T00:03:00.000Z', '资源供给完成，探活检查通过', 'provisioning', 'running')
         ) AS step(ord, type, at, reason, before, after))
    )
WHERE s.id = 1 AND EXISTS (SELECT 1 FROM gb300_targets);

SELECT COUNT(DISTINCT h.id) AS machines,
       COUNT(*) AS usage_rows,
       ROUND(SUM(h.amount), 4) AS usage_amount
FROM billing_usage h JOIN gb300_targets t ON t.id = h.resource_id;
COMMIT;
