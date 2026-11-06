-- Which install sent a verified report, so auto-halt can count one vote per install.
-- Additive only. Stays NULL for unverified reports.
ALTER TABLE telemetry ADD COLUMN install_id TEXT;
CREATE INDEX IF NOT EXISTS telemetry_app_release_install ON telemetry(app_id, release, install_id);
