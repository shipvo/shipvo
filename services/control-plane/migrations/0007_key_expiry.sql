-- User tokens expire. NULL = no expiry (owner-minted keys keep working until revoked).
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
