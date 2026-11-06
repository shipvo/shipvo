import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const exec = vi.hoisted(() => ({ fn: (_cmd: string, _opts?: { env?: NodeJS.ProcessEnv }) => {} }));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execSync: (c: string, o?: { env?: NodeJS.ProcessEnv }) => exec.fn(c, o) }));

const cfgPolicy = vi.hoisted(() => ({ value: undefined as unknown, engine: undefined as string | undefined }));
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
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k", ...(cfgPolicy.value ? { policy: cfgPolicy.value } : {}), ...(cfgPolicy.engine ? { hermesEngine: cfgPolicy.engine } : {}) }),
  seed: () => Buffer.alloc(32, 7).toString("base64"),
  kv: () => stub,
  hasStore: () => true,
}));
import { publish, rollback, dryRunSummary, isInside } from "../src/publish";
import path from "node:path";

const fakeHbc = (version: number) => {
  const b = new Uint8Array(64);
  b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
  new DataView(b.buffer).setUint32(8, version, true);
  return b;
};

let cwd: string, prev: string;
beforeEach(() => {
  cfgPolicy.value = undefined; cfgPolicy.engine = undefined; process.exitCode = undefined; puts.length = 0; values.clear(); blobs.clear(); exec.fn = () => {};
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

describe("publish and native modules", () => {
  const fixture = () => {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ dependencies: { "react-native-camera-kit": "^14.0.0", "@scope/maps": "~2.1.0", "plain-js": "^1.0.0", local: "workspace:*" } }));
    mkdirSync(join(cwd, "node_modules/react-native-camera-kit/android"), { recursive: true });
    mkdirSync(join(cwd, "node_modules/@scope/maps"), { recursive: true });
    writeFileSync(join(cwd, "node_modules/@scope/maps/Maps.podspec"), "");
    mkdirSync(join(cwd, "node_modules/plain-js"), { recursive: true });
    mkdirSync(join(cwd, "node_modules/local/ios"), { recursive: true });
  };
  it("records required_native_modules and prints them in --dry-run", async () => {
    fixture(); withBundle(96);
    await publish([...flags, "--dry-run"]);
    const want = { "@scope/maps": "~2.1.0", "react-native-camera-kit": "^14.0.0" };
    expect(JSON.parse(JSON.parse(readFileSync(join(cwd, ".shipvo/dry-run/p/demo/1/b0"), "utf8")).body).required_native_modules).toEqual(want);
    const err = (console.error as any).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(err).toContain("@scope/maps@~2.1.0, react-native-camera-kit@^14.0.0");
  });
  it("reports native dependencies it skips, such as pre-release ranges", async () => {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ dependencies: { "react-native-beta": "^1.0.0-beta.1", "react-native-ok": "^1.0.0" } }));
    for (const n of ["react-native-beta", "react-native-ok"]) mkdirSync(join(cwd, "node_modules", n, "ios"), { recursive: true });
    withBundle(96);
    await publish([...flags, "--dry-run"]);
    const err = (console.error as any).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(err).toContain("not recorded");
    expect(err).toContain("react-native-beta@^1.0.0-beta.1");
    expect(err).toContain("requires: react-native-ok@^1.0.0");
  });
  it("omits the field when no dependency is native", async () => {
    withBundle(96);
    await publish([...flags]);
    expect(JSON.parse(JSON.parse(values.get("p/demo/1/b0")!).body).required_native_modules).toBeUndefined();
  });
});

const withCompiler = (v: string) => {
  mkdirSync(join(cwd, "node_modules/hermes-compiler"), { recursive: true });
  writeFileSync(join(cwd, "node_modules/hermes-compiler/package.json"), JSON.stringify({ name: "hermes-compiler", version: v }));
};

describe("publish and the Hermes engine check", () => {
  it("refuses a different engine build with the same bytecode version, before any upload", async () => {
    withBundle(98); withCompiler("250829098.0.16"); cfgPolicy.engine = "250829098.0.10";
    await expect(publish([...flags, "--hermes-bytecode-version", "98"])).rejects.toThrow(/250829098\.0\.10.*250829098\.0\.16/);
    expect(puts).toEqual([]);
  });
  it("records hermes_engine when declared and installed match", async () => {
    withBundle(98); withCompiler("250829098.0.10"); cfgPolicy.engine = "250829098.0.10";
    await publish([...flags]);
    expect(JSON.parse(values.get("h/demo/r1")!).hermes_engine).toBe("250829098.0.10");
  });
  it("records the installed engine when nothing is declared", async () => {
    withBundle(98); withCompiler("250829098.0.16");
    await publish([...flags]);
    expect(JSON.parse(values.get("h/demo/r1")!).hermes_engine).toBe("250829098.0.16");
  });
  it("behaves as before when there is no declaration and no compiler", async () => {
    withBundle(98);
    await publish([...flags]);
    expect(JSON.parse(values.get("h/demo/r1")!).hermes_engine).toBeUndefined();
  });
});

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

  it("--dry-run refuses by policy: exits non-zero, prints rule and reason, writes nothing", async () => {
    withBundle(96);
    cfgPolicy.value = { maxBand: "b0" };
    await publish(["--skip-export", "true", "--skip-web", "true", "--bands", "b0,b1", "--dry-run"]);
    expect(process.exitCode).toBe(1);
    const msg = (console.error as any).mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(msg).toMatch(/Refused by policy rule maxBand: .*b1.*b0/);
    expect(existsSync(join(cwd, ".shipvo/dry-run/p/demo/1/b0"))).toBe(false);
    process.exitCode = undefined;
  });

  describe("--dry-run-policy", () => {
    const run = async (extra: string[]) => {
      withBundle(96);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await publish([...extra, "--dry-run-policy"]);
      const out = log.mock.calls.map((c) => String(c[0])).join("\n");
      log.mockRestore();
      return out;
    };
    afterEach(() => { process.exitCode = undefined; });

    it("ok: prints that the policy allows it, exit 0, publishes nothing", async () => {
      cfgPolicy.value = { maxBand: "b1" };
      const out = await run(["--bands", "b0,b1"]);
      expect(out).toMatch(/Policy allows/);
      expect(process.exitCode).toBeUndefined();
      expect(puts).toEqual([]);
      expect(existsSync(join(cwd, ".shipvo/dry-run"))).toBe(false);
    });

    it("refused: prints rule and reason, exit 1, publishes nothing", async () => {
      cfgPolicy.value = { maxBand: "b0" };
      await run(["--bands", "b0,b1"]);
      expect(process.exitCode).toBe(1);
      const msg = (console.error as any).mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(msg).toMatch(/Refused by policy rule maxBand: .*b1.*b0/);
      expect(puts).toEqual([]);
    });

    it("no policy: says so, exit 0, publishes nothing", async () => {
      cfgPolicy.value = undefined;
      const out = await run([]);
      expect(out).toMatch(/No policy/);
      expect(process.exitCode).toBeUndefined();
      expect(puts).toEqual([]);
    });
  });

  it("--dry-run passes a policy that allows the publish", async () => {
    withBundle(96);
    cfgPolicy.value = { maxBand: "b0" };
    await publish([...flags, "--dry-run"]);
    expect(process.exitCode).toBeUndefined();
    expect(existsSync(join(cwd, ".shipvo/dry-run/p/demo/1/b0"))).toBe(true);
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

  describe("rollback --dry-run", () => {
    const seedRelease = () => { blobs.set("b/demo/r1.hbc", fakeHbc(96)); values.set("h/demo/r1", JSON.stringify({ min_shell_version: "1.2.0" })); };
    it("makes no put calls and prints the summary", async () => {
      seedRelease();
      await rollback(["--to", "1", "--bands", "b0,b1", "--dry-run"]);
      expect(puts).toEqual([]);
      const text = String((console.log as any).mock.calls[0][0]);
      expect(text).toContain("demo");
      expect(text).toContain("code of release 1");
      expect(text).toContain("New release number: ");
      expect(text).toContain("Platforms: android");
      expect(text).toContain("Bands: b0, b1");
      expect(text).toContain("Min shell version: 1.2.0");
      expect(text).toContain("Dry run: nothing was written.");
    });
    it("still exits 1 when the bundle is missing", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
      await expect(rollback(["--to", "9", "--dry-run"])).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith("Release 9 android bundle not found");
      expect(puts).toEqual([]);
    });
    it("without the flag, pointers are written and the output is JSON", async () => {
      seedRelease();
      await rollback(["--to", "1", "--bands", "b0,b1"]);
      expect(puts.length).toBe(2);
      expect(JSON.parse(String((console.log as any).mock.calls[0][0])).rolled_back_to_code_of).toBe(1);
    });
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

  it("dry run prints the web artifact folder relative to the current folder, and it exists", async () => {
    withBundle(96);
    exec.fn = (c) => { if (c.includes("--platform web")) { mkdirSync(join(cwd, "dist-web"), { recursive: true }); writeFileSync(join(cwd, "dist-web/index.html"), "<p>hi</p>"); } };
    await publish(["--skip-export", "--bands", "b0", "--dry-run", "--out", "o2"]);
    const err = (console.error as any).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    const m = err.match(/web artifact: 1 files at (\S+)/);
    expect(m![1]).toBe("o2/w/demo/r1/");
    expect(existsSync(join(cwd, m![1]))).toBe(true);
  });

  it("bare --skip-web and --skip-export behave like true", async () => {
    withBundle(96);
    exec.fn = (c) => { if (c.includes("expo export")) throw new Error("should not run: " + c); };
    await publish(["--dry-run", "--skip-export", "--skip-web", "--bands", "b0"]);
    expect(existsSync(join(cwd, ".shipvo/dry-run/p/demo/1/b0"))).toBe(true);
    expect(existsSync(join(cwd, ".shipvo/dry-run/w"))).toBe(false);
  });

  it("the web export sets PN_SIM through env, not a shell prefix cmd.exe rejects", async () => {
    withBundle(96);
    let seen: { cmd: string; env?: NodeJS.ProcessEnv } | undefined;
    exec.fn = (c, o) => { if (c.includes("--platform web")) { seen = { cmd: c, env: o?.env }; mkdirSync(join(cwd, "dist-web"), { recursive: true }); writeFileSync(join(cwd, "dist-web/index.html"), "<p>hi</p>"); } };
    await publish(["--skip-export", "true", "--skip-web", "false", "--bands", "b0", "--dry-run"]);
    expect(seen?.cmd.startsWith("npx expo export")).toBe(true);
    expect(seen?.env?.PN_SIM).toBe("1");
  });

  it("--skip-web false still publishes the web copy", async () => {
    withBundle(96);
    exec.fn = (c) => { if (c.includes("--platform web")) { mkdirSync(join(cwd, "dist-web"), { recursive: true }); writeFileSync(join(cwd, "dist-web/index.html"), "<p>hi</p>"); } };
    await publish(["--skip-export", "true", "--skip-web", "false", "--bands", "b0", "--dry-run"]);
    expect(existsSync(join(cwd, ".shipvo/dry-run/w/demo/r1/index.html"))).toBe(true);
  });

  it("--dry-run false is a real publish; a bad value is an error", async () => {
    withBundle(96);
    await publish([...flags, "--dry-run", "false"]);
    expect(puts.length).toBeGreaterThan(0);
    await expect(publish([...flags, "--dry-run", "yes"])).rejects.toThrow(/on\/off flag/);
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

  it("iOS also patches from a shell's embedded bundle; Android ignores iOS bases", async () => {
    exec.fn = (c) => { const m = c.match(/'([^']*p\.bsdiff)'/); if (m) writeFileSync(m[1], new Uint8Array(10).fill(1)); };
    const make = (tag: number) => { const b = fakeHbc(96); b[20] = tag; return b; };
    const sha = (tag: number) => createHash("sha256").update(make(tag)).digest("hex");
    for (const pf of ["android", "ios"]) {
      mkdirSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}`), { recursive: true });
      writeFileSync(join(cwd, `dist-ota/${pf}/_expo/static/js/${pf}/index.hbc`), make(pf === "ios" ? 6 : 5));
    }
    // Shells registered their embedded bundles (build-shell does this): one per platform.
    blobs.set("b/demo/base-ios.hbc", make(8)); blobs.set("b/demo/base-and.hbc", make(9));
    values.set("base/demo/ios-1.0.0-a", JSON.stringify({ platform: "ios", sha256: sha(8), key: "b/demo/base-ios.hbc" }));
    values.set("base/demo/1.0.0-b", JSON.stringify({ sha256: sha(9), key: "b/demo/base-and.hbc" }));
    await publish(["--skip-export", "true", "--skip-web", "true", "--bands", "b0", "--platform", "all", "--release", "1"]);
    const core = (key: string) => JSON.parse(JSON.parse(values.get(key)!).body).core;
    expect(core("p/demo/1/ios/b0").patches.map((p: any) => p.from_sha256)).toEqual([sha(8)]);
    expect(core("p/demo/1/b0").patches.map((p: any) => p.from_sha256)).toEqual([sha(9)]);
  });
});

describe("isInside (dry-run writes stay under the output dir)", () => {
  it("accepts Windows paths under the root and refuses ones outside it", () => {
    const w = path.win32;
    expect(isInside("D:\\a\\app\\.shipvo\\dry-run", "D:\\a\\app\\.shipvo\\dry-run\\b\\myshop\\r1.hbc", w)).toBe(true);
    expect(isInside("D:\\a\\app\\.shipvo\\dry-run", "D:\\a\\app\\.shipvo\\other\\r1.hbc", w)).toBe(false);
    expect(isInside("D:\\a\\app\\.shipvo\\dry-run", "D:\\a\\app\\.shipvo\\dry-run", w)).toBe(false);
  });
  it("accepts POSIX paths under the root and refuses ones outside it", () => {
    const p = path.posix;
    expect(isInside("/a/.shipvo/dry-run", "/a/.shipvo/dry-run/b/myshop/r1.hbc", p)).toBe(true);
    expect(isInside("/a/.shipvo/dry-run", "/a/.shipvo/dry-run-x/r1.hbc", p)).toBe(false);
    expect(isInside("/a/.shipvo/dry-run", "/a/.shipvo/dry-run/../x", p)).toBe(false);
  });
});
