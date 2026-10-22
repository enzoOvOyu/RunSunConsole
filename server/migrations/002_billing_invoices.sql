CREATE TABLE IF NOT EXISTS billing_invoices (
  id text PRIMARY KEY,
  billing_period text NOT NULL UNIQUE,
  amount numeric(16,2) NOT NULL,
  data jsonb NOT NULL
);
