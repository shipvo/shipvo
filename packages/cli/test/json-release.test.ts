import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signBytes } from "../src/index";

const exec = vi.hoisted(() => ({ calls: [] as { cmd: string; stdio: unknown }[] }));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execSync: (cmd: string, o?: { stdio?: unknown }) => { exec.calls.push({ cmd, stdio: o?.stdio }); } }));

const values = new Map<string, string>();
const blobs = new Map<string, Uint8Array>();
const stub = {
  get: async (k: string) => values.get(k) ?? null,
  getBytes: async (k: string) => blobs.get(k) ?? null,
  keys: async (prefix: string) => [...values.keys(), ...blobs.keys()].filter((k) => k.startsWith(prefix)),
  put: async (k: string, body: unknown) => { values.set(k, typeof body === "string" ? body : ""); if (typeof body !== "string") blobs.set(k, body as Uint8Array); },
};
vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
  seed: () => Buffer.alloc(32, 7).toString("base64"),
  kv: () => stub,
}));
import { publish, rollback } from "../src/publish";
import { promote } from "../src/promote";
import { autoHalt } from "../src/autohalt";

const SEED = Buffer.alloc(32, 7).toString("base64");
const hbc = () => { const b = new Uint8Array(64); b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0); new DataView(b.buffer).setUint32(8, 96, true); return b; };
const putPointer = (key: string, release: number) => {
  const body = JSON.stringify({ app_id: "demo", band: "b0", release, issued_at: "2020-01-01T00:00:00.000Z", core: { sha256: "abc" } });
  values.set(key, JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }));
};

let out: string[], err: string[], prev: string;
beforeEach(() => {
  values.clear(); blobs.clear(); exec.calls.length = 0; out = []; err = []; process.exitCode = undefined;
  prev = process.cwd(); const d = mkdtempSync(join(tmpdir(), "shipvo-json-release-")); process.chdir(d);
  writeFileSync(join(d, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  mkdirSync(join(d, "dist-ota/_expo/static/js/android"), { recursive: true });
  writeFileSync(join(d, "dist-ota/_expo/static/js/android/index.hbc"), hbc());
  vi.spyOn(console, "log").mockImplementation((m: string) => { out.push(m); });
  vi.spyOn(console, "error").mockImplementation((m: string) => { err.push(String(m)); });
});
afterEach(() => { process.chdir(prev); process.exitCode = undefined; vi.restoreAllMocks(); });

/** Stdout must be exactly one line that parses as an envelope. */
const env = () => {
  expect(out).toHaveLength(1);
  const d = JSON.parse(out[0]);
  expect(Object.keys(d).sort()).toEqual(["code", "data", "next", "ok", "summary"]);
  expect(d.ok).toBe(process.exitCode === 0);
  return d;
};
const pub = ["--skip-export", "--skip-web", "--bands", "b0", "--json"];

describe("publish --json", () => {
  it("prints one envelope, exit 0, next is status and promote", async () => {
    await publish(pub);
    const d = env();
    expect(process.exitCode).toBe(0);
    expect(d).toMatchObject({ ok: true, code: "published", data: { app: "demo", release: 1, bands: ["b0"] } });
    expect(d.next.map((n: { command: string }) => n.command)).toEqual(["shipvo status --json", "shipvo promote --to b1,b2 --json"]);
    expect(err.join("\n")).toContain("patches:");
  });
  it("dry run suggests the real publish and sends nothing", async () => {
    await publish([...pub, "--dry-run"]);
    const d = env();
    expect(d).toMatchObject({ ok: true, code: "dry_run", data: { dry_run: true } });
    expect(d.next[0].command).toBe("shipvo publish --bands b0 --json");
    expect(values.size).toBe(0);
  });
  it("routes build tool output to stderr", async () => {
    await publish(["--skip-web", "--bands", "b0", "--json"]);
    expect(exec.calls[0].stdio).toEqual(["inherit", 2, 2]);
    env();
  });
  it("a bad flag is a usage error with exit 2", async () => {
    await publish(["--bogus", "--json"]);
    expect(process.exitCode).toBe(2);
    expect(env()).toMatchObject({ ok: false, code: "usage" });
  });
  it("a missing bundle is a failure with exit 1", async () => {
    await publish(["--skip-export", "--skip-web", "--platform", "ios", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(env()).toMatchObject({ ok: false, code: "failed" });
  });
  it("without --json the result is plain English, no exit code", async () => {
    await publish(["--skip-export", "--skip-web", "--bands", "b0"]);
    expect(out[0]).toMatch(/^Published release 1 to b0\./);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("rollback --json", () => {
  const seed = () => { blobs.set("b/demo/r1.hbc", hbc()); values.set("h/demo/r1", JSON.stringify({ min_shell_version: "1.2.0" })); };
  it("dry run previews and suggests the real rollback", async () => {
    seed();
    await rollback(["--to", "1", "--dry-run", "--json"]);
    const d = env();
    expect(process.exitCode).toBe(0);
    expect(d).toMatchObject({ code: "dry_run", data: { rolled_back_to_code_of: 1, new_release: 1, dry_run: true } });
    expect(d.next[0].command).toBe("shipvo rollback --to 1 --json");
    expect(err.join("\n")).toContain("Rollback preview");
  });
  it("real rollback writes pointers and suggests status", async () => {
    seed();
    await rollback(["--to", "1", "--bands", "b0", "--json"]);
    expect(env()).toMatchObject({ ok: true, code: "rolled_back", next: [{ command: "shipvo status --json" }] });
    expect(values.has("p/demo/1/b0")).toBe(true);
  });
  it("missing --to is a usage error (2)", async () => {
    await rollback(["--json"]);
    expect(process.exitCode).toBe(2);
    expect(env().code).toBe("usage");
  });
  it("missing bundle is exit 1 with a status hint", async () => {
    await rollback(["--to", "9", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(env()).toMatchObject({ ok: false, code: "not_found", next: [{ command: "shipvo status --json" }] });
  });
});

describe("promote --json", () => {
  const ok = (async () => ({ ok: true, json: async () => ({ releases: [{ release: 3, events: {} }], halted: null }) })) as unknown as typeof fetch;
  it("promotes and reports the bands", async () => {
    putPointer("p/demo/1/b0", 3);
    await promote(["--json"], { kv: stub, fetchFn: ok });
    expect(env()).toMatchObject({ ok: true, code: "promoted", data: { dry_run: false, promoted: [{ platform: "android", release: 3, from: "b0", bands: ["b1", "b2"] }] } });
    expect(process.exitCode).toBe(0);
    expect(err.join("\n")).toContain("Wrote b1");
  });
  it("dry run writes nothing and suggests the real promote", async () => {
    putPointer("p/demo/1/b0", 3);
    await promote(["--dry-run", "--json"], { kv: stub, fetchFn: ok });
    expect(env()).toMatchObject({ code: "dry_run", next: [{ command: "shipvo promote --json" }] });
    expect(values.has("p/demo/1/b1")).toBe(false);
  });
  it("a halted release is a failure with exit 1", async () => {
    putPointer("p/demo/1/b0", 3);
    const halted = (async () => ({ ok: true, json: async () => ({ releases: [], halted: { release: 3 } }) })) as unknown as typeof fetch;
    await promote(["--json"], { kv: stub, fetchFn: halted });
    expect(process.exitCode).toBe(1);
    expect(env()).toMatchObject({ ok: false, code: "blocked" });
  });
  it("an unreachable control plane is exit 1", async () => {
    putPointer("p/demo/1/b0", 3);
    await promote(["--json"], { kv: stub, fetchFn: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(process.exitCode).toBe(1);
    expect(env().code).toBe("remote_failed");
  });
  it("a bad band is a usage error (2)", async () => {
    await promote(["--to", "b9", "--json"], { kv: stub, fetchFn: ok });
    expect(process.exitCode).toBe(2);
    expect(env().code).toBe("usage");
  });
});

describe("auto-halt --json", () => {
  beforeEach(() => { process.env.SHIPVO_OWNER_TOKEN = "tok"; });
  afterEach(() => { delete process.env.SHIPVO_OWNER_TOKEN; });
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("shows the setting", async () => {
    await autoHalt(["--json"], { fetchFn: reply(200, { enabled: true, threshold: 0.2, min_reports: 20 }) });
    expect(env()).toMatchObject({ ok: true, code: "auto_halt_show", data: { enabled: true, threshold: 0.2, min_reports: 20, changed: false } });
  });
  it("turns on", async () => {
    await autoHalt(["--threshold", "0.2", "--json"], { fetchFn: reply(200, { enabled: true, threshold: 0.2, min_reports: 20 }) });
    expect(env()).toMatchObject({ code: "auto_halt_on", data: { changed: true } });
  });
  it("dry run changes nothing", async () => {
    const f = vi.fn(reply(200, {}));
    await autoHalt(["--off", "--dry-run", "--json"], { fetchFn: f });
    expect(f).not.toHaveBeenCalled();
    expect(env()).toMatchObject({ code: "dry_run", data: { dry_run: true, enabled: false }, next: [{ command: "shipvo auto-halt --off --json" }] });
  });
  it("a rejected token is exit 1, a bad value is exit 2", async () => {
    await autoHalt(["--json"], { fetchFn: reply(401, {}) });
    expect(process.exitCode).toBe(1);
    expect(env().code).toBe("auth_failed");
    out.length = 0;
    await autoHalt(["--threshold", "7", "--json"], { fetchFn: reply(200, {}) });
    expect(process.exitCode).toBe(2);
    expect(env().code).toBe("usage");
  });
});
