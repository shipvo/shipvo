import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../src/index";
import { signStatement, verifyStatement, rotate, RotateError, type RotationStatement } from "../src/rotation";

const V = JSON.parse(readFileSync(new URL("../../runtime/test-vectors/rotation.json", import.meta.url), "utf8"));
const names: Record<string, string> = Object.fromEntries(Object.entries(V.keys).map(([n, k]: any) => [k.publicKey, n]));

/** A small reference runtime for design sections 7 and 8, to check the vector file's expected state. */
function run(steps: any[]) {
  let key = V.keys.K1.publicKey, seq = 0, pending: RotationStatement[] = [];
  return steps.map((step) => {
    const now = new Date(step.now);
    const results: any[] = [];
    if (step.deliver.length > 8) {
      expect(step.signatureChecks).toBe(0);
      return { results, state: { currentKey: names[key], sequence: seq, pending: pending.map((p) => p.sequence) }, rejectedWhole: true };
    }
    const effective = Math.max(seq, V.minSequence), incoming: RotationStatement[] = [];
    for (const env of step.deliver) {
      const r = verifyStatement(env, V.root.publicKey, { appId: V.appId, effectiveSequence: effective, now });
      if (r.ok && pending.some((p) => p.sequence === r.statement.sequence)) { results.push({ ok: false, reason: "replay" }); continue; }
      results.push(r.ok ? { ok: true } : r);
      if (r.ok) incoming.push(r.statement);
    }
    const known = [...pending, ...incoming].sort((a, b) => a.sequence - b.sequence);
    const due = known.filter((s) => Date.parse(s.validFrom) <= now.getTime());
    const top = due[due.length - 1];
    if (top) { key = top.newKey; seq = top.sequence; }
    pending = known.filter((s) => s.sequence > seq).slice(0, 8);
    return { results, state: { currentKey: names[key], sequence: seq, pending: pending.map((p) => p.sequence) } };
  });
}

describe("rotation vectors", () => {
  it("has a case for every row of the section 11 table", () => {
    expect(V.cases.map((c: any) => c.id).slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("the vector keys are consistent", () => {
    for (const k of [V.root, V.forgedRoot, ...Object.values<any>(V.keys)]) expect(b64(keyFromSeed(k.seed).publicKey)).toBe(k.publicKey);
  });
  for (const c of V.cases) {
    it(`case ${c.id}: ${c.name}`, () => {
      const out = run(c.steps);
      c.steps.forEach((step: any, i: number) => {
        if (step.rejectedWhole) expect(out[i].rejectedWhole).toBe(true);
        else expect(out[i].results).toEqual(step.verify);
        expect(out[i].state).toEqual(step.expect);
      });
    });
  }
});

describe("rotation statements", () => {
  const root = b64(randomBytes(32)), rootPub = b64(keyFromSeed(root).publicKey), newKey = V.keys.K2.publicKey;
  const now = new Date("2026-11-06T00:00:00Z");
  const ctx = { appId: "tide", effectiveSequence: 0, now };
  it("sign then verify round-trips, with the body string kept exactly", () => {
    const env = signStatement({ appId: "tide", sequence: 3, newKey, validFrom: "2026-11-06T00:00:00Z" }, root);
    expect(env.body).toBe(`{"type":"key-rotation","appId":"tide","sequence":3,"newKey":"${newKey}","validFrom":"2026-11-06T00:00:00.000Z"}`);
    const r = verifyStatement(env, rootPub, ctx);
    expect(r).toEqual({ ok: true, statement: JSON.parse(env.body) });
  });
  it("rejects a changed body, another key, long bodies and non-strings", () => {
    const env = signStatement({ appId: "tide", sequence: 1, newKey, validFrom: now.toISOString() }, root);
    expect(verifyStatement({ ...env, body: env.body.replace('"sequence":1', '"sequence":2') }, rootPub, ctx)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyStatement(env, V.forgedRoot.publicKey, ctx)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyStatement({ body: "x".repeat(1025), signature: env.signature }, rootPub, ctx)).toEqual({ ok: false, reason: "bad_envelope" });
    expect(verifyStatement({ body: 1, signature: 2 }, rootPub, ctx)).toEqual({ ok: false, reason: "bad_envelope" });
  });
  it("refuses to build a bad statement", () => {
    expect(() => signStatement({ appId: "tide", sequence: 0, newKey, validFrom: now.toISOString() }, root)).toThrow(/sequence/);
    expect(() => signStatement({ appId: "tide", sequence: 1, newKey: "AAAA", validFrom: now.toISOString() }, root)).toThrow(/32-byte/);
    expect(() => signStatement({ appId: "tide", sequence: 1, newKey, validFrom: "soon" }, root)).toThrow(/ISO/);
  });
});

describe("shipvo keys rotate", () => {
  const cwd = process.cwd(), home = process.env.HOME;
  afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); process.env.HOME = home; });
  const cfg = { appId: "tide", controlPlane: "https://cp.test/" };
  const seedFile = (s: string) => { const f = join(mkdtempSync(join(tmpdir(), "rot-")), "root.txt"); writeFileSync(f, s + "\n"); return f; };
  const now = () => new Date("2026-11-06T00:00:00Z");

  it("sign --json prints one envelope that verifies", async () => {
    const root = b64(randomBytes(32));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await rotate(["sign", "--root-seed-file", seedFile(root), "--new-key", V.keys.K2.publicKey, "--sequence", "1", "--json"], cfg, { now });
    expect(log).toHaveBeenCalledTimes(1);
    const env = JSON.parse(String(log.mock.calls[0][0]));
    expect(String(log.mock.calls[0][0])).not.toContain("\n");
    expect(verifyStatement(env, b64(keyFromSeed(root).publicKey), { appId: "tide", effectiveSequence: 0, now: now() }).ok).toBe(true);
    expect(JSON.parse(env.body).validFrom).toBe("2026-11-06T00:00:00.000Z");
  });
  it("sign refuses a bad seed, a missing file, a far validFrom and a bad key", async () => {
    const base = ["--new-key", V.keys.K2.publicKey, "--sequence", "1"];
    await expect(rotate(["sign", "--root-seed-file", seedFile("not-a-seed"), ...base], cfg, { now })).rejects.toThrow(/root seed is not valid/);
    await expect(rotate(["sign", "--root-seed-file", "/nonexistent/x", ...base], cfg, { now })).rejects.toThrow(/Cannot read/);
    const f = seedFile(b64(randomBytes(32)));
    await expect(rotate(["sign", "--root-seed-file", f, ...base, "--valid-from", "2027-03-01T00:00:00Z"], cfg, { now })).rejects.toThrow(/90 days/);
    await expect(rotate(["sign", "--root-seed-file", f, "--new-key", "AAAA", "--sequence", "1"], cfg, { now })).rejects.toBeInstanceOf(RotateError);
  });
  it("refuses a sequence above the safe integer range", async () => {
    const root = b64(randomBytes(32)), f = seedFile(root);
    const mk = (sequence: number) => () => signStatement({ appId: "tide", sequence, newKey: V.keys.K2.publicKey, validFrom: now().toISOString() }, root);
    expect(mk(Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(mk(Number.MAX_SAFE_INTEGER + 1)).toThrow(/sequence/);
    expect(mk(1e21)).toThrow(/sequence/);
    await expect(rotate(["sign", "--root-seed-file", f, "--new-key", V.keys.K2.publicKey, "--sequence", "100000000000000000000"], cfg, { now })).rejects.toThrow(/--sequence/);
  });

  function signedIn() {
    const h = mkdtempSync(join(tmpdir(), "rot-home-")); process.env.HOME = h;
    return h;
  }
  it("upload posts the envelope with the signed-in session and prints the result", async () => {
    signedIn();
    const env = signStatement({ appId: "tide", sequence: 1, newKey: V.keys.K2.publicKey, validFrom: now().toISOString() }, b64(randomBytes(32)));
    const file = seedFile(JSON.stringify(env));
    const login = await import("../src/login");
    vi.spyOn(login, "savedCreds").mockReturnValue({ key: "session-key", control: "https://cp.test/", mcp_url: "" });
    const f = vi.fn(async () => new Response(JSON.stringify({ sequence: 1 }), { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await rotate(["upload", file, "--json"], cfg, { fetchFn: f as any });
    expect(String(f.mock.calls[0][0])).toBe("https://cp.test/rotation/tide");
    const init = f.mock.calls[0][1] as any;
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer session-key");
    expect(JSON.parse(init.body)).toEqual(env);
  });
  it("upload refuses to send the session key to a different host", async () => {
    const file = seedFile(JSON.stringify({ body: "{}", signature: "x" }));
    const login = await import("../src/login");
    vi.spyOn(login, "savedCreds").mockReturnValue({ key: "k", control: "https://other.test", mcp_url: "" });
    const f = vi.fn();
    await expect(rotate(["upload", file], cfg, { fetchFn: f as any })).rejects.toThrow(/Not sending your session key/);
    expect(f).not.toHaveBeenCalled();
  });
  it("upload reports a refusal and needs a sign-in", async () => {
    const env = { body: "{}", signature: "x" };
    const file = seedFile(JSON.stringify(env));
    const login = await import("../src/login");
    const spy = vi.spyOn(login, "savedCreds").mockReturnValue(null);
    process.env.SHIPVO_OWNER_TOKEN = "tok"; process.env.SHIPVO_PUBLISH_TOKEN = "tok";
    const f = vi.fn();
    await expect(rotate(["upload", file], cfg, { fetchFn: f as any })).rejects.toThrow(/Not signed in/);
    expect(f).not.toHaveBeenCalled();
    delete process.env.SHIPVO_OWNER_TOKEN; delete process.env.SHIPVO_PUBLISH_TOKEN;
    spy.mockReturnValue({ key: "k", control: "https://cp.test/", mcp_url: "" });
    const g = vi.fn(async () => new Response(JSON.stringify({ message: "not an owner session" }), { status: 403 }));
    await expect(rotate(["upload", file], cfg, { fetchFn: g as any })).rejects.toThrow(/HTTP 403\): not an owner session/);
  });
});

describe("shipvo keys rotate sign (process)", () => {
  const pkg = resolve(__dirname, "..");
  let out = "";
  beforeAll(() => {
    out = mkdtempSync(join(pkg, "dist-test-"));
    const tsc = createRequire(join(pkg, "package.json")).resolve("typescript/bin/tsc");
    const r = spawnSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.json"), "--outDir", out], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 60_000);
  afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

  it("exits 0 with --json and exits non-zero with a clear message on a bad seed", () => {
    const d = mkdtempSync(join(tmpdir(), "rot-cli-"));
    writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "tide", controlPlane: "https://cp.test", publicKey: V.keys.K1.publicKey }));
    writeFileSync(join(d, "good.txt"), V.root.seed + "\n"); writeFileSync(join(d, "bad.txt"), "nope\n");
    const go = (f: string) => spawnSync(process.execPath, [join(out, "cli.js"), "keys", "rotate", "sign", "--root-seed-file", f, "--new-key", V.keys.K2.publicKey, "--sequence", "1", "--json"], { cwd: d, encoding: "utf8" });
    const ok = go(join(d, "good.txt")), bad = go(join(d, "bad.txt"));
    expect(ok.status).toBe(0);
    expect(verifyStatement(JSON.parse(ok.stdout).data.envelope, V.root.publicKey, { appId: "tide", effectiveSequence: 0, now: new Date() }).ok).toBe(true);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/root seed is not valid/);
    const big = spawnSync(process.execPath, [join(out, "cli.js"), "keys", "rotate", "sign", "--root-seed-file", join(d, "good.txt"), "--new-key", V.keys.K2.publicKey, "--sequence", "100000000000000000000", "--json"], { cwd: d, encoding: "utf8" });
    expect(big.status).toBe(1);
    expect(big.stderr).toMatch(/--sequence/);
  });

  it("upload reads the envelope from stdin when the file is -", () => {
    const d = mkdtempSync(join(tmpdir(), "rot-stdin-"));
    writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "tide", controlPlane: "https://cp.test", publicKey: V.keys.K1.publicKey }));
    const go = (input: string) => spawnSync(process.execPath, [join(out, "cli.js"), "keys", "rotate", "upload", "-"], { cwd: d, input, encoding: "utf8", env: { ...process.env, HOME: d, USERPROFILE: d } });
    expect(go("not json").stderr).toMatch(/not a readable JSON envelope/);
    const ok = go(JSON.stringify({ body: "{}", signature: "x" }));
    expect(ok.status).toBe(1);
    expect(ok.stderr).toMatch(/Not signed in/);
  });
});
