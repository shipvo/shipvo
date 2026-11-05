-- Optional webhook per app, called when a release is reverted on devices. Additive: two new tables, nothing changed.
CREATE TABLE IF NOT EXISTS app_alerts (
  app_id TEXT PRIMARY KEY,
  webhook TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Last alert sent per release, so a release alerts at most once per hour.
CREATE TABLE IF NOT EXISTS alert_sent (
  app_id TEXT NOT NULL,
  release INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (app_id, release)
);
