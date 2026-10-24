-- 0004: stored refill history.
--
-- Why: the refill endpoint called CID directly and returned the provider
-- refill id without recording anything, so there was no refill history
-- to show. From this migration on, every refill attempt (including
-- failures) is recorded here, and GET /api/refills lists a user's own
-- requests newest-first. Refills from before this migration were never
-- stored and cannot be recovered.
--
-- Apply via D1 console paste (0004_console_paste.sql) or wrangler.
-- The refill route and the list endpoint both tolerate a pre-migration
-- database (failed writes are swallowed; the list returns empty), so
-- deploy order does not matter.
CREATE TABLE IF NOT EXISTS refill_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider_refill_id TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refill_requests_user ON refill_requests (user_id, created_at);
