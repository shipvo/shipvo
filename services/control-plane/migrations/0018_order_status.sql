-- Orders are unverified until the merchant's backend settles them. One order id per app (idempotency).
-- Keep only the first row of any duplicate order id, then enforce uniqueness.
DELETE FROM orders WHERE id NOT IN (SELECT MIN(id) FROM orders GROUP BY app_id, order_id);
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE orders ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN settled_at TEXT;
ALTER TABLE orders ADD COLUMN settlement_ref TEXT;
ALTER TABLE orders ADD COLUMN ip_hash TEXT;
ALTER TABLE orders ADD COLUMN install TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_app_order ON orders(app_id, order_id);
CREATE INDEX IF NOT EXISTS orders_rate_ip ON orders(app_id, ip_hash, received_at);
CREATE INDEX IF NOT EXISTS orders_rate_install ON orders(app_id, install, received_at);
