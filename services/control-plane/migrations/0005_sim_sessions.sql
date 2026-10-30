-- Hosted simulator sessions: one MCP session ↔ one sandbox (sim.shipvo.dev, E2B backend).
CREATE TABLE IF NOT EXISTS sim_sessions (
  mcp_session TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  sandbox_host TEXT NOT NULL,
  app_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
