-- 0003: store the provider's per-service type and dripfeed flag.
--
-- Why: CID's order form is type-driven (Custom Comments need a comments
-- textarea, Poll needs an answer number, dripfeed needs runs/interval),
-- but the sync never stored `type` or `dripfeed`, so the store could only
-- ever send link + quantity. The API already returns both fields; this
-- migration gives them a home. Existing rows default to 'Default' / 0
-- until the next catalogue sync overwrites them with real values.
--
-- Apply via D1 console paste (0003_console_paste.sql) or wrangler.
-- The sync code tolerates a pre-migration database (it checks for these
-- columns with PRAGMA first), so deploy order does not matter.
ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'Default';
ALTER TABLE services ADD COLUMN dripfeed INTEGER NOT NULL DEFAULT 0;
