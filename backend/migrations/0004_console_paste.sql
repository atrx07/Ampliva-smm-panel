CREATE TABLE IF NOT EXISTS refill_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL REFERENCES orders(id), provider_refill_id TEXT, status TEXT NOT NULL DEFAULT 'submitted', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_refill_requests_user ON refill_requests (user_id, created_at);
