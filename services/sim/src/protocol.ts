// MCP protocol versions the simulator server speaks, newest first.
export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

/**
 * Clients that are newer than the server (ChatGPT sends a later date) put their own version in the
 * MCP-Protocol-Version header. The SDK refuses a version it does not know with a 400, and the client then
 * fails to connect. This replaces an unknown version with the newest one the server speaks, so the client
 * and server settle on that version, as the initialize handshake already does for the body.
 */
export function negotiateProtocolHeader(headers: Headers): void {
  const v = headers.get("mcp-protocol-version");
  if (v && !SUPPORTED_PROTOCOLS.includes(v.trim())) headers.set("mcp-protocol-version", SUPPORTED_PROTOCOLS[0]);
}
