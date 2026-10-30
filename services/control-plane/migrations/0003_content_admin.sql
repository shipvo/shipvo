CREATE TABLE IF NOT EXISTS content_versions (
  app_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, published_at TEXT NOT NULL,
  published_by TEXT NOT NULL, note TEXT, PRIMARY KEY (app_id, version)
);
CREATE TABLE IF NOT EXISTS content_draft (app_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, order_id TEXT NOT NULL, total INTEGER NOT NULL,
  json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS orders_app ON orders(app_id, id);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  command TEXT NOT NULL, args_json TEXT, ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_app ON audit(app_id, id);
