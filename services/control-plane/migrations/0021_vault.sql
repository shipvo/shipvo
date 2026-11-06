-- Secret vault. Additive only. Values are stored only as AES-GCM ciphertext; the master key is a Worker secret.
CREATE TABLE IF NOT EXISTS vault_tickets (
  id_hash TEXT PRIMARY KEY,            -- SHA-256 of the ticket id; the id itself is never stored
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  domain TEXT NOT NULL,
  access TEXT NOT NULL,                -- 'read' or 'write': what the person is asked for
  purpose TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS vault_secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  access TEXT NOT NULL,                -- 'read' or 'write', as found by the verification call
  warning TEXT,                        -- set when the key is full access
  valid INTEGER,                       -- 1 valid, 0 refused by the service, NULL not checked
  wrapped_key TEXT NOT NULL,           -- per-secret data key, encrypted with the master key
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (app_id, name)
);
