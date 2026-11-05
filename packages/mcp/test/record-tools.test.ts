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
});
afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

describe("record tools", () => {
  it("list their schemas", async () => {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env: { ...(process.env as Record<string, string>), PN_SIM: "http://127.0.0.1:1" } }));
    const { tools } = await c.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema as any]));
    expect(Object.keys(by.record_start.properties).sort()).toEqual(["background", "format", "fps", "session", "show_taps", "title"]);
    expect(by.record_start.properties.format.enum).toEqual(["9:16", "16:9", "1:1"]);
    expect(by.record_start.required).toEqual(["session"]);
    expect(by.record_marker.required).toEqual(["session", "caption"]);
    expect(Object.keys(by.record_stop.properties).sort()).toEqual(["music", "narration", "session"]);
    const r: any = await c.callTool({ name: "record_stop", arguments: { session: "x" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("not_recording");
    await c.close();
  });
});
