-- People and their phones. Additive only. Tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS people_login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS people_sessions (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phones (
  person_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_apps (
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  PRIMARY KEY (person_id, app_id)
);
CREATE TABLE IF NOT EXISTS phone_data (
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, app_id, key)
);
