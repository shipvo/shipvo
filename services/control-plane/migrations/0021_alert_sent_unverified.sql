-- Alert slots for unverified reports, kept apart from alert_sent so forged reports cannot use up the slots of verified ones. Additive: one new table.
CREATE TABLE IF NOT EXISTS alert_sent_unverified (
  app_id TEXT NOT NULL,
  release INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (app_id, release)
);
