-- Orders are unverified until the merchant's backend settles them.
-- order_id is NOT unique: apps number orders per customer. Idempotency uses idem (see POST /o/:app).
-- Existing rows keep idem NULL, and SQLite allows many NULLs in a unique index. Nothing is deleted.
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE orders ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN settled_at TEXT;
ALTER TABLE orders ADD COLUMN settlement_ref TEXT;
ALTER TABLE orders ADD COLUMN ip_hash TEXT;
ALTER TABLE orders ADD COLUMN install TEXT;
ALTER TABLE orders ADD COLUMN idem TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_app_idem ON orders(app_id, idem);
CREATE INDEX IF NOT EXISTS orders_app_order ON orders(app_id, order_id);
CREATE INDEX IF NOT EXISTS orders_rate_ip ON orders(app_id, ip_hash, received_at);
CREATE INDEX IF NOT EXISTS orders_rate_install ON orders(app_id, install, received_at);
