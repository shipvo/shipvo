-- Specs the runner loads, and the latest result of each schedule run per person. Additive only.
CREATE TABLE IF NOT EXISTS app_specs (
  app_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_run_results (
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  person INTEGER NOT NULL,
  result TEXT NOT NULL,                -- trimmed JSON; never holds a secret value
  at TEXT NOT NULL,
  PRIMARY KEY (app_id, name, person)
);
