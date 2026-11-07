// The `--hosted` path in sim.ts, with the build-and-upload step replaced (the real key check is tested in sim-hosted.test.ts).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
const upload = vi.hoisted(() => ({ fn: null as null | (() => Promise<unknown>) }));
vi.mock("../src/sim-hosted.js", () => ({
  HostedError: class HostedError extends Error { constructor(public code: string, message: string) { super(message); } },
  simHosted: () => upload.fn!(),
}));
import { sim } from "../src/sim.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("shipvo sim --hosted", () => {
  let dir = "", cwd = "", out: string[] = [], err: string[] = [];
  const saved = { key: process.env.SHIPVO_API_KEY, home: process.env.SHIPVO_HOME };
  beforeEach(() => {
    cwd = process.cwd(); dir = mkdtempSync(join(tmpdir(), "hosted-cli-"));
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "menu", controlPlane: "http://127.0.0.1:1", publicKey: "k" })); process.chdir(dir);
    process.env.SHIPVO_HOME = join(dir, "home"); delete process.env.SHIPVO_API_KEY;
    out = []; err = []; process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
  });
  afterEach(() => {
    vi.restoreAllMocks(); upload.fn = null; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); process.exitCode = undefined;
    for (const [k, v] of [["SHIPVO_API_KEY", saved.key], ["SHIPVO_HOME", saved.home]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("without a key, --json gives no_api_key", async () => {
    upload.fn = async () => { throw new (await import("../src/sim-hosted.js")).HostedError("no_api_key", "No API key for the hosted phone. Run `shipvo login` or set SHIPVO_API_KEY."); };
    await sim(["--hosted", "--json"]);
    const d = JSON.parse(out.at(-1)!);
    expect(d).toMatchObject({ ok: false, code: "no_api_key" });
    expect(process.exitCode).toBe(1);
  });
  it("without a key, text mode says to log in and exits 1", async () => {
    upload.fn = async () => { throw new (await import("../src/sim-hosted.js")).HostedError("no_api_key", "No API key for the hosted phone. Run `shipvo login` or set SHIPVO_API_KEY."); };
    await expect(sim(["--hosted"])).rejects.toThrow("exit 1");
    expect(err.join("\n")).toMatch(/shipvo login/);
  });
  it("on success prints the build id and the open_app line", async () => {
    upload.fn = async () => ({ id: "b9", expires_at: "2026-11-08T00:00:00Z", bytes: 5 });
    await sim(["--hosted"]);
    const text = err.join("\n");
    expect(text).toContain("Build b9");
    expect(text).toContain('open_app("menu@build:b9")');
    expect(text).toContain("2026-11-08T00:00:00Z");
  });
  it("on success --json carries the id, expiry and open_app string", async () => {
    upload.fn = async () => ({ id: "b9", expires_at: "2026-11-08T00:00:00Z", bytes: 5 });
    await sim(["--hosted", "--json"]);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ ok: true, code: "uploaded", data: { build_id: "b9", expires_at: "2026-11-08T00:00:00Z", bytes: 5, open_app: "menu@build:b9" } });
    expect(process.exitCode).toBe(0);
  });
});
