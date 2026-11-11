import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { sandboxForKey, existingHost, QuotaError } from "../src/phones";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function setup() {
  const sql = new DatabaseSync(":memory:");
  const dir = new URL("../../control-plane/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const s = readFileSync(new URL(f, dir), "utf8");
    if (/sim_sessions/.test(s)) sql.exec(s);
  }
  sql.exec("CREATE TABLE api_keys (id INTEGER PRIMARY KEY, account_id INTEGER, quota_minutes INTEGER DEFAULT 0, used_minutes INTEGER DEFAULT 0)");
  const DB = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } };
  const env = { DB, E2B_API_KEY: "k", SESSION_TIMEOUT_S: "1800", SIM_REV: "r1" } as any;
  return { sql, env };
}

/** A fake E2B: sandboxes are running, paused or gone; health answers only for running ones. */
function stubE2B(refuseAutoPause = false) {
  const boxes = new Map<string, "running" | "paused">(); const calls: string[] = []; const created: any[] = []; let n = 0;
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input)); const m = init?.method ?? "GET";
    const host = /^8787-(\w+)\.e2b\.app$/.exec(u.host);
    if (host) return new Response("", { status: u.pathname === "/health" && boxes.get(host[1]) === "running" ? 200 : 502 });
    calls.push(`${m} ${u.pathname}`);
    if (m === "POST" && u.pathname === "/sandboxes") { const body = JSON.parse(init.body); created.push(body); if (refuseAutoPause && body.autoPause) return new Response("autoPause not allowed", { status: 400 }); const id = `sb${++n}`; boxes.set(id, "running"); return Response.json({ sandboxID: id, domain: "e2b.app", autoPause: body.autoPause }); }
    const c = /^\/v2\/sandboxes\/(\w+)\/connect$/.exec(u.pathname);
    if (c) { if (!boxes.has(c[1])) return new Response("not found", { status: 404 }); boxes.set(c[1], "running"); return Response.json({ sandboxID: c[1] }, { status: 201 }); }
    const d = /^\/sandboxes\/(\w+)$/.exec(u.pathname); if (d && m === "DELETE") { boxes.delete(d[1]); return new Response(null, { status: 204 }); }
    if (/\/timeout$/.test(u.pathname)) return new Response(null, { status: 204 });
    throw new Error("unexpected " + m + " " + u);
  });
  return { boxes, calls, created };
}
afterEach(() => vi.unstubAllGlobals());

describe("phone pools", () => {
  it("are created to pause on idle, not to be deleted", async () => {
    const { env, sql } = setup(); const e = stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7)");
    const sb = await sandboxForKey(env, 1, "app", "test", 0);
    expect(sb.id).toBe("sb1");
    expect(e.calls).toEqual(["POST /sandboxes"]);
    expect(e.created[0]).toMatchObject({ autoPause: true, timeout: 1800 });
  });

  it("a paused pool is resumed with its phones, not replaced", async () => {
    const { env, sql } = setup(); const e = stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7)");
    await sandboxForKey(env, 1, "app", "test", 0);
    e.boxes.set("sb1", "paused");
    const again = await sandboxForKey(env, 1, "app", "test", 0);
    expect(again).toMatchObject({ id: "sb1", resumed: true });
    expect(e.calls).toEqual(["POST /sandboxes", "POST /v2/sandboxes/sb1/connect"]);
  });

  it("a pool E2B no longer has is replaced by a new one", async () => {
    const { env, sql } = setup(); const e = stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7)");
    await sandboxForKey(env, 1, "app", "test", 0);
    e.boxes.delete("sb1");
    expect((await sandboxForKey(env, 1, "app", "test", 0)).id).toBe("sb2");
  });

  it("every key of one account shares one pool, so assistants see the same phones", async () => {
    const { env, sql } = setup(); stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7), (2, 7), (3, 8), (4, NULL)");
    const a = await sandboxForKey(env, 1, "app", "test", 0);
    expect((await sandboxForKey(env, 2, "app", "test", 0)).id).toBe(a.id);
    expect((await sandboxForKey(env, 3, "app", "test", 0)).id).not.toBe(a.id);
    expect((await sandboxForKey(env, 4, "app", "test", 0)).id).not.toBe(a.id);
    expect(await existingHost(env, 2)).toBe(`https://8787-${a.id}.e2b.app`);
  });

  it("a pool made per key before this change carries over to the account", async () => {
    const { env, sql } = setup(); const e = stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7)");
    e.boxes.set("old", "running");
    sql.exec("INSERT INTO sim_sessions (mcp_session, sandbox_id, sandbox_host, app_id, scope, rev) VALUES ('key:1', 'old', 'https://8787-old.e2b.app', 'app', 'test', 'r1')");
    expect((await sandboxForKey(env, 1, "app", "test", 0)).id).toBe("old");
    expect(e.calls).toEqual(["POST /sandboxes/old/timeout"]);
  });

  it("resuming counts against the quota, and a full quota refuses before E2B is called", async () => {
    const { env, sql } = setup(); const e = stubE2B();
    sql.exec("INSERT INTO api_keys (id, account_id, quota_minutes) VALUES (1, 7, 60)");
    await sandboxForKey(env, 1, "app", "test", 0);
    e.boxes.set("sb1", "paused");
    await sandboxForKey(env, 1, "app", "test", 0);
    expect(sql.prepare("SELECT used_minutes FROM api_keys WHERE id = 1").get().used_minutes).toBe(60);
    e.boxes.set("sb1", "paused");
    await expect(sandboxForKey(env, 1, "app", "test", 0)).rejects.toBeInstanceOf(QuotaError);
    expect(e.calls.filter((c) => c.includes("connect"))).toHaveLength(1);
  });

  it("a plan that refuses auto-pause still gets a phone", async () => {
    const { env, sql } = setup(); const e = stubE2B(true);
    sql.exec("INSERT INTO api_keys (id, account_id) VALUES (1, 7)");
    expect((await sandboxForKey(env, 1, "app", "test", 0)).id).toBe("sb1");
    expect(e.created.map((b) => b.autoPause ?? null)).toEqual([true, null]);
  });
});
