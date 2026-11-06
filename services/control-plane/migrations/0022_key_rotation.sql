-- Key rotation (docs/design/key-rotation.md, sections 6 and 11). Additive only: no table is dropped or renamed.
-- The audit_log CHECK cannot be widened in place without a rebuild, so the audit trail moves to audit_log_v2,
-- whose action check also allows 'key-rotation'. Existing rows are copied once (same ids); run this migration once, before the Worker deploy. Rows written to audit_log after it stay there. audit_log is kept as it was.
CREATE TABLE IF NOT EXISTS audit_log_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','agent','system')),
  action TEXT NOT NULL CHECK (action IN ('publish','rollback','halt','key-rotation')),
  release INTEGER,
  release_id TEXT,
  before TEXT,
  after TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_v2_app_id ON audit_log_v2 (app_id, id);
INSERT OR IGNORE INTO audit_log_v2 (id, app_id, at, actor, actor_kind, action, release, release_id, before, after)
  SELECT id, app_id, at, actor, actor_kind, action, release, release_id, before, after FROM audit_log;

-- The root PUBLIC key registered for each app. The private key never reaches the control plane.
CREATE TABLE IF NOT EXISTS rotation_roots (
  app_id TEXT PRIMARY KEY,
  root_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Root-signed statements, stored as uploaded. The server is a courier: phones verify again.
CREATE TABLE IF NOT EXISTS rotations (
  app_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  body TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, sequence)
);
