import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
}));
const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execSync: exec }));
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
});
