-- Per-person, per-app spend limits. Additive only; safe to run twice.
-- No row means a limit of 0: no money moves.
CREATE TABLE IF NOT EXISTS phone_spend_limits (
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),   -- minor units (cents)
  currency TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'month',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, app_id)
);
-- Money calls the spec runner made (spec action marked money: true), one row per allowed call.
CREATE TABLE IF NOT EXISTS phone_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  secret_name TEXT,                  -- the vault key used, never its value
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS phone_spend_by_app ON phone_spend (person_id, app_id, at);
-- One row per limit change and per refusal. Written by spend.ts only.
CREATE TABLE IF NOT EXISTS phone_spend_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  action TEXT NOT NULL,              -- 'spend_limit_set' or 'spend_refused'
  detail TEXT NOT NULL,              -- JSON: limit, spent, amount, currency
  at TEXT NOT NULL
);
