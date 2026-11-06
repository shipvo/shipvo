import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import app from "../src/index";
import { hmacHex, netPrefix, netHash, signingSecret } from "../src/installs";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, release, event, cold_start_ms, bytes_downloaded, apply_ms, device_class, published_at, device_model, android_api, via)");
  sql.exec(readFileSync(new URL("../migrations/0019_install_identity.sql", import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const m: Record<string, string> = {};
  const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
  return { sql, env: { DB: db, POINTERS: kv, TELEMETRY_SECRET: "s3cret" } as any };
}
const reg = (env: any, body: unknown, ip = "203.0.113.9") => app.request("/t/register", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } }, env);
const report = { schema_version: "1.0", app_id: "tide", release: 3, event: "rolled_back" };
const send = (env: any, raw: string, headers: Record<string, string> = {}) => app.request("/t", { method: "POST", body: raw, headers }, env);
const verifiedRows = (sql: any) => sql.prepare("SELECT verified FROM telemetry ORDER BY id").all().map((r: any) => r.verified);

describe("POST /t/register", () => {
  it("returns a key and a token, and stores only the key hash", async () => {
    const { sql, env } = setup();
    const r = await reg(env, { app_id: "tide", install_id: "inst-aaaaaaaa", shell_version: "1.2.0" });
    expect(r.status).toBe(201);
    const j: any = await r.json();
    expect(j.install_id).toBe("inst-aaaaaaaa");
    expect(j.key).toMatch(/^[0-9a-f]{64}$/);
    const [payload, mac] = j.token.split(".");
    expect(mac).toBe(await hmacHex("s3cret", `register-token/${payload}`));
    expect(JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({ app_id: "tide", install_id: "inst-aaaaaaaa", shell_version: "1.2.0" });
    const row: any = sql.prepare("SELECT * FROM installs").get();
    expect(row.key_hash).toBe(await signingSecret(j.key));
    expect(JSON.stringify(row)).not.toContain(j.key);
    expect(JSON.stringify(row)).not.toContain("203.0.113");
    expect(row.net_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a second register, and rotates only with the old key", async () => {
    const { env } = setup();
    const body = { app_id: "tide", install_id: "inst-aaaaaaaa", shell_version: "1.2.0" };
    const first: any = await (await reg(env, body)).json();
    expect((await reg(env, body)).status).toBe(409);
    expect((await reg(env, { ...body, old_key: "nope" })).status).toBe(409);
    const rot = await reg(env, { ...body, old_key: first.key });
    expect(rot.status).toBe(200);
    expect(((await rot.json()) as any).key).not.toBe(first.key);
    expect((await reg(env, { ...body, old_key: first.key })).status).toBe(409);
  });
  it("rejects bad input and a missing secret", async () => {
    const { env } = setup();
    expect((await reg(env, { app_id: "tide", install_id: "x", shell_version: "1" })).status).toBe(400);
    expect((await reg({ ...env, TELEMETRY_SECRET: undefined }, { app_id: "tide", install_id: "inst-aaaaaaaa", shell_version: "1" })).status).toBe(503);
  });
  it("is rate limited per IP and per app", async () => {
    const { env } = setup();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await reg(env, { app_id: "tide", install_id: `inst-${String(i).padStart(8, "0")}`, shell_version: "1" })).status;
    expect(last).toBe(429);
    const e2 = setup().env; let st = 0;
    for (let i = 0; i < 201; i++) st = (await reg(e2, { app_id: "tide", install_id: `inst-${String(i).padStart(8, "0")}`, shell_version: "1" }, `198.51.${Math.floor(i / 250)}.${i % 250}`)).status;
    expect(st).toBe(429);
  });
});

describe("POST /t verification", () => {
  async function installed(env: any, id = "inst-aaaaaaaa") {
    const j: any = await (await reg(env, { app_id: "tide", install_id: id, shell_version: "1" }, "198.51.100.7")).json();
    return await signingSecret(j.key);
  }
  it("marks valid, missing, bad and unknown-install signatures", async () => {
    const { sql, env } = setup();
    const secret = await installed(env);
    const base = JSON.stringify({ ...report, install_id: "inst-aaaaaaaa" });
    const good = await hmacHex(secret, base);
    // header signature over the raw body
    expect((await send(env, base, { "x-shipvo-sig": good })).status).toBe(202);
    // sig field: signed over the body without the field
    const withSig = JSON.stringify({ ...report, install_id: "inst-aaaaaaaa", sig: good });
    await send(env, withSig);
    await send(env, JSON.stringify(report));                                  // no signature
    await send(env, base, { "x-shipvo-sig": "0".repeat(64) });               // bad signature
    await send(env, JSON.stringify({ ...report, install_id: "inst-zzzzzzzz", sig: good })); // unknown install
    expect(verifiedRows(sql)).toEqual([1, 1, 0, 0, 0]);
  });
  it("a body replayed under another install id is not verified", async () => {
    const { sql, env } = setup();
    const secretA = await installed(env, "inst-aaaaaaaa");
    await installed(env, "inst-bbbbbbbb");
    const sigA = await hmacHex(secretA, JSON.stringify({ ...report, install_id: "inst-aaaaaaaa" }));
    await send(env, JSON.stringify({ ...report, install_id: "inst-bbbbbbbb" }), { "x-shipvo-sig": sigA });
    expect(verifiedRows(sql)).toEqual([0]);
  });
});

describe("net hash", () => {
  it("uses the /24 and /48 and a per-app salt", async () => {
    expect(netPrefix("203.0.113.9")).toBe(netPrefix("203.0.113.200"));
    expect(netPrefix("203.0.113.9")).not.toBe(netPrefix("203.0.114.9"));
    expect(netPrefix("2001:db8:1::5")).toBe(netPrefix("2001:db8:1:ffff::1"));
    expect(netPrefix("2001:db8:2::5")).not.toBe(netPrefix("2001:db8:1::5"));
    expect(netPrefix("junk")).toBeNull();
    const a = await netHash("k", "tide", "203.0.113.9");
    expect(a).toBe(await netHash("k", "tide", "203.0.113.77"));
    expect(a).not.toBe(await netHash("k", "other", "203.0.113.9"));
    expect(await netHash(undefined, "tide", "203.0.113.9")).toBeNull();
  });
});
