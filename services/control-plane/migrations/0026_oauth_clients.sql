-- The hosted MCP (services/sim) shares the purenative database; its deploy applies this folder, so its tables live here too.
-- Dynamic client registration (RFC 7591) for the hosted MCP. Additive; safe to run twice.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,   -- JSON array of strings
  grant_types TEXT NOT NULL,     -- JSON array of strings
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
