-- Consent cards for putting an app on a person's phone. Additive only. Tokens are stored only as SHA-256 hashes.
-- An assistant token can ask for an install and read the phone's app list. It cannot approve: only a person session can.
CREATE TABLE IF NOT EXISTS phone_assistant_tokens (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_install_cards (
  id TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  permissions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS phone_install_cards_person ON phone_install_cards(person_id, status);
