-- How far the telemetry export to R2 has got, per app.
CREATE TABLE IF NOT EXISTS telemetry_export (
  app_id TEXT PRIMARY KEY,
  last_id INTEGER NOT NULL DEFAULT 0,
  exported_at TEXT
);
