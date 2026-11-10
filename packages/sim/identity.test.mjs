import test from "node:test";
import assert from "node:assert/strict";
import { assistantName } from "./identity.mjs";

test("client names become short, stable assistant names", () => {
  for (const [client, name] of [["claude-ai", "claude"], ["Claude Code", "claude"], ["openai-mcp", "chatgpt"], ["ChatGPT", "chatgpt"], ["Cursor", "cursor"], ["gemini-cli", "gemini"], ["My Agent 2", "my-agent-2"], ["", ""], [undefined, ""]]) {
    assert.equal(assistantName(client), name, String(client));
  }
});
