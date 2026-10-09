-- SmartLearn subscription and payment ledger.
-- Apply to Cloudflare D1 before enabling live checkout.
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  reference TEXT,
  student_id TEXT,
  email TEXT,
  amount_kobo INTEGER,
  currency TEXT,
  status TEXT NOT NULL,
  payload_json TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  student_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','past_due','cancelled','expired')),
  plan_code TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  last_payment_reference TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_events_reference ON payment_events(reference);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_expiry ON subscriptions(status, current_period_end);