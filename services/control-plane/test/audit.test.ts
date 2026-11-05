import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import app from "../src/index";
import { recordAudit } from "../src/audit";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

function mkDb(rows: any[], tokens: Record<string, string> = {}) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    run: async () => { calls.push({ sql, args }); return {}; },
    first: async () => {
      if (sql.includes("FROM publish_tokens")) return tokens[args[0] as string] === args[1] ? { id: 1, expires_at: null } : null;
      if (sql.includes("FROM apps")) return { public_key: "k", bytes_used: 0 };
      return null;
    },
    all: async () => {
      calls.push({ sql, args });
      let r = rows.filter((x) => x.app_id === args[0]);
      if (sql.includes("id < ?")) r = r.filter((x) => x.id < (args[1] as number));
      r = r.sort((a, b) => b.id - a.id).slice(0, args[args.length - 1] as number);
      return { results: r };
    },
  }) }) } as any;
  return { DB, calls };
}
const mk = (n: number, appId: string) => Array.from({ length: n }, (_, i) => ({ id: i + 1, app_id: appId, at: "t", actor: "a", actor_kind: "person", action: "publish", release: i, release_id: null, before: null, after: null }));

describe("recordAudit", () => {
  it("inserts one row and truncates before/after to 1000 chars", async () => {
    const { DB, calls } = mkDb([]);
    await recordAudit(DB, { app_id: "tide", actor: "ann", actor_kind: "person", action: "halt", before: "x".repeat(2000), after: "{}" });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO audit_log");
    expect((calls[0].args[7] as string).length).toBe(1000);
    expect(calls[0].args[8]).toBe("{}");
  });
  it("swallows a DB error and warns with only app and action", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const DB = { prepare: () => { throw new Error("secret-detail"); } };
    await expect(recordAudit(DB, { app_id: "tide", actor: "ann", actor_kind: "person", action: "rollback", after: "sv_publish_zzz" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0].join(" "));
    expect(msg).toContain("tide"); expect(msg).toContain("rollback");
    expect(msg).not.toContain("secret-detail"); expect(msg).not.toContain("sv_publish_zzz");
    warn.mockRestore();
  });
});

describe("migration 0016", () => {
  it("is additive and guarded", () => {
    const sql = readFileSync(new URL("../migrations/0016_audit_log.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS audit_log/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(sql).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE)\b/i);
  });
});

describe("GET /audit/:app", () => {
  it("is 401 without a token or with a wrong one", async () => {
    const { DB } = mkDb(mk(3, "tide"));
    const env = { DB, POINTERS: {} as any, OWNER_TOKEN: "tok" } as any;
    expect((await app.request("/audit/tide", {}, env)).status).toBe(401);
    expect((await app.request("/audit/tide", { headers: { authorization: "Bearer nope" } }, env)).status).toBe(401);
  });
  it("refuses another app's publish token", async () => {
    const key = "sv_publish_other";
    const { DB } = mkDb(mk(3, "tide"), { [await sha(key)]: "other" });
    const env = { DB, POINTERS: {} as any, OWNER_TOKEN: "tok" } as any;
    expect((await app.request("/audit/tide", { headers: { authorization: `Bearer ${key}` } }, env)).status).toBe(401);
  });
  it("returns only that app's rows, newest first, for the publish token", async () => {
    const key = "sv_publish_tide";
    const { DB } = mkDb([...mk(3, "tide"), ...mk(2, "other")], { [await sha(key)]: "tide" });
    const env = { DB, POINTERS: {} as any } as any;
    const r = await app.request("/audit/tide", { headers: { authorization: `Bearer ${key}` } }, env);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.rows.map((x: any) => x.id)).toEqual([3, 2, 1]);
    expect(body.rows.every((x: any) => x.app_id === "tide")).toBe(true);
    expect(JSON.stringify(body)).not.toContain(key);
  });
  it("pages with limit and before, and caps limit at 200", async () => {
    const { DB, calls } = mkDb(mk(5, "tide"));
    const env = { DB, POINTERS: {} as any, OWNER_TOKEN: "tok" } as any;
    const H = { authorization: "Bearer tok" };
    const p1: any = await (await app.request("/audit/tide?limit=2", { headers: H }, env)).json();
    expect(p1.rows.map((x: any) => x.id)).toEqual([5, 4]);
    const p2: any = await (await app.request("/audit/tide?limit=2&before=4", { headers: H }, env)).json();
    expect(p2.rows.map((x: any) => x.id)).toEqual([3, 2]);
    await app.request("/audit/tide?limit=9999", { headers: H }, env);
    expect(calls[calls.length - 1].args.at(-1)).toBe(200);
    await app.request("/audit/tide", { headers: H }, env);
    expect(calls[calls.length - 1].args.at(-1)).toBe(50);
    expect((await app.request("/audit/tide?limit=abc", { headers: H }, env)).status).toBe(400);
    expect((await app.request("/audit/tide?before=x", { headers: H }, env)).status).toBe(400);
  });
});
