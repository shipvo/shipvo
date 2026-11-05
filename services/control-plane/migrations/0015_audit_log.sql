-- Append-only record of who published, rolled back or halted a release. Additive: one new table, nothing changed.
-- No code updates or deletes these rows. `before` and `after` are short JSON text and never hold tokens or keys.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','agent','system')),
  action TEXT NOT NULL CHECK (action IN ('publish','rollback','halt')),
  release INTEGER,
  before TEXT,
  after TEXT,
  release_id TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_app ON audit_log (app_id, id);
