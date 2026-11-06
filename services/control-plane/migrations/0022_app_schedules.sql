-- Schedules declared by apps, run by one dispatcher on the control plane's single scheduled tick. Additive only.
CREATE TABLE IF NOT EXISTS app_schedules (
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,                  -- five-field cron expression, UTC
  next_run_at TEXT NOT NULL,           -- ISO time; the schedule is due when this is <= now
  last_run_at TEXT,
  last_status TEXT,                    -- 'ok', or 'error: <message>'
  running_at TEXT,                     -- set while a run is in flight; stops a second start
  PRIMARY KEY (app, name)
);
CREATE INDEX IF NOT EXISTS app_schedules_due ON app_schedules(next_run_at);
