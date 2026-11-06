import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import app from "../src/index";
import { rotationsFor } from "../src/rotation";

const V = JSON.parse(readFileSync(new URL("../../../packages/runtime/test-vectors/rotation.json", import.meta.url), "utf8"));
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Statements from the shared vectors, by case id and step. */
const stmt = (id: number, step = 0, i = 0) => V.cases.find((c: any) => c.id === id).steps[step].deliver[i];
const seqOf = (e: any) => JSON.parse(e.body).sequence;

function mkEnv(opts: { root?: string | null; keys?: Record<string, { account_id: number }>; // keys: hash of the key (sha256 hex)
   owner?: Record<string, number>; failBatch?: boolean; raceSeq?: number; raceCount?: boolean } = {}) {
  const roots: Record<string, string> = opts.root === null ? {} : { tide: opts.root ?? V.root.publicKey };
  const rows: any[] = [];
  const audits: any[] = [];
  const DB: any = {
    prepare: (sql: string) => ({ bind: (...a: any[]) => ({
      _sql: sql, _args: a,
      first: async () => {
        if (sql.includes("FROM api_keys")) { const k = opts.keys?.[a[0]]; return k ? { account_id: k.account_id, expires_at: null, github_login: "ann" } : null; }
        if (sql.includes("FROM apps")) return opts.owner?.[a[0]] !== undefined ? { account_id: opts.owner[a[0]] } : null;
        if (sql.includes("FROM rotation_roots")) return roots[a[0]] ? { root_key: roots[a[0]] } : null;
        if (sql.includes("MAX(sequence)")) return { top: rows.filter((r) => r.app_id === a[0]).reduce((m, r) => Math.max(m, r.sequence), 0) || null };
        if (sql.includes("COUNT(*)")) return opts.raceCount ? { n: 0 } : { n: rows.filter((r) => r.app_id === a[0]).length };
        return null;
      },
      all: async () => ({ results: rows.filter((r) => r.app_id === a[0]).sort((x, y) => y.sequence - x.sequence).slice(0, a[1]) }),
      run: async () => ({}),
    }) }),
    batch: async (stmts: any[]) => {
      if (opts.failBatch) throw new Error("db down");
      if (opts.raceSeq !== undefined) { rows.push({ app_id: "tide", sequence: opts.raceSeq, body: "x", signature: "x" }); throw new Error("D1_ERROR: UNIQUE constraint failed: rotations.app_id, rotations.sequence"); }
      for (const s of stmts) {
        if (s._sql.includes("INSERT INTO rotations")) rows.push({ app_id: s._args[0], sequence: s._args[1], body: s._args[2], signature: s._args[3] });
        else if (s._sql.includes("INSERT INTO audit_log_v2")) { if (!(s._sql.includes("NOT EXISTS") && rows.some((r) => r.app_id === "tide"))) audits.push(s._args); }
        else if (s._sql.includes("INTO rotation_roots")) { if (!rows.some((r) => r.app_id === s._args[0])) roots[s._args[0]] = s._args[1]; }
      }
      return [];
    },
  };
  return { DB, rows, audits, roots };
}
async function cookie(secret: string, appId = "tide") {
  const k = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const exp = Date.now() + 3600_000;
  return `pn_admin=${appId}.${exp}.${hex(await crypto.subtle.sign("HMAC", k, enc(`${appId}.${exp}`)))}`;
}
const post = (env: any, headers: Record<string, string>, body: any, path = "/rotation/tide", method = "POST") =>
  app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }, env);

describe("POST /rotation/:app", () => {
  it("stores a root-signed statement from an admin session and writes a key-rotation audit row", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    const r = await post(env, { cookie: await cookie("pw") }, stmt(1));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sequence: 1 });
    expect(m.rows).toHaveLength(1);
    expect(m.audits).toHaveLength(1);
    expect(m.audits[0].slice(0, 3)).toEqual(["tide", expect.any(String), "owner (admin)"]);
    expect(JSON.parse(m.audits[0][3])).toEqual({ sequence: 1, validFrom: JSON.parse(stmt(1).body).validFrom });
  });
  it("refuses a login key even when its account owns the app (403), and stores nothing", async () => {
    const m = mkEnv({ keys: { [await sha("sv_test_abc")]: { account_id: 7 } }, owner: { tide: 7 } });
    expect((await post({ DB: m.DB }, { authorization: "Bearer sv_test_abc" }, stmt(1))).status).toBe(403);
    const put = await app.request("/rotation/tide/root", { method: "PUT", headers: { authorization: "Bearer sv_test_abc", "content-type": "application/json" }, body: JSON.stringify({ root_key: "A".repeat(43) }) }, { DB: m.DB });
    expect(put.status).toBe(403);
    expect(m.rows).toHaveLength(0); expect(m.audits).toHaveLength(0);
  });
  it("refuses a malformed Authorization header with 403", async () => {
    const m = mkEnv();
    for (const auth of ["Bearer", "Basic abc", "sv_test_"]) expect((await post({ DB: m.DB }, { authorization: auth }, stmt(1))).status).toBe(403);
  });
  it("refuses a publish token, the owner token and a login key of another account (403), and stores nothing", async () => {
    const m = mkEnv({ keys: { [await sha("sv_test_other")]: { account_id: 9 } }, owner: { tide: 7 } });
    const env = { DB: m.DB, ADMIN_PASSWORD: "pw", OWNER_TOKEN: "owner-secret" };
    for (const auth of ["Bearer sv_publish_abc", "Bearer owner-secret", "Bearer sv_test_other"]) {
      const r = await post(env, { authorization: auth }, stmt(1));
      expect(r.status).toBe(403);
    }
    expect(m.rows).toHaveLength(0); expect(m.audits).toHaveLength(0);
  });
  it("is 401 with no credentials and refuses a cookie for another app", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    expect((await post(env, {}, stmt(1))).status).toBe(401);
    expect((await post(env, { cookie: await cookie("pw", "other") }, stmt(1))).status).toBe(401);
  });
  it("rejects a statement signed by a forged root key (shared vector 3)", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    const r = await post(env, { cookie: await cookie("pw") }, stmt(3));
    expect(r.status).toBe(400);
    expect((await r.json() as any).error).toBe("bad_signature");
    expect(m.rows).toHaveLength(0);
  });
  it("rejects a statement signed by the old release key (shared vector 2)", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    expect((await post(env, { cookie: await cookie("pw") }, stmt(2))).status).toBe(400);
  });
  it("rejects another app, a bad key, and a body over 1 KB", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" }; const h = { cookie: await cookie("pw") };
    expect(await (await post(env, h, stmt(13))).json()).toMatchObject({ error: "wrong_app" });
    expect(await (await post(env, h, stmt(14))).json()).toMatchObject({ error: "bad_key" });
    expect(await (await post(env, h, { body: "x".repeat(1025), signature: "AAAA" })).json()).toMatchObject({ error: "bad_envelope" });
    expect(m.rows).toHaveLength(0);
  });
  it("rejects a repeat or lower sequence (409) and accepts a higher one that skips", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" }; const h = { cookie: await cookie("pw") };
    expect((await post(env, h, stmt(1))).status).toBe(200);
    const again = await post(env, h, stmt(1));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "replay" });
    const s10 = V.cases.find((c: any) => c.id === 9).steps[0].deliver.find((e: any) => seqOf(e) === 10);
    expect((await post(env, h, s10)).status).toBe(200);
    expect(m.rows.map((r) => r.sequence)).toEqual([1, 10]);
    expect((await post(env, h, V.cases.find((c: any) => c.id === 9).steps[0].deliver.find((e: any) => seqOf(e) === 5))).status).toBe(409);
  });
  it("answers 409 replay when a concurrent upload wins the primary key", async () => {
    const m = mkEnv({ raceSeq: 1 }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    const r = await post(env, { cookie: await cookie("pw") }, stmt(1));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "replay" });
  });
  it("needs a registered root key", async () => {
    const m = mkEnv({ root: null }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    expect((await post(env, { cookie: await cookie("pw") }, stmt(1))).status).toBe(409);
  });
  it("stores nothing when the audit row cannot be written (one batch)", async () => {
    const m = mkEnv({ failBatch: true }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    let status = 0; try { status = (await post(env, { cookie: await cookie("pw") }, stmt(1))).status; } catch { status = 500; }
    expect(status).toBe(500);
    expect(m.rows).toHaveLength(0);
  });
});

describe("PUT /rotation/:app/root", () => {
  it("registers the root public key for an admin session and audits it", async () => {
    const m = mkEnv({ root: null }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" };
    const r = await post(env, { cookie: await cookie("pw") }, { root_key: V.root.publicKey }, "/rotation/tide/root", "PUT");
    expect(r.status).toBe(200);
    expect(m.roots.tide).toBe(V.root.publicKey);
    expect(m.audits).toHaveLength(1);
  });
  it("refuses a token (403) and a key that is not 32 bytes (400)", async () => {
    const m = mkEnv({ root: null }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw", OWNER_TOKEN: "o" };
    expect((await post(env, { authorization: "Bearer sv_publish_x" }, { root_key: V.root.publicKey }, "/rotation/tide/root", "PUT")).status).toBe(403);
    expect((await post(env, { authorization: "Bearer o" }, { root_key: V.root.publicKey }, "/rotation/tide/root", "PUT")).status).toBe(403);
    expect((await post(env, { cookie: await cookie("pw") }, { root_key: "AAAA" }, "/rotation/tide/root", "PUT")).status).toBe(400);
    expect(m.roots.tide).toBeUndefined();
  });
  it("does not replace a root key once statements are stored", async () => {
    const m = mkEnv(); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" }; const h = { cookie: await cookie("pw") };
    await post(env, h, stmt(1));
    const r = await post(env, h, { root_key: V.forgedRoot.publicKey }, "/rotation/tide/root", "PUT");
    expect(r.status).toBe(409);
    expect(m.roots.tide).toBe(V.root.publicKey);
  });
});

describe("PUT /rotation/:app/root race", () => {
  it("does not replace the root key when a statement lands after the lock check", async () => {
    const m = mkEnv({ raceCount: true }); const env = { DB: m.DB, ADMIN_PASSWORD: "pw" }; const h = { cookie: await cookie("pw") };
    m.rows.push({ app_id: "tide", sequence: 1, body: "x", signature: "x" });
    const r = await post(env, h, { root_key: V.forgedRoot.publicKey }, "/rotation/tide/root", "PUT");
    expect(r.status).toBe(409);
    expect(m.roots.tide).toBe(V.root.publicKey);
    expect(m.audits).toHaveLength(0);
  });
  it("writes the root with a statement-free guard in the SQL", async () => {
    const sqls: string[] = [];
    const m = mkEnv({ root: null }); const orig = m.DB.prepare;
    m.DB.prepare = (q: string) => { sqls.push(q); return orig(q); };
    await post({ DB: m.DB, ADMIN_PASSWORD: "pw" }, { cookie: await cookie("pw") }, { root_key: V.root.publicKey }, "/rotation/tide/root", "PUT");
    expect(sqls.filter((q) => q.includes("INTO rotation_roots") || q.includes("INTO audit_log_v2")).every((q) => q.includes("WHERE NOT EXISTS (SELECT 1 FROM rotations"))).toBe(true);
  });
});

describe("rotations in the pointer response (shared vector 9)", () => {
  const ten = V.cases.find((c: any) => c.id === 9).steps[0].deliver;
  it("sends the 8 highest sequences, ascending", async () => {
    const m = mkEnv();
    for (const e of ten) m.rows.push({ app_id: "tide", sequence: seqOf(e), body: e.body, signature: e.signature });
    const { rotations, top } = await rotationsFor(m.DB, "tide");
    expect(rotations.map(seqOf)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(top).toBe(10);
  });
  it("is empty, not an error, when the table cannot be read", async () => {
    expect(await rotationsFor({ prepare: () => { throw new Error("no table"); } }, "tide")).toEqual({ rotations: [], top: 0 });
  });
  const ptr = (body: string, signature = "sig") => {
    const raw = JSON.stringify({ body, signature });
    return { raw, POINTERS: { get: async (k: string) => (k === "p/tide/1/b0" ? raw : null) } };
  };
  const h64 = "a".repeat(64);
  const base = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 4, issued_at: "2026-10-30T00:00:00Z", core: { version: "1.0.0", sha256: h64, size: 10, url: "c" }, min_shell_version: "1.0.0" };
  const plain = JSON.stringify(base);
  it("adds rotations to GET /p/... and changes the ETag", async () => {
    const m = mkEnv();
    const { raw, POINTERS } = ptr(plain);
    const env = { DB: m.DB, POINTERS };
    const before = await app.request("/p/tide/1/b0", {}, env);
    expect(before.status).toBe(200);
    expect(await before.text()).toBe(raw);
    expect(before.headers.get("etag")).toBe('"4"');
    for (const e of ten) m.rows.push({ app_id: "tide", sequence: seqOf(e), body: e.body, signature: e.signature });
    const r = await app.request("/p/tide/1/b0", {}, env);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.body).toBe(plain); expect(j.signature).toBe("sig");
    expect(j.rotations.map(seqOf)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.headers.get("etag")).toBe('"4-r10"');
    expect((await app.request("/p/tide/1/b0", { headers: { "if-none-match": '"4-r10"' } }, env)).status).toBe(304);
  });
  it("keeps body and signature byte for byte with unicode and escaped characters", async () => {
    const m = mkEnv();
    const body = JSON.stringify({ ...base, core: { ...base.core, url: "c \u00e9 \" \\ \n \u2028 \ud83d\ude80 é 🚀" } });
    const signature = "AAAA";
    const { POINTERS } = ptr(body, signature);
    m.rows.push({ app_id: "tide", sequence: 1, body: ten[0].body, signature: ten[0].signature });
    const j: any = await (await app.request("/p/tide/1/b0", {}, { DB: m.DB, POINTERS })).json();
    expect(j.body).toBe(body); expect(j.signature).toBe(signature);
    expect(Object.keys(j)).toEqual(["body", "signature", "rotations"]);
  });
  it("carries rotations on a halted answer", async () => {
    const m = mkEnv(); m.rows.push({ app_id: "tide", sequence: 1, body: ten[0].body, signature: ten[0].signature });
    const { POINTERS } = ptr(plain);
    const P = { get: async (k: string) => (k === "halt/tide" ? JSON.stringify({ release: 4, halted_at: "2026-11-05T00:00:00Z" }) : POINTERS.get(k)) };
    const r = await app.request("/p/tide/1/b0", {}, { DB: m.DB, POINTERS: P });
    expect(r.status).toBe(404);
    const j: any = await r.json();
    expect(j.error).toBe("release_halted");
    expect(j.rotations).toHaveLength(1);
  });
  it("carries rotations on an out-of-band answer and leaves one without rotations unchanged", async () => {
    const m = mkEnv();
    const { POINTERS } = ptr(JSON.stringify({ ...base, hermes_bytecode_version: 96 }));
    const plainRes = await app.request("/p/tide/1/b0?hbc=98", {}, { DB: m.DB, POINTERS });
    const baseText = await plainRes.text();
    expect(plainRes.status).toBe(404);
    expect(baseText).not.toContain("rotations");
    m.rows.push({ app_id: "tide", sequence: 1, body: ten[0].body, signature: ten[0].signature });
    const withRot: any = await (await app.request("/p/tide/1/b0?hbc=98", {}, { DB: m.DB, POINTERS })).json();
    expect(withRot.error).toBe("hermes_bytecode_mismatch");
    expect(withRot.rotations).toHaveLength(1);
  });
});

describe("migration 0022", () => {
  const sql = readFileSync(new URL("../migrations/0022_key_rotation.sql", import.meta.url), "utf8");
  it("is additive and safe to run twice", () => {
    expect(sql).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE|ALTER)\b/i);
    for (const t of sql.match(/CREATE (TABLE|INDEX)[^\n]*/g) ?? []) expect(t).toContain("IF NOT EXISTS");
    expect(sql).toContain("INSERT OR IGNORE INTO audit_log_v2");
  });
  it("widens the audit action check to add key-rotation and keeps the old actions", () => {
    expect(sql).toContain("CHECK (action IN ('publish','rollback','halt','key-rotation'))");
  });
});
