import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lumi } from "../src/lumi.js";

const cwd = process.cwd();

/** A port the OS just gave away, so parallel test files cannot collide on a fixed one. */
function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
  });
}
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); });

function app(kit: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "lumi-dev-"));
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "dev.tide", controlPlane: "http://x", publicKey: "k" }));
  if (kit !== null) {
    const m = join(dir, "node_modules", "@shipvo", "test");
    mkdirSync(m, { recursive: true });
    writeFileSync(join(m, "package.json"), JSON.stringify({ name: "@shipvo/test", version: "0.0.0", type: "module", main: "index.js" }));
    writeFileSync(join(m, "index.js"), kit);
  }
  process.chdir(dir);
  return dir;
}

describe("shipvo lumi --device", () => {
  it("rejects an unknown device", async () => {
    app(null);
    await expect(lumi(["--device", "toaster", "--ui-port", String(await freePort())])).rejects.toThrow('--device must be "agent-device" or "phone"');
  });

  it("says to install @shipvo/test when it is missing", async () => {
    app(null);
    await expect(lumi(["--device", "agent-device", "--ui-port", String(await freePort())])).rejects.toThrow("Install @shipvo/test");
  });

  it("asks for a newer @shipvo/test when it has no agent-device driver", async () => {
    app("export {};\n");
    await expect(lumi(["--device", "agent-device", "--ui-port", String(await freePort())])).rejects.toThrow("too old for --device agent-device");
  });

  it("with agent-device it starts no simulator and serves the screenshot from the driver", async () => {
    app(`export function agentDeviceDriver(app, o) {
  const ok = { ok: true, screen: '- heading "Home" [ref=e1]' };
  return { open: async () => ok, openUrl: async () => ok, tap: async () => ok, back: async () => ok, type: async () => ok,
    snapshot: async () => ok, errors: async () => [], sizes: async () => ({}), screenshot: async () => new Uint8Array([1, 2, 3]) };
}\n`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const port = await freePort();
    const done = lumi(["--device", "agent-device", "--no-open", "--ui-port", String(port)]);
    let body: Buffer | undefined;
    for (let i = 0; i < 100 && !body; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/shot`); if (r.status === 200) body = Buffer.from(await r.arrayBuffer()); }
      catch { /* server not up yet */ }
      if (!body) await new Promise((r) => setTimeout(r, 100));
    }
    process.emit("SIGINT");
    expect(await done).toBe(0);
    expect([...(body ?? [])]).toEqual([1, 2, 3]);
  });
});
