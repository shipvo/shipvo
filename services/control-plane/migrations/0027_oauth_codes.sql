-- The hosted MCP (services/sim) shares the purenative database; its deploy applies this folder, so its tables live here too.
-- Pending sign-ins and authorization codes for the hosted MCP. Additive; safe to run twice.
-- Only hashes are stored. kind 'pending' waits for GitHub; kind 'code' waits for POST /token.
CREATE TABLE IF NOT EXISTS oauth_codes (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  client_state TEXT,
  account_id INTEGER,
  key_id INTEGER,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
