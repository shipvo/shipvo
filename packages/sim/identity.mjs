// Who is calling the phone. An MCP client names itself when it connects ("openai-mcp", "claude-ai", "Cursor").
// Apps see a short stable name as `caller`, so two assistants on one phone are told apart without being asked.
const KNOWN = [
  [/claude|anthropic/i, "claude"],
  [/chatgpt|openai|gpt/i, "chatgpt"],
  [/cursor/i, "cursor"],
  [/gemini|google/i, "gemini"],
  [/copilot|github|vscode/i, "copilot"],
  [/mistral|le-?chat/i, "mistral"],
];

/** The assistant's short name from the client name it sent, or "" when it sent none. */
export function assistantName(client) {
  const raw = String(client ?? "").trim();
  if (!raw) return "";
  for (const [re, name] of KNOWN) if (re.test(raw)) return name;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
