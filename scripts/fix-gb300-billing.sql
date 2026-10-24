-- Corrects an earlier mistake: a fabricated "prepaid" credit offset the GB300
-- charges so nothing was actually billed. Remove it and debit the real amount.
BEGIN;
SELECT pg_advisory_xact_lock(728154094);

DELETE FROM billing_transactions WHERE id = 'oct01-gb300-prepaid';

-- Balance is authoritative: credits + vouchers - real metered usage.
WITH credits AS (
  SELECT COALESCE(SUM(amount), 0)::numeric AS total
  FROM billing_transactions WHERE amount > 0
), usage AS (
  SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM billing_usage
), target AS (
  SELECT ROUND(c.total - u.total, 4) AS balance FROM credits c CROSS JOIN usage u
)
UPDATE app_state s
SET version = version + 1,
    auxiliary = jsonb_set(s.auxiliary, '{account,creditBalance}',
                          to_jsonb((SELECT balance FROM target)))
WHERE s.id = 1;

-- Make the four GB300 charge rows' balanceAfter agree with the corrected balance.
WITH ordered AS (
  SELECT id, amount, SUM(amount) OVER (ORDER BY id DESC) - amount AS after_me
  FROM billing_transactions WHERE id LIKE 'oct01-gb300-charge-%'
), bal AS (
  SELECT (auxiliary->'account'->>'creditBalance')::numeric AS b FROM app_state WHERE id = 1
)
UPDATE billing_transactions t
SET data = t.data || jsonb_build_object('balanceAfter',
      ROUND((SELECT b FROM bal) + o.after_me, 4))
FROM ordered o WHERE t.id = o.id;

SELECT (auxiliary->'account'->>'creditBalance')::numeric AS balance,
       (SELECT ROUND(SUM(amount),4) FROM billing_transactions) AS ledger,
       (SELECT ROUND(SUM(amount),4) FROM billing_usage) AS usage
FROM app_state WHERE id = 1;
COMMIT;
