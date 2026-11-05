import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyFromSeed, b64, signBytes } from "../src/index";
import { verifyPointer } from "../src/verify";

const values = new Map<string, string>();
const stub = {
  get: async (k: string) => values.get(k) ?? null,
  put: async (k: string, body: unknown) => { values.set(k, String(body)); },
};
const SEED = Buffer.alloc(32, 7).toString("base64");
vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
  seed: () => Buffer.alloc(32, 7).toString("base64"),
  kv: () => stub,
}));
import { promote } from "../src/promote";

const pub = b64(keyFromSeed(SEED).publicKey);
const put = (key: string, release: number, platform?: string) => {
  const body = JSON.stringify({ schema_version: "1.0", app_id: "demo", band: "b0", ...(platform ? { platform } : {}), release, issued_at: "2020-01-01T00:00:00.000Z", core: { sha256: "abc", patches: [{ size: 1 }] } });
  values.set(key, JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }));
};
const summary = (s: object): typeof fetch => (async () => ({ ok: true, json: async () => s })) as unknown as typeof fetch;
const ok = summary({ releases: [{ release: 3, events: { applied: 4 } }], halted: null });

let logs: string[], prev: string;
beforeEach(() => {
  values.clear(); logs = [];
  prev = process.cwd(); process.chdir(mkdtempSync(join(tmpdir(), "shipvo-promote-")));
  vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(m); });
});
afterEach(() => { process.chdir(prev); vi.restoreAllMocks(); });

describe("promote", () => {
  it("copies b0 to b1 and b2 with the same release, valid signatures and a fresh issued_at", async () => {
    put("p/demo/1/b0", 3);
    await promote([], { fetchFn: ok });
    for (const b of ["b1", "b2"]) {
      const raw = values.get(`p/demo/1/${b}`)!;
      expect(verifyPointer(raw, pub)).toBe(true);
      const body = JSON.parse(JSON.parse(raw).body);
      expect(body).toMatchObject({ release: 3, band: b, core: { sha256: "abc", patches: [{ size: 1 }] } });
      expect(body.issued_at).not.toBe("2020-01-01T00:00:00.000Z");
    }
    expect(logs.filter((l) => l.startsWith("Wrote"))).toHaveLength(2);
  });
  it("handles iOS keys and --to", async () => {
    put("p/demo/1/ios/b0", 3, "ios");
    await promote(["--platform", "ios", "--to", "b1"], { fetchFn: ok });
    expect(values.has("p/demo/1/ios/b1")).toBe(true);
    expect(values.has("p/demo/1/ios/b2")).toBe(false);
    expect(JSON.parse(JSON.parse(values.get("p/demo/1/ios/b1")!).body).platform).toBe("ios");
  });
  it("skips bands that already have this release", async () => {
    put("p/demo/1/b0", 3); put("p/demo/1/b1", 3);
    await promote([], { fetchFn: ok });
    expect(logs.filter((l) => l.startsWith("Wrote")).map((l) => l.slice(6, 8))).toEqual(["b2"]);
  });
  it("never overwrites a newer release on a wider band", async () => {
    put("p/demo/1/b0", 3); put("p/demo/1/b1", 5);
    const rel = (k: string) => JSON.parse(JSON.parse(values.get(k)!).body).release;
    await promote([], { fetchFn: ok });
    expect(rel("p/demo/1/b1")).toBe(5);
    expect(rel("p/demo/1/b2")).toBe(3);
    expect(logs.join("\n")).toMatch(/Skipped b1 \(android\): it already has release 5, which is newer than 3/);
    logs.length = 0;
    await promote(["--to", "b1"], { fetchFn: ok, });
    expect(rel("p/demo/1/b1")).toBe(5);
    expect(logs.some((l) => l.startsWith("Wrote b1"))).toBe(false);
    await promote(["--to", "b1", "--force"], { fetchFn: ok });
    expect(rel("p/demo/1/b1")).toBe(5);
  });
  it("rejects --to with only the source band", async () => {
    put("p/demo/1/b0", 3);
    await expect(promote(["--to", "b0"], { fetchFn: ok })).rejects.toThrow(/b0 is the source band/);
  });
  it("refuses a halted release, and --force overrides", async () => {
    put("p/demo/1/b0", 3);
    const halted = summary({ releases: [], halted: { release: 3 } });
    await expect(promote([], { fetchFn: halted })).rejects.toThrow(/Release 3 is halted.*--force/);
    expect(values.has("p/demo/1/b1")).toBe(false);
    await promote(["--force"], { fetchFn: halted });
    expect(values.has("p/demo/1/b1")).toBe(true);
  });
  it("refuses a release with reverts", async () => {
    put("p/demo/1/b0", 3);
    await expect(promote([], { fetchFn: summary({ releases: [{ release: 3, events: { crash_loop_revert: 2 } }] }) })).rejects.toThrow(/Release 3 has 2 reported reverts/);
  });
  it("--dry-run writes nothing", async () => {
    put("p/demo/1/b0", 3);
    await promote(["--dry-run"], { fetchFn: ok });
    expect([...values.keys()]).toEqual(["p/demo/1/b0"]);
    expect(logs.join("\n")).toMatch(/Would write b1/);
  });
  it("rejects unknown flags and bands", async () => {
    await expect(promote(["--dryrun"])).rejects.toThrow(/Unknown flag --dryrun/);
    put("p/demo/1/b0", 3);
    await expect(promote(["--to", "b9"], { fetchFn: ok })).rejects.toThrow(/Unknown band b9/);
  });
  describe("test report gate", () => {
    const report = (release: unknown, failed: string[]) => writeFileSync("shipvo-test-report.json", JSON.stringify({ release, flows: [{ name: "ok.flow", status: "passed" }, ...failed.map((name) => ({ name, status: "failed" }))] }));
    it("blocks a failing report for the same release and names the flows", async () => {
      put("p/demo/1/b0", 3); report("3", ["login.flow", "cart.flow"]);
      await expect(promote([], { fetchFn: ok })).rejects.toThrow(/login\.flow, cart\.flow/);
      expect(values.has("p/demo/1/b1")).toBe(false);
    });
    it("passing, stale and missing reports promote; stale warns", async () => {
      put("p/demo/1/b0", 3); report("3", []);
      await promote([], { fetchFn: ok });
      expect(values.has("p/demo/1/b1")).toBe(true);
      values.delete("p/demo/1/b1"); values.delete("p/demo/1/b2"); logs = [];
      report("2", ["login.flow"]);
      await promote([], { fetchFn: ok });
      expect(values.has("p/demo/1/b1")).toBe(true);
      expect(logs.join("\n")).toMatch(/Warning: .*stale/);
    });
    it("promotes with no report file", async () => {
      put("p/demo/1/b0", 3);
      await promote([], { fetchFn: ok });
      expect(values.has("p/demo/1/b1")).toBe(true);
    });
    it("--force overrides and says so", async () => {
      put("p/demo/1/b0", 3); report(3, ["login.flow"]);
      await promote(["--force"], { fetchFn: ok });
      expect(values.has("p/demo/1/b1")).toBe(true);
      expect(logs.join("\n")).toMatch(/login\.flow.*Overridden by --force/);
    });
    it("--dry-run shows the block, and --report picks the file", async () => {
      put("p/demo/1/b0", 3); report(3, ["login.flow"]);
      await expect(promote(["--dry-run"], { fetchFn: ok })).rejects.toThrow(/login\.flow/);
      writeFileSync("other.json", JSON.stringify({ release: 3, flows: [] }));
      await promote(["--dry-run", "--report", "other.json"], { fetchFn: ok });
      expect(logs.join("\n")).toMatch(/Would write b1/);
    });
  });
});
