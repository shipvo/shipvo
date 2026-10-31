-- Apps registered through `shipvo app create` on the hosted control plane. The public key is the one built into the
-- app's shell; every release pointer written for the app must verify against it.
CREATE TABLE IF NOT EXISTS apps (
  app_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  bytes_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS apps_account ON apps(account_id);
