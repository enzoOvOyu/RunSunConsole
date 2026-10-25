-- Populate a newly introduced catalog once. Future deletions remain deletions.
ALTER TABLE catalog_state ADD COLUMN bootstrap_complete boolean NOT NULL DEFAULT false;
