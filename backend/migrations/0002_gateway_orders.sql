-- Ampliva Razorpay integration: gateway order tracking.
-- Webhook credits are idempotent: the UPDATE ... WHERE status = 'created'
-- flip is atomic, so a retried/delivered-twice webhook can credit only once.

CREATE TABLE IF NOT EXISTS gateway_orders (
  id TEXT PRIMARY KEY,                    -- gw_<internal id>, also the Razorpay receipt
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,                   -- INR, what the wallet gets credited
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT NOT NULL UNIQUE, -- Razorpay order_... id
  provider_payment_id TEXT,               -- Razorpay pay_... id, once captured
  status TEXT NOT NULL DEFAULT 'created', -- created | paid
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gateway_orders_user ON gateway_orders (user_id, created_at);
