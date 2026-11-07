-- Hosted phone: one row per request the network proxy handled, allowed or refused. Additive only.
-- No query string, header or body is stored: only who, which app, which host and what happened.
CREATE TABLE IF NOT EXISTS device_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  method TEXT,
  host TEXT,
  path TEXT,
  status INTEGER,
  refusal TEXT,
  ms INTEGER,
  bytes_out INTEGER,
  bytes_in INTEGER
);
CREATE INDEX IF NOT EXISTS device_log_person ON device_log(person_id, id);
