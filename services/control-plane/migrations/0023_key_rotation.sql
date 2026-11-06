-- Storage for signing key rotation (docs/design/key-rotation.md sections 3, 6, 7, 10). Additive only: three new tables, no change to audit_log.
-- Deploy procedure: apply the migration first, then deploy the Worker. The migration only adds tables; the old Worker ignores them and keeps writing `audit_log`, so both Worker versions can run during the deploy and no row is lost.
CREATE TABLE IF NOT EXISTS rotation_roots (
  app_id TEXT PRIMARY KEY,
  root_key TEXT NOT NULL,              -- root public key, base64, 32 bytes
  registered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS key_rotations (
  app_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  body TEXT NOT NULL,                  -- the exact signed string
  signature TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, sequence)
);
CREATE TABLE IF NOT EXISTS key_rotation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','agent','system')),
  sequence INTEGER NOT NULL,
  valid_from TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS key_rotation_log_app_id ON key_rotation_log (app_id, id);
