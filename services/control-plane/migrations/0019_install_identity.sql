-- Install identity: which telemetry comes from a real install.
-- Additive only. net_hash is a salted hash of the /24 (IPv4) or /48 (IPv6); the IP is never stored.
CREATE TABLE IF NOT EXISTS installs (
  app_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  shell_version TEXT,
  net_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (app_id, install_id)
);
ALTER TABLE telemetry ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
