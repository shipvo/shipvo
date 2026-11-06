-- Orders: payment status and an idempotency key. Additive only.
-- Existing rows get status 'unverified' and no key; the unique index allows many NULL keys.
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE orders ADD COLUMN idem TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idem ON orders(app_id, idem);
