-- Self-serve accounts (GitHub login) and per-key quotas for the hosted simulator.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
ALTER TABLE api_keys ADD COLUMN account_id INTEGER;
ALTER TABLE api_keys ADD COLUMN quota_minutes INTEGER NOT NULL DEFAULT 600;   -- sandbox minutes this key may start
ALTER TABLE api_keys ADD COLUMN used_minutes INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(account_id, revoked_at);
-- Pending device-flow logins (short-lived).
CREATE TABLE IF NOT EXISTS device_logins (
  device_code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
