import { describe, it, expect, vi } from "vitest";
import app from "../src/index";
import { runOwnerCommand } from "../src/owner";
import { recordAudit } from "../src/audit";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const GOOD = await sha("sv_publish_secret123");
// A small D1 stand-in: an in-memory audit_log plus the publish-token lookups.
function fakeDb(opts: { failAudit?: boolean } = {}) {
  const rows: any[] = []; let id = 0;
  const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    run: async () => {
      if (sql.startsWith("INSERT INTO audit_log")) {
        if (opts.failAudit) throw new Error("db down");
        rows.push({ id: ++id, app_id: a[0], at: a[1], actor: a[2], actor_kind: a[3], action: a[4], release: a[5], before: a[6], after: a[7], release_id: a[8] }); return {};
      }
      return { meta: { changes: 1 } };
    },
    first: async () => {
      if (sql.includes("FROM publish_tokens WHERE key_hash")) return a[0] === GOOD && a[1] === "tide" ? { id: 1, expires_at: null } : null;
      if (sql.includes("FROM publish_tokens t JOIN accounts")) return { github_login: "ada" };
      if (sql.includes("FROM apps WHERE app_id")) return { public_key: "A".repeat(43), bytes_used: 0 };
      if (sql.includes("FROM audit_log WHERE app_id = ? ORDER BY id DESC LIMIT 1")) { const m = rows.filter((r) => r.app_id === a[0]); return m[m.length - 1] ?? null; }
      if (sql.includes("MAX(version)")) return { v: 1 };
      return null;
    },
    all: async () => {
      if (!sql.includes("FROM audit_log")) return { results: [] };
      const [appId, ...rest] = a; const lim = rest[rest.length - 1]; const before = rest.length === 2 ? rest[0] : Infinity;
      return { results: rows.filter((r) => r.app_id === appId && r.id < before).sort((x, y) => y.id - x.id).slice(0, lim) };
    },
  }) }) } as any;
  return { db, rows };
}
const kv = (m: Record<string, string> = {}) => ({ get: async (k: string) => m[k] ?? null, put: async (k: string, v: any) => { m[k] = typeof v === "string" ? v : new TextDecoder().decode(v); }, list: async () => ({ keys: [] }) }) as any;
const get = (db: any, path: string, token?: string, extra: any = {}) => app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} }, { DB: db, POINTERS: kv(), ...extra } as any);

describe("audit log", () => {
  it("migration is additive and safe to run twice", () => {
    const sql = readFileSync(new URL("../migrations/0015_audit_log.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE|ALTER)\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS audit_log/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  it("no source file updates or deletes audit rows", () => {
    for (const f of ["index", "apps", "owner", "audit", "alerts", "admin", "halt"]) {
      expect(readFileSync(new URL(`../src/${f}.ts`, import.meta.url), "utf8")).not.toMatch(/(UPDATE|DELETE FROM)\s+audit_log/i);
    }
  });

  it("GET /audit/:app is 401 without a token and with a wrong one", async () => {
    const { db } = fakeDb();
    expect((await get(db, "/audit/tide")).status).toBe(401);
    expect((await get(db, "/audit/tide", "sv_publish_nope")).status).toBe(401);
    expect((await get(db, "/audit/other", "sv_publish_secret123")).status).toBe(401);
  });

  it("owner publish writes one row with actor, kind, before and after", async () => {
    const sql = new DatabaseSync(":memory:");
    sql.exec(readFileSync(new URL("../migrations/0015_audit_log.sql", import.meta.url), "utf8"));
    sql.exec(`CREATE TABLE content_versions (app_id, version INTEGER, json, published_at, published_by, note);
      CREATE TABLE content_draft (app_id PRIMARY KEY, json, updated_at);
      CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, at, actor, command, args_json, ok);
      CREATE TABLE telemetry (app_id, event);
      CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, key_hash, prefix, scope, label, expires_at, revoked_at);`);
    const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
      bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
    const content = { schema_version: "1.0", app_id: "tide", version: 1, published_at: "2026-11-01T00:00:00Z", brand: { name: "Tide", tagline: "" }, theme: { accent: "#112233" },
      departments: [{ id: "d", name: "D" }], products: [{ id: "rod", name: "Rod", department: "d", price: 1000, stock: 5, water: "both", tags: [], description: "" }], promos: [], slots: [], screens: { home: [] } };
    const m: Record<string, string> = { "c/tide/content.json": JSON.stringify(content) };
    const k = { get: async (key: string) => m[key] ?? null, put: async (key: string, v: string) => { m[key] = v; } } as any;
    const r = await runOwnerCommand({ db, kv: k, appId: "tide", actor: "agent (owner token)", agent: true }, "publish", { confirm: true });
    expect(r.ok).toBe(true);
    const rows = sql.prepare("SELECT * FROM audit_log").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app_id: "tide", actor: "agent (owner token)", actor_kind: "agent", action: "publish", release: null });
    expect(JSON.parse(rows[0].before)).toEqual({ content_version: 1 }); expect(JSON.parse(rows[0].after)).toEqual({ content_version: 2 });
    sql.exec(readFileSync(new URL("../migrations/0015_audit_log.sql", import.meta.url), "utf8")); // safe to run twice
  });

  it("pointer PUT writes publish, then rollback for a lower release", async () => {
    const { db, rows } = fakeDb(); const store: Record<string, string> = {};
    const h = "a".repeat(64);
    const mk = (release: number) => JSON.stringify({ body: JSON.stringify({ schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release, issued_at: "2026-10-30T00:00:00Z",
      core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0" }), signature: "AAAA" });
    const real = crypto.subtle.verify; vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true); vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as any);
    const env = { DB: db, POINTERS: kv(store) } as any;
    const put = (r: number) => app.request("/apps/tide/kv/p/tide/1/b0", { method: "PUT", body: mk(r), headers: { authorization: "Bearer sv_publish_secret123" } }, env);
    expect((await put(5)).status).toBe(200); expect((await put(7)).status).toBe(200); expect((await put(6)).status).toBe(200);
    vi.restoreAllMocks(); void real;
    expect(rows.map((r) => [r.action, r.release])).toEqual([["publish", 5], ["publish", 7], ["rollback", 6]]);
    expect(rows[2]).toMatchObject({ actor: "ada", actor_kind: "person", release_id: h });
    expect(JSON.parse(rows[2].before).release).toBe(7); expect(JSON.parse(rows[2].after).release).toBe(6);
    expect(JSON.stringify(rows)).not.toContain("secret123");
    // Read back through the API: this app only, newest first, paging.
    rows.push({ id: 99, app_id: "other", at: "x", actor: "z", actor_kind: "person", action: "publish" });
    const r = await get(db, "/audit/tide?limit=2", "sv_publish_secret123");
    const j: any = await r.json();
    expect(j.rows.map((x: any) => x.id)).toEqual([3, 2]); expect(j.next_before).toBe(2);
    const j2: any = await (await get(db, `/audit/tide?limit=2&before=${j.next_before}`, "sv_publish_secret123")).json();
    expect(j2.rows.map((x: any) => x.id)).toEqual([1]); expect(j2.next_before).toBeNull();
    expect(JSON.stringify(j)).not.toContain("secret123");
  });

  it("one release uploaded to b0, b1 and b2 writes one row", async () => {
    const { db, rows } = fakeDb(); const store: Record<string, string> = {};
    const mk = (release: number, band: string) => JSON.stringify({ body: JSON.stringify({ schema_version: "1.0", app_id: "tide", shell_major: 1, band, release, issued_at: "2026-10-30T00:00:00Z",
      core: { version: "1.0.0", sha256: "a".repeat(64), size: 10, url: "c" }, min_shell_version: "1.0.0" }), signature: "AAAA" });
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true); vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as any);
    const env = { DB: db, POINTERS: kv(store) } as any;
    const put = (r: number, b: string) => app.request(`/apps/tide/kv/p/tide/1/${b}`, { method: "PUT", body: mk(r, b), headers: { authorization: "Bearer sv_publish_secret123" } }, env);
    for (const b of ["b0", "b1", "b2"]) expect((await put(5, b)).status).toBe(200);
    for (const b of ["b0", "b1", "b2"]) expect((await put(4, b)).status).toBe(200);
    vi.restoreAllMocks();
    expect(rows.map((r) => [r.action, r.release])).toEqual([["publish", 5], ["rollback", 4]]);
  });

  it("halt writes a system row", async () => {
    const { db, rows } = fakeDb();
    const store: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 1 }) };
    const d2 = { prepare: (sql: string) => sql.includes("FROM telemetry WHERE app_id = ? AND release = ? GROUP BY event")
      ? { bind: () => ({ all: async () => ({ results: [{ event: "crash_loop_revert", n: 5 }, { event: "applied", n: 1 }] }) }) } : db.prepare(sql) } as any;
    const r = await app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 3, event: "crash_loop_revert" }) }, { DB: d2, POINTERS: kv(store) } as any);
    expect(r.status).toBe(202);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app_id: "tide", actor_kind: "system", action: "halt", release: 3, before: null });
    // A second halt on another release records the earlier one as "before".
    store["halt/tide"] = JSON.stringify({ release: 2 });
    await app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 3, event: "crash_loop_revert" }) }, { DB: d2, POINTERS: kv(store) } as any);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1].before)).toEqual({ halted: 2 });
  });

  it("a failed audit write warns and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordAudit(fakeDb({ failAudit: true }).db, { appId: "tide", actor: "a", kind: "person", action: "publish" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled(); warn.mockRestore();
  });
});
