-- Telemetry trust (#733). Additive: four columns with safe defaults. Old rows and old runtimes are `verified = 0`.
-- Only verified rows count toward auto-halt. `net_hash` is a salted hash of the /24 (IPv4) or /48 (IPv6); the IP is never stored.
ALTER TABLE telemetry ADD COLUMN install_id TEXT;
ALTER TABLE telemetry ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry ADD COLUMN net_hash TEXT;
ALTER TABLE telemetry ADD COLUMN fresh INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS telemetry_verified ON telemetry(app_id, release, verified, event);
