CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  display_name TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  platform TEXT NOT NULL DEFAULT 'other',
  provider_rate REAL NOT NULL DEFAULT 0,
  retail_rate REAL NOT NULL DEFAULT 0,
  markup_override REAL,
  min INTEGER NOT NULL DEFAULT 0,
  max INTEGER NOT NULL DEFAULT 0,
  refill INTEGER NOT NULL DEFAULT 0,
  cancel INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  provider_active INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_active ON services (is_active, provider_active, category);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  service_count INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions (user_id, created_at);
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'upi',
  txn_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_topups_status ON payment_requests (status, created_at);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  provider_order_id TEXT,
  link TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  charge REAL NOT NULL,
  provider_cost REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  start_count INTEGER,
  remains INTEGER,
  refund_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at);
