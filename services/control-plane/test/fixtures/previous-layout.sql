-- Snapshot of the control-plane database as left by the previous layout (migrations 0001 to 0021_alert_sent_unverified).
-- Regenerate only when the baseline moves: apply those migrations to an empty SQLite file and dump it.
BEGIN TRANSACTION;
CREATE TABLE telemetry (
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
, via TEXT, verified INTEGER NOT NULL DEFAULT 0, install_id TEXT);
CREATE TABLE content_versions (
  app_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, published_at TEXT NOT NULL,
  published_by TEXT NOT NULL, note TEXT, PRIMARY KEY (app_id, version)
);
CREATE TABLE content_draft (app_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, order_id TEXT NOT NULL, total INTEGER NOT NULL,
  json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, status TEXT NOT NULL DEFAULT 'unverified', idem TEXT);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  command TEXT NOT NULL, args_json TEXT, ok INTEGER NOT NULL
);
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('test','owner','read')),
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT
, account_id INTEGER, quota_minutes INTEGER NOT NULL DEFAULT 600, used_minutes INTEGER NOT NULL DEFAULT 0, expires_at TEXT);
CREATE TABLE sim_sessions (
  mcp_session TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  sandbox_host TEXT NOT NULL,
  app_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, rev TEXT);
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE TABLE device_logins (
  device_code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE apps (
  app_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  bytes_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other', listed INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0, latest_release INTEGER, published_at TEXT, opens INTEGER NOT NULL DEFAULT 0, tagline TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', last_opened_at TEXT, sessions_7d INTEGER NOT NULL DEFAULT 0);
CREATE TABLE publish_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
, role TEXT);
CREATE TABLE app_alerts (
  app_id TEXT PRIMARY KEY,
  webhook TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE alert_sent (
  app_id TEXT NOT NULL,
  release INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (app_id, release)
);
CREATE TABLE telemetry_export (
  app_id TEXT PRIMARY KEY,
  last_id INTEGER NOT NULL DEFAULT 0,
  exported_at TEXT
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','agent','system')),
  action TEXT NOT NULL CHECK (action IN ('publish','rollback','halt')),
  release INTEGER,
  release_id TEXT,
  before TEXT,
  after TEXT
);
CREATE TABLE installs (
  app_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  shell_version TEXT,
  net_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (app_id, install_id)
);
CREATE TABLE vault_tickets (
  id_hash TEXT PRIMARY KEY,            -- SHA-256 of the ticket id; the id itself is never stored
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  domain TEXT NOT NULL,
  access TEXT NOT NULL,                -- 'read' or 'write': what the person is asked for
  purpose TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE vault_secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  access TEXT NOT NULL,                -- 'read' or 'write', as found by the verification call
  warning TEXT,                        -- set when the key is full access
  valid INTEGER,                       -- 1 valid, 0 refused by the service, NULL not checked
  wrapped_key TEXT NOT NULL,           -- per-secret data key, encrypted with the master key
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (app_id, name)
);
CREATE TABLE alert_sent_unverified (
  app_id TEXT NOT NULL,
  release INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (app_id, release)
);
CREATE INDEX telemetry_app_release ON telemetry(app_id, release);
CREATE INDEX orders_app ON orders(app_id, id);
CREATE INDEX audit_app ON audit(app_id, id);
CREATE INDEX api_keys_app ON api_keys(app_id, revoked_at);
CREATE INDEX api_keys_account ON api_keys(account_id, revoked_at);
CREATE INDEX apps_account ON apps(account_id);
CREATE INDEX publish_tokens_app ON publish_tokens(app_id, revoked_at);
CREATE INDEX audit_log_app_id ON audit_log (app_id, id);
CREATE UNIQUE INDEX orders_idem ON orders(app_id, idem);
CREATE INDEX telemetry_app_release_install ON telemetry(app_id, release, install_id);
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_telemetry.sql');
INSERT INTO d1_migrations (name) VALUES ('0002_telemetry_via.sql');
INSERT INTO d1_migrations (name) VALUES ('0003_content_admin.sql');
INSERT INTO d1_migrations (name) VALUES ('0004_api_keys.sql');
INSERT INTO d1_migrations (name) VALUES ('0005_sim_sessions.sql');
INSERT INTO d1_migrations (name) VALUES ('0006_accounts.sql');
INSERT INTO d1_migrations (name) VALUES ('0007_key_expiry.sql');
INSERT INTO d1_migrations (name) VALUES ('0008_apps.sql');
INSERT INTO d1_migrations (name) VALUES ('0009_publish_tokens.sql');
INSERT INTO d1_migrations (name) VALUES ('0010_sim_rev.sql');
INSERT INTO d1_migrations (name) VALUES ('0011_marketplace.sql');
INSERT INTO d1_migrations (name) VALUES ('0012_seed_tide.sql');
INSERT INTO d1_migrations (name) VALUES ('0013_store.sql');
INSERT INTO d1_migrations (name) VALUES ('0014_alert_webhook.sql');
INSERT INTO d1_migrations (name) VALUES ('0015_telemetry_export.sql');
INSERT INTO d1_migrations (name) VALUES ('0016_audit_log.sql');
INSERT INTO d1_migrations (name) VALUES ('0017_token_role.sql');
INSERT INTO d1_migrations (name) VALUES ('0018_order_status.sql');
INSERT INTO d1_migrations (name) VALUES ('0019_install_identity.sql');
INSERT INTO d1_migrations (name) VALUES ('0020_telemetry_install_id.sql');
INSERT INTO d1_migrations (name) VALUES ('0021_vault.sql');
INSERT INTO d1_migrations (name) VALUES ('0021_alert_sent_unverified.sql');
-- Rows written by the previous release.
INSERT INTO accounts (github_id, github_login) VALUES (4242, 'upgrade-owner');
INSERT INTO apps (app_id, account_id, name, public_key, description, category, listed, approved, latest_release, published_at)
  VALUES ('upgrade-app', (SELECT id FROM accounts WHERE github_id = 4242), 'Upgrade App', 'pk-upgrade-fixture', 'kept across upgrades', 'other', 1, 1, 3, '2026-10-01T10:00:00.000Z');
INSERT INTO content_versions (app_id, version, json, published_at, published_by, note) VALUES
  ('upgrade-app', 1, '{"title":"one"}', '2026-09-01T10:00:00.000Z', 'upgrade-owner', 'first'),
  ('upgrade-app', 2, '{"title":"two"}', '2026-09-15T10:00:00.000Z', 'upgrade-owner', NULL),
  ('upgrade-app', 3, '{"title":"three"}', '2026-10-01T10:00:00.000Z', 'upgrade-owner', 'latest');
INSERT INTO installs (app_id, install_id, key_hash, shell_version, net_hash) VALUES
  ('upgrade-app', 'inst-1', 'hash-1', '1.1.0', 'net-1'),
  ('upgrade-app', 'inst-2', 'hash-2', '1.1.0', NULL);
INSERT INTO audit_log (app_id, at, actor, actor_kind, action, release, release_id, before, after) VALUES
  ('upgrade-app', '2026-10-01T10:00:00.000Z', 'upgrade-owner', 'person', 'publish', 3, 'rel-3', '2', '3'),
  ('upgrade-app', '2026-10-02T10:00:00.000Z', 'upgrade-owner', 'person', 'rollback', 2, 'rel-2', '3', '2');
COMMIT;
