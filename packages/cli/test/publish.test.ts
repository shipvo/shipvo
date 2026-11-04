import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const exec = vi.hoisted(() => ({ fn: (_cmd: string) => {} }));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execSync: (c: string) => exec.fn(c) }));

const puts: string[] = [];
const values = new Map<string, string>();
const blobs = new Map<string, Uint8Array>();
const stub = {
  get: async (k: string) => values.get(k) ?? null,
  getBytes: async (k: string) => blobs.get(k) ?? null,
  keys: async (prefix: string) => [...values.keys(), ...blobs.keys()].filter((k) => k.startsWith(prefix)),
  put: async (k: string, body: unknown) => { puts.push(k); values.set(k, typeof body === "string" ? body : ""); if (typeof body !== "string") blobs.set(k, body as Uint8Array); },
};
vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
  seed: () => Buffer.alloc(32, 7).toString("base64"),
  kv: () => stub,
}));
import { publish, rollback, dryRunSummary } from "../src/publish";

const fakeHbc = (version: number) => {
  const b = new Uint8Array(64);
  b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
  new DataView(b.buffer).setUint32(8, version, true);
  return b;
};

let cwd: string, prev: string;
beforeEach(() => {
  puts.length = 0; values.clear(); blobs.clear(); exec.fn = () => {};
  prev = process.cwd(); cwd = mkdtempSync(join(tmpdir(), "shipvo-pub-"));
  writeFileSync(join(cwd, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  mkdirSync(join(cwd, "dist-ota/_expo/static/js/android"), { recursive: true });
  process.chdir(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { process.chdir(prev); vi.restoreAllMocks(); });

const withBundle = (v: number) => writeFileSync(join(cwd, "dist-ota/_expo/static/js/android/index.hbc"), fakeHbc(v));
const flags = ["--skip-export", "true", "--skip-web", "true", "--bands", "b0"];

describe("publish and the Hermes bytecode check", () => {
  it("throws on a version mismatch before any upload", async () => {
    withBundle(98);
    await expect(publish([...flags, "--hermes-bytecode-version", "96"])).rejects.toThrow(/version 98/);
    expect(puts).toEqual([]);
  });

  it("records hermes_bytecode_version in the history entry", async () => {
    withBundle(96);
    await publish([...flags, "--hermes-bytecode-version", "96"]);
    expect(JSON.parse(values.get("h/demo/r1")!).hermes_bytecode_version).toBe(96);
    expect(JSON.parse(JSON.parse(values.get("p/demo/1/b0")!).body).hermes_bytecode_version).toBe(96);
  });

  it("gives a helpful error when the flag has no value", async () => {
    withBundle(96);
    await expect(publish([...flags, "--hermes-bytecode-version"])).rejects.toThrow(/pass a value like 96/);
    expect(puts).toEqual([]);
  });

  it("rejects unknown flags before doing anything", async () => {
    withBundle(96);
    await expect(publish([...flags, "--dryrun"])).rejects.toThrow(/Unknown flag --dryrun/);
    expect(puts).toEqual([]);
  });

  it("--dry-run signs and writes a release locally without touching the control plane", async () => {
    withBundle(96);
    await publish([...flags, "--dry-run"]);
    expect(puts).toEqual([]); // the remote store is never used
    const out = join(cwd, ".shipvo/dry-run");
    const ptr = JSON.parse(readFileSync(join(out, "p/demo/1/b0"), "utf8"));
    expect(typeof ptr.signature).toBe("string");
    expect(JSON.parse(ptr.body).release).toBe(1);
    expect(existsSync(join(out, "b/demo/r1.hbc"))).toBe(true);
    const text = String((console.log as any).mock.calls[0][0]);
    expect(text).toContain("Nothing was sent");
    expect(text).toContain("Release:  1");
    expect(text).toMatch(/Size: +\d+\.\d KB/);
    expect(text).not.toContain("0.00 MB");
    expect(text).toContain(".shipvo/dry-run");
    expect(text).toContain("Full bundles are fine for a first release");
    expect(text).not.toMatch(/^\{/);
  });

  it("--out picks the directory", async () => {
    withBundle(96);
    await publish([...flags, "--dry-run", "--out", "out-x"]);
    expect(existsSync(join(cwd, "out-x/h/demo/r1"))).toBe(true);
  });

  it("--out without --dry-run is an error, not a real publish", async () => {
    withBundle(96);
    await expect(publish([...flags, "--out", "x"])).rejects.toThrow(/--out only works with --dry-run/);
    expect(puts).toEqual([]);
  });

  it("--out with no value is an error", async () => {
    withBundle(96);
    await expect(publish([...flags, "--dry-run", "--out"])).rejects.toThrow(/--out needs a directory/);
    expect(puts).toEqual([]);
  });

  it("--release=5 gets a hint", async () => {
    withBundle(96);
    await expect(publish([...flags, "--release=5"])).rejects.toThrow(/--release 5/);
  });

  it("rollback rejects unknown flags before any put", async () => {
    await expect(rollback(["--to", "1", "--bogus"])).rejects.toThrow(/Unknown flag/);
    expect(puts).toEqual([]);
  });

  it("--out followed by a --flag counts as no value", async () => {
    withBundle(96);
    await expect(publish([...flags, "--dry-run", "--out", "--bands", "b0"])).rejects.toThrow(/--out needs a directory/);
  });

  it("dry run writes the web export under w/<app>/r1/ with no remote puts", async () => {
    withBundle(96);
    exec.fn = (c) => { if (c.includes("--platform web")) { mkdirSync(join(cwd, "dist-web"), { recursive: true }); writeFileSync(join(cwd, "dist-web/index.html"), '<script src="/a.js"></script>'); writeFileSync(join(cwd, "dist-web/a.js"), "1"); } };
    await publish(["--skip-export", "true", "--bands", "b0", "--dry-run"]);
    expect(puts).toEqual([]);
    const out = join(cwd, ".shipvo/dry-run");
    expect(readFileSync(join(out, "w/demo/r1/index.html"), "utf8")).toContain('src="/w/demo/r1/a.js"');
    expect(existsSync(join(out, "w/demo/r1/a.js"))).toBe(true);
    expect(JSON.parse(JSON.parse(readFileSync(join(out, "p/demo/1/b0"), "utf8")).body).web).toMatchObject({ base: "/w/demo/r1/", files: 2 });
  });

  it("--platform all: the iOS pointer carries the same web as the Android one", async () => {
    for (const pf of ["android", "ios"]) {
      mkdirSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}`), { recursive: true });
      writeFileSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}/index.hbc`), fakeHbc(96));
    }
    exec.fn = (c) => { if (c.includes("--platform web")) { mkdirSync(join(cwd, "dist-web"), { recursive: true }); writeFileSync(join(cwd, "dist-web/index.html"), "<p>hi</p>"); } };
    await publish(["--skip-export", "true", "--bands", "b0", "--platform", "all", "--dry-run"]);
    const out = join(cwd, ".shipvo/dry-run");
    const web = (f: string) => JSON.parse(JSON.parse(readFileSync(join(out, f), "utf8")).body).web;
    const android = web("p/demo/1/b0"), ios = web("p/demo/1/ios/b0");
    expect(android).toBeTruthy();
    expect(ios).toEqual(android);
  });

  it("a dry run does not read files left by an earlier run", async () => {
    withBundle(96);
    mkdirSync(join(cwd, ".shipvo/dry-run/h/demo"), { recursive: true });
    writeFileSync(join(cwd, ".shipvo/dry-run/h/demo/r7"), JSON.stringify({ release: 7, sha256: "x" }));
    await publish([...flags, "--dry-run"]);
    expect(String((console.log as any).mock.calls[0][0])).toContain("Release:  1");
  });

  it("--help prints the flags and does nothing else", async () => {
    await publish(["--help"]);
    const text = String((console.log as any).mock.calls[0][0]);
    for (const f of ["--bands", "--platform", "--release", "--dry-run", "--out", "--skip-web"]) expect(text).toContain(f);
    expect(puts).toEqual([]);
  });

  it("a first-release dry run never mentions pip", async () => {
    withBundle(96);
    await publish([...flags, "--dry-run"]);
    const all = [...(console.error as any).mock.calls, ...(console.log as any).mock.calls].join("\n");
    expect(all).not.toMatch(/pip/);
  });

  it("shows the pip hint when older bundles exist but bsdiff4 is missing", async () => {
    withBundle(96);
    values.set("h/demo/r1", JSON.stringify({ release: 1, sha256: "abc" }));
    const realKeys = stub.keys;
    stub.keys = async (p: string) => (p === "h/demo/r" ? ["h/demo/r1"] : []);
    exec.fn = (c) => { if (c.includes("import bsdiff4")) throw new Error("no module"); };
    await publish([...flags, "--release", "2"]);
    stub.keys = realKeys; // put the shared stub back so later tests see real keys
    const err = (console.error as any).mock.calls.join("\n");
    expect(err).toMatch(/pip install bsdiff4/);
    expect(err).toMatch(/Updates still work/);
  });

  it("dry run with --release 5 does not say first release", async () => {
    withBundle(96);
    await publish([...flags, "--dry-run", "--release", "5"]);
    const text = String((console.log as any).mock.calls[0][0]);
    expect(text).not.toContain("first release");
    expect(text).toContain("Patches are not built in a dry run");
  });

  it("summary: bases exist but bsdiff4 is missing points to pip", () => {
    const text = dryRunSummary(2, 5000, "out", { bases: 2, bsdiff: false, patches: 0 });
    expect(text).not.toContain("first release");
    expect(text).toContain("Patches were skipped");
    expect(text).toContain("pip install bsdiff4");
  });

  it("summary: bases exist and patches were built shows the count", () => {
    const text = dryRunSummary(2, 5000, "out", { bases: 2, bsdiff: true, patches: 2 });
    expect(text).not.toContain("first release");
    expect(text).not.toContain("pip");
    expect(text).toContain("Patches built: 2");
  });

  it("summary: sizes switch to MB at 1 MB", () => {
    expect(dryRunSummary(1, 2 * 1048576, "out")).toContain("2.00 MB");
    expect(dryRunSummary(1, 64 * 1024, "out")).toContain("64.0 KB");
  });

  it("iOS patches start only from earlier iOS releases, Android only from Android", async () => {
    // Stand-in for bsdiff4: the import check passes and the diff command writes a small patch file.
    exec.fn = (c) => { const m = c.match(/'([^']*p\.bsdiff)'/); if (m) writeFileSync(m[1], new Uint8Array(10).fill(1)); };
    const make = (tag: number) => { const b = fakeHbc(96); b[20] = tag; return b; }; // the tag makes each bundle's hash different
    const bundle = (pf: string, tag: number) => {
      mkdirSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}`), { recursive: true });
      writeFileSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}/index.hbc`), make(tag));
    };
    const sha = (tag: number) => createHash("sha256").update(make(tag)).digest("hex");
    const run = (release: number) => publish(["--skip-export", "true", "--skip-web", "true", "--bands", "b0", "--platform", "all", "--release", String(release)]);
    bundle("android", 1); bundle("ios", 2); await run(1);
    bundle("android", 3); bundle("ios", 4); await run(2);

    const core = (key: string) => JSON.parse(JSON.parse(values.get(key)!).body).core;
    const ios = core("p/demo/1/ios/b0"), android = core("p/demo/1/b0");
    expect(ios.patches.map((p: any) => p.from_sha256)).toEqual([sha(2)]);
    expect(ios.patches[0].url).toBe(`b/demo/ios-d-${sha(2).slice(0, 16)}-r2.bsdiff`);
    expect(android.patches.map((p: any) => p.from_sha256)).toEqual([sha(1)]);
    expect(android.patches[0].url).toBe(`b/demo/d-${sha(1).slice(0, 16)}-r2.bsdiff`);
    expect(puts).toContain(ios.patches[0].url);
  });
});
