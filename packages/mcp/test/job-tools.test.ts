import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// These go through the MCP server (dist/server.js) with a fake `npx` first on PATH, so publish_preview
// runs a script we control instead of the real CLI.
const server = resolve(__dirname, "..", "dist", "server.js");
let dir = "";
const fake = (body: string) => writeFileSync(join(dir, "npx"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });

async function client() {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PN_APP_DIR: dir } as Record<string, string> }));
  return c;
}

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "jobtools-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("job handles through the MCP server", () => {
  it("job_status with an unknown id returns job_not_found", async () => {
    const c = await client();
    const r: any = await c.callTool({ name: "job_status", arguments: { job: "job_doesnotexist" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("job_not_found");
    await c.close();
  });

  it("a tool that outlives wait_ms returns a running handle, then job_status returns done", async () => {
    fake(`sleep 1\necho '{"url":"https://example.test/p","claimUrl":null,"expiresAt":null}'`);
    const c = await client();
    const r: any = await c.callTool({ name: "publish_preview", arguments: { wait_ms: 50 } });
    expect(r.structuredContent.status).toBe("running");
    const job = r.structuredContent.job as string;
    expect(job).toMatch(/^job_/);
    const s: any = await c.callTool({ name: "job_status", arguments: { job, wait_ms: 10_000 } });
    expect(s.structuredContent.status).toBe("done");
    expect(s.structuredContent.result.url).toBe("https://example.test/p");
    await c.close();
  });

  it("a failed job returns ok:false, status failed and a code", async () => {
    fake(`echo boom >&2\nexit 1`);
    const c = await client();
    const r: any = await c.callTool({ name: "publish_preview", arguments: { wait_ms: 10_000 } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, status: "failed", code: "preview_failed" });
    await c.close();
  });
});
