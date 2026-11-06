import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
}));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("../src/ensure-playwright.js", () => ({ ensurePlaywright: ensure }));
const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execSync: exec, spawnSync: exec }));
import { sim } from "../src/sim";

let srv: Server | undefined;
const prev = process.cwd();
afterEach(() => { srv?.close(); srv = undefined; process.chdir(prev); vi.restoreAllMocks(); exec.mockClear(); });

describe("shipvo sim", () => {
  it("prints one line and exits 1 when the port is taken, without rebuilding sim-dist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-"));
    mkdirSync(join(dir, "sim-dist"));
    writeFileSync(join(dir, "sim-dist", "index.html"), "old");
    process.chdir(dir);
    srv = createServer();
    await new Promise<void>((r) => srv!.listen(0, r));
    const port = String((srv.address() as { port: number }).port);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((c: number) => { throw new Error(`exit ${c}`); }) as never);
    await expect(sim(["--port", port])).rejects.toThrow("exit 1");
    expect(err.mock.calls.map((c) => c[0])).toEqual([`Port ${port} is in use. Stop the other \`shipvo sim\` or pass --port <n>.`]);
    expect(exec).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, "sim-dist", "index.html"), "utf8")).toBe("old");
  });

  async function freePort() {
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, r));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    return String(port);
  }
  function appWithStub(stub: string) {
    const dir = mkdtempSync(join(tmpdir(), "sim-"));
    mkdirSync(join(dir, "sim-dist"));
    writeFileSync(join(dir, "sim-dist", "index.html"), "x");
    mkdirSync(join(dir, "node_modules", "@shipvo", "sim"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "@shipvo", "sim", "server.mjs"), stub);
    process.chdir(dir);
  }

  it("prints 'Simulator on' only after the server is listening", async () => {
    appWithStub(`import { createServer } from "node:net";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
setTimeout(() => createServer().listen(port, "127.0.0.1"), 600);
setTimeout(() => process.exit(0), 3000);`);
    const port = await freePort();
    const logs: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((m) => { logs.push(String(m)); });
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const started = Date.now();
    const done = sim(["--port", port, "--skip-build", "true"]);
    await new Promise((r) => setTimeout(r, 250));
    expect(logs.some((l) => l.startsWith("Simulator on"))).toBe(false);
    await done;
    expect(logs.filter((l) => l.startsWith("Simulator on"))).toEqual([
      `Simulator on http://localhost:${port}/app/  (open_app("demo") from @shipvo/mcp; Ctrl-C to stop)`,
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(err).toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledWith({ cwd: process.cwd() });
  });

  it("never prints 'Simulator on' and exits 1 when the server exits without listening", async () => {
    appWithStub(`process.exit(1);`);
    const port = await freePort();
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m) => { logs.push(String(m)); });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await sim(["--port", port, "--skip-build", "true"]);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logs.some((l) => l.startsWith("Simulator on"))).toBe(false);
  });
});
