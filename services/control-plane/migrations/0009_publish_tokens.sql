-- Publish tokens (sv_publish_…) live apart from simulator keys: api_keys.scope is constrained to test/owner/read.
CREATE TABLE IF NOT EXISTS publish_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS publish_tokens_app ON publish_tokens(app_id, revoked_at);
