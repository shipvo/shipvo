import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../src/index";
import { init } from "../src/init";
import { login } from "../src/login";
import { audit } from "../src/audit";
import { keysJson } from "../src/keys-json";

const cwd = process.cwd();
const SEED = b64(randomBytes(32)), PUB = b64(keyFromSeed(SEED).publicKey);
const SECRET_KEY = "pn_live_SECRETKEYVALUE1234567890";
let out: string[], err: string[], home: string;

/** Run a command; return the one envelope it printed on stdout and the exit code. */
async function run(fn: () => Promise<unknown>) {
  out = []; err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.map(String).join(" ")); });
  process.exitCode = undefined;
  await fn();
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  expect(out).toHaveLength(1);
  const doc = JSON.parse(out[0]);
  expect(Object.keys(doc).sort()).toEqual(["code", "data", "next", "ok", "summary"]);
  expect(doc.next.length).toBeLessThanOrEqual(3);
  expect(doc.ok).toBe(code === 0);
  return { doc, code };
}
const noSecret = (...needles: string[]) => { const all = [...out, ...err].join("\n"); for (const n of needles) expect(all).not.toContain(n); };

function app(extra: Record<string, string> = {}) {
  const d = mkdtempSync(join(tmpdir(), "shipvo-js-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: PUB }));
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(d, k), v);
  process.chdir(d);
  return d;
}
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "shipvo-home-")); process.env.SHIPVO_HOME = home; });
afterEach(() => {
  process.chdir(cwd); vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = undefined;
  for (const k of ["SHIPVO_HOME", "SHIPVO_OWNER_TOKEN", "SHIPVO_SIGNING_SEED"]) delete process.env[k];
});

describe("init --json", () => {
  it("creates an app and reports the public key and the seed file path, not the seed", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "shipvo-init-")), "tide");
    const { doc, code } = await run(() => init([dir, "--json"]));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ ok: true, code: "created", data: { mode: "create", app_id: "tide", seed_file: join(dir, ".shipvo", "seed.txt") } });
    expect(doc.next.map((n: any) => n.command)).toEqual([expect.stringContaining("npm install"), expect.stringContaining("run android"), expect.stringContaining("publish")]);
    const seed = readFileSync(join(dir, ".shipvo", "seed.txt"), "utf8").trim();
    noSecret(seed);
    expect(doc.data.public_key).toBe(JSON.parse(readFileSync(join(dir, "shipvo.json"), "utf8")).publicKey);
  });
  it("fails with dir_exists when the folder is there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-init-"));
    const { doc, code } = await run(() => init([dir, "--json"]));
    expect(code).toBe(1);
    expect(doc).toMatchObject({ ok: false, code: "dir_exists", data: {} });
  });
  it("a bad template is a usage error, exit 2", async () => {
    const { doc, code } = await run(() => init([join(tmpdir(), "nope-x"), "--template", "zzz", "--json"]));
    expect(code).toBe(2);
    expect(doc.code).toBe("usage");
  });
});

describe("login --json", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  it("puts the device URL and code in data, saves the key, and never prints it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: any) => String(u).endsWith("/start")
      ? json({ verification_uri: "https://gh.test/device", user_code: "ABCD-1234", device_code: "dc", interval: 0, expires_in: 60 })
      : json({ key: SECRET_KEY, prefix: "pn_live_SECR", login: "ana", apps: ["shop"], quota_minutes: 30, expires_at: "2026-12-06T00:00:00Z", mcp: { url: "https://mcp.test" } })));
    const { doc, code } = await run(() => login(["--control-plane", "https://cp.test", "--json"]));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ code: "signed_in", data: { login: "ana", key_prefix: "pn_live_SECR", device: { verification_uri: "https://gh.test/device", user_code: "ABCD-1234" } } });
    expect(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8")).key).toBe(SECRET_KEY);
    noSecret(SECRET_KEY);
    expect(err.join("\n")).toContain("ABCD-1234");
  });
  it("fails with login_unavailable when the server refuses to start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "off" }, 503)));
    const { doc, code } = await run(() => login(["--json"]));
    expect(code).toBe(1);
    expect(doc).toMatchObject({ ok: false, code: "login_unavailable", data: {} });
    expect(doc.next.length).toBeGreaterThan(0);
  });
});

describe("audit --json", () => {
  const rows = [{ id: 2, action: "publish" }, { id: 1, action: "rollback" }];
  it("returns the rows in data", async () => {
    app(); process.env.SHIPVO_OWNER_TOKEN = "owner-secret-token";
    const f = vi.fn(async () => new Response(JSON.stringify({ rows })));
    const { doc, code } = await run(() => audit(["shop", "--json"], { fetchFn: f as any }));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ code: "ok", data: { app: "shop", count: 2, rows } });
    noSecret("owner-secret-token");
  });
  it("a rejected token is auth_failed", async () => {
    app(); process.env.SHIPVO_OWNER_TOKEN = "owner-secret-token";
    const { doc, code } = await run(() => audit(["shop", "--json"], { fetchFn: (async () => new Response("{}", { status: 401 })) as any }));
    expect(code).toBe(1);
    expect(doc).toMatchObject({ ok: false, code: "auth_failed" });
    noSecret("owner-secret-token");
  });
  it("a missing app is a usage error", async () => {
    app();
    const { doc, code } = await run(() => audit(["--json"]));
    expect(code).toBe(2);
    expect(doc.code).toBe("usage");
  });
});

describe("keys --json", () => {
  it("status: reports the key without the key", async () => {
    app();
    writeFileSync(join(home, "credentials.json"), JSON.stringify({ key: SECRET_KEY, control: "https://cp.test", mcp_url: "https://mcp.test" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ github_login: "ana", prefix: "pn_live_SECR", scope: "all", expires_at: "2026-12-06", used_minutes: 2, quota_minutes: 30 }))));
    const { doc, code } = await run(() => keysJson(["--json"]));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ code: "ok", data: { login: "ana", prefix: "pn_live_SECR", used_minutes: 2 } });
    noSecret(SECRET_KEY);
  });
  it("status: not signed in", async () => {
    app();
    const { doc, code } = await run(() => keysJson(["--json"]));
    expect(code).toBe(1);
    expect(doc).toMatchObject({ ok: false, code: "not_signed_in" });
    expect(doc.next[0].command).toBe("shipvo login");
  });
  it("export --out writes the file and keeps the seed out of the output", async () => {
    const d = app(); process.env.SHIPVO_SIGNING_SEED = SEED;
    const file = join(d, "backup.txt");
    const { doc, code } = await run(() => keysJson(["export", "--out", file, "--json"]));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ code: "exported", data: { app_id: "shop", public_key: PUB, out: file } });
    expect(readFileSync(file, "utf8").trim()).toBe(SEED);
    noSecret(SEED);
  });
  it("export without --out is a usage error and prints no seed", async () => {
    app(); process.env.SHIPVO_SIGNING_SEED = SEED;
    const { doc, code } = await run(() => keysJson(["export", "--json"]));
    expect(code).toBe(2);
    expect(doc.code).toBe("usage");
    noSecret(SEED);
  });
  it("import restores the seed; a seed for another key is seed_mismatch", async () => {
    const d = app();
    const { doc, code } = await run(() => keysJson(["import", SEED, "--json"]));
    expect(code).toBe(0);
    expect(doc).toMatchObject({ code: "imported", data: { seed_file: ".shipvo/seed.txt", public_key: PUB } });
    expect(existsSync(join(d, ".shipvo", "seed.txt"))).toBe(true);
    noSecret(SEED);
    const other = b64(randomBytes(32));
    const bad = await run(() => keysJson(["import", other, "--json"]));
    expect(bad.code).toBe(1);
    expect(bad.doc.code).toBe("seed_mismatch");
    noSecret(SEED, other);
  });
  it("import with no project is no_project", async () => {
    process.chdir(mkdtempSync(join(tmpdir(), "shipvo-empty-")));
    const { doc, code } = await run(() => keysJson(["import", SEED, "--json"]));
    expect(code).toBe(1);
    expect(doc.code).toBe("no_project");
  });
  it("rotate sign puts the signed statement in data; a bad root seed fails", async () => {
    const d = app();
    const rootSeed = b64(randomBytes(32)), newKey = b64(keyFromSeed(b64(randomBytes(32))).publicKey);
    writeFileSync(join(d, "root.txt"), rootSeed); writeFileSync(join(d, "bad.txt"), "nope");
    const args = (f: string) => ["rotate", "sign", "--root-seed-file", f, "--new-key", newKey, "--sequence", "1", "--json"];
    const { doc, code } = await run(() => keysJson(args(join(d, "root.txt"))));
    expect(code).toBe(0);
    expect(doc.code).toBe("rotation_signed");
    expect(typeof doc.data.envelope.body).toBe("string");
    expect(typeof doc.data.envelope.signature).toBe("string");
    noSecret(rootSeed);
    const bad = await run(() => keysJson(args(join(d, "bad.txt"))));
    expect(bad.code).toBe(1);
    expect(bad.doc.code).toBe("rotate_failed");
  });
});
