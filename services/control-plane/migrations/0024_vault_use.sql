-- Secret vault, call-time use. Additive only; safe to run twice.
-- vault_uses is the use log the person can read. It never holds a value.
CREATE TABLE IF NOT EXISTS vault_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  person TEXT NOT NULL,
  domain TEXT NOT NULL,                -- the host the call was for
  outcome TEXT NOT NULL,               -- 'used' or the reason it was refused
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vault_uses_by_secret ON vault_uses (app_id, name, at);
-- A row here means the key was revoked. Saving the key again clears it.
CREATE TABLE IF NOT EXISTS vault_revoked (
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY (app_id, name)
);
