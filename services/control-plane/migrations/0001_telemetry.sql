CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  app_id TEXT NOT NULL,
  release INTEGER NOT NULL,
  event TEXT NOT NULL,
  cold_start_ms REAL,
  bytes_downloaded INTEGER,
  apply_ms REAL,
  device_class TEXT,
  published_at TEXT,
  device_model TEXT,
  android_api INTEGER
);
CREATE INDEX IF NOT EXISTS telemetry_app_release ON telemetry(app_id, release);
