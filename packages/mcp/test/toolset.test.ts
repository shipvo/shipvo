// SHIPVO_MCP_TOOLS limits the tools the server lists.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = "";
beforeAll(() => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
}, 120000);
afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

async function names(value?: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1" };
  delete env.SHIPVO_MCP_TOOLS; if (value !== undefined) env.SHIPVO_MCP_TOOLS = value;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  const list = (await c.listTools()).tools; await c.close();
  return { list: list.map((t) => t.name).sort(), bytes: JSON.stringify(list).length };
}

describe("SHIPVO_MCP_TOOLS", () => {
  it("core lists the short set, a fraction of the size of the full list", async () => {
    const all = await names(), core = await names("core");
    expect(core.list).toEqual(["back", "device_log", "end_session", "list_apps", "open_app", "open_url", "phone_models", "screen", "screenshot", "scroll", "set_device", "tap", "type", "wait_for_event"]);
    expect(all.list.length).toBeGreaterThan(100);
    expect(core.bytes).toBeLessThan(all.bytes / 3);
  });
  it("a comma list names tools one by one, and all or unset lists every tool", async () => {
    expect((await names("screen, tap,nope")).list).toEqual(["screen", "tap"]);
    expect((await names("all")).list.length).toBe((await names()).list.length);
  });
});
