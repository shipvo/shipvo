-- Who changed a release. Written by recordAudit only; rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','agent','system')),
  action TEXT NOT NULL CHECK (action IN ('publish','rollback','halt')),
  release INTEGER,
  release_id TEXT,
  before TEXT,
  after TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_app_id ON audit_log (app_id, id);
