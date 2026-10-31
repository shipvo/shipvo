-- The sample app is listed from day one, owned by the account that signed in first (Hansade2005).
INSERT OR IGNORE INTO apps (app_id, account_id, name, public_key, description, category, listed, approved, latest_release, published_at)
SELECT 'tide', id, 'Tide & Tackle', 'oERUkFs2xdjaEm9xAPZDULoDLV9gjksjyDvSJ9lSYZE=',
  'Fishing-supplies shop in Douala: catalogue, cart, promo codes, delivery slots, barcode scanning, location, cash or mobile money with a fingerprint.',
  'shop', 1, 1, 21, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM accounts WHERE github_login = 'Hansade2005' LIMIT 1;
