import test from "node:test";
import assert from "node:assert/strict";
import { assistantName } from "./identity.mjs";

test("client names become short, stable assistant names", () => {
  for (const [client, name] of [["claude-ai", "claude"], ["Claude Code", "claude"], ["openai-mcp", "chatgpt"], ["ChatGPT", "chatgpt"], ["Cursor", "cursor"], ["gemini-cli", "gemini"], ["Google", "gemini"], ["My Agent 2", "my-agent-2"], ["GitHub Actions", "github-actions"], ["google-sheets-bot", "google-sheets-bot"], ["Copilot Chat", "copilot"], ["my-gptq-tool", "my-gptq-tool"], ["gpt-4o-client", "chatgpt"], ["???", ""], ["", ""], [undefined, ""]]) {
    assert.equal(assistantName(client), name, String(client));
  }
});
