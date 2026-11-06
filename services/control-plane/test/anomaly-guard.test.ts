import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import app from "../src/index";
import { hmacHex, signingSecret } from "../src/installs";
import { TELEMETRY_LIMITS } from "../src/ratelimit";
import { MAX_UNVERIFIED_ALERTS_PER_APP } from "../src/alerts";
import { detectAnomaly } from "../src/halt";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
afterEach(() => vi.unstubAllGlobals());

function setup(kvInit: Record<string, string> = {}) {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0001_telemetry", "0002_telemetry_via", "0014_alert_webhook", "0019_install_identity", "0020_telemetry_install_id"]) sql.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), "utf8"));
  sql.exec("CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, at, actor, command, args_json, ok)");
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const m: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2 }), ...kvInit };
  const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; }, delete: async (k: string) => { delete m[k]; },
    list: async ({ prefix }: { prefix: string }) => ({ keys: Object.keys(m).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) } as any;
  return { sql, m, env: { DB: db, POINTERS: kv, TELEMETRY_SECRET: "s3cret", OWNER_TOKEN: "owner-secret", ADMIN_PASSWORD: "pw" } as any };
}
const reg = (env: any, id: string, ip: string) => app.request("/t/register", { method: "POST", body: JSON.stringify({ app_id: "tide", install_id: id, shell_version: "1" }), headers: { "cf-connecting-ip": ip } }, env);
const post = (env: any, body: unknown, headers: Record<string, string> = {}) => app.request("/t", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }, env);
const rb = (release = 3, extra: object = {}) => ({ schema_version: "1.0", app_id: "tide", release, event: "rolled_back", ...extra });
/** Register an install, optionally age it, and send one signed rollback. */
async function signedFail(s: ReturnType<typeof setup>, i: number, ip: string, aged: boolean, release = 3) {
  const id = `inst-${String(i).padStart(8, "0")}`;
  const j: any = await (await reg(s.env, id, ip)).json();
  if (aged) s.sql.prepare("UPDATE installs SET created_at = '2020-01-01T00:00:00.000Z' WHERE install_id = ?").run(id);
  const body = JSON.stringify(rb(release, { install_id: id }));
  return post(s.env, body, { "x-shipvo-sig": await hmacHex(await signingSecret(j.key), body) });
}
const IPS = ["203.0.113.", "198.51.100.", "192.0.2."];
async function fleet(s: ReturnType<typeof setup>, n: number, aged: boolean) {
  for (let i = 0; i < n; i++) await signedFail(s, i, IPS[i % 3] + (i + 1), aged);
}
async function cookie(pw: string, appId: string) {
  const exp = Date.now() + 3600_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pn_admin=${appId}.${exp}.${sig}`;
}
const approvals = async (env: any) => ((await (await app.request("/app/tide/api/approvals", { headers: { authorization: "Bearer owner-secret" } }, env)).json()) as any).approvals as any[];

describe("anomaly guard", () => {
  it("holds a burst of fresh-install failures instead of halting, and files an approval", async () => {
    const s = setup(); await fleet(s, 20, false);
    expect(s.m["halt/tide"]).toBeUndefined();
    expect(JSON.parse(s.m["halt-hold/tide"]!)).toMatchObject({ release: 3 });
    const list = await approvals(s.env);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ command: "confirm_halt", requester: "halt-rule" });
  });
  it("does not file a second approval while the release is held", async () => {
    const s = setup(); await fleet(s, 22, false);
    expect(await approvals(s.env)).toHaveLength(1);
  });
  it("still halts when the failing installs are not fresh", async () => {
    const s = setup(); await fleet(s, 20, true);
    expect(JSON.parse(s.m["halt/tide"]!)).toMatchObject({ release: 3 });
    expect(s.m["halt-hold/tide"]).toBeUndefined();
  });
  it("owner confirm halts the held release", async () => {
    const s = setup(); await fleet(s, 20, false);
    const [a] = await approvals(s.env);
    const r = await app.request(`/app/tide/api/approvals/${a.id}/approve`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, s.env);
    expect(r.status).toBe(200);
    expect(JSON.parse(s.m["halt/tide"]!)).toMatchObject({ release: 3, confirmed_by: "owner (admin)" });
    expect(s.m["halt-hold/tide"]).toBeUndefined();
  });
  it("the owner token cannot confirm, and owner dismiss clears the hold without halting", async () => {
    const s = setup(); await fleet(s, 20, false);
    const [a] = await approvals(s.env);
    expect((await app.request(`/app/tide/api/approvals/${a.id}/approve`, { method: "POST", headers: { authorization: "Bearer owner-secret" } }, s.env)).status).toBe(403);
    expect(s.m["halt/tide"]).toBeUndefined();
    expect((await app.request(`/app/tide/api/approvals/${a.id}/deny`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, s.env)).status).toBe(200);
    expect(s.m["halt/tide"]).toBeUndefined();
    expect(s.m["halt-hold/tide"]).toBeUndefined();
    expect(await approvals(s.env)).toHaveLength(0);
  });
  it("a failure report after the owner approves files no new approval and leaves halt/ unchanged", async () => {
    const s = setup(); await fleet(s, 20, false);
    const [a] = await approvals(s.env);
    await app.request(`/app/tide/api/approvals/${a.id}/approve`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, s.env);
    const before = s.m["halt/tide"];
    await signedFail(s, 50, "203.0.113.50", false);
    expect(await approvals(s.env)).toHaveLength(0);
    expect(s.m["halt/tide"]).toBe(before);
    expect(s.m["halt-hold/tide"]).toBeUndefined();
  });
  it("after Deny, more failures for that release are not held again", async () => {
    const s = setup(); await fleet(s, 20, false);
    const [a] = await approvals(s.env);
    await app.request(`/app/tide/api/approvals/${a.id}/deny`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, s.env);
    expect(JSON.parse(s.m["halt-hold-denied/tide"]!)).toMatchObject({ release: 3 });
    await signedFail(s, 51, "203.0.113.51", false);
    expect(await approvals(s.env)).toHaveLength(0);
    expect(s.m["halt-hold/tide"]).toBeUndefined();
  });
  it("detectAnomaly: spike needs history, a floor, and a multiple of the normal rate", () => {
    const base = { failedInstalls: 20, freshFailedInstalls: 0, recentFailures: 50, baselineFailures: 10, history: 500 };
    expect(detectAnomaly(base)).toMatch(/50 failures/);
    expect(detectAnomaly({ ...base, history: 0 })).toBeNull();
    expect(detectAnomaly({ ...base, recentFailures: 5 })).toBeNull();
    expect(detectAnomaly({ ...base, baselineFailures: null })).toBeNull();
    expect(detectAnomaly({ ...base, baselineFailures: 100000 })).toBeNull();
  });
});

describe("alert slots", () => {
  it("forged rollbacks cannot use up the slots real ones need", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const s = setup({ "halt-config/tide": "" });
    s.sql.prepare("INSERT INTO app_alerts (app_id, webhook) VALUES ('tide', 'https://hooks.example.com/x')").run();
    for (let r = 1; r <= 40; r++) await post(s.env, rb(1000 + r), { "cf-connecting-ip": "10.0.0." + r });
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(MAX_UNVERIFIED_ALERTS_PER_APP);
    // A real (signed) rollback for a real release still gets its alert.
    await signedFail(s, 1, "203.0.113.5", true, 3);
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(MAX_UNVERIFIED_ALERTS_PER_APP + 1);
  });
});

describe("halt_held alert", () => {
  it("does not suppress the real rolled_back alert for the same release", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const s = setup();
    s.sql.prepare("INSERT INTO app_alerts (app_id, webhook) VALUES ('tide', 'https://hooks.example.com/x')").run();
    await fleet(s, 20, false); // fresh installs: the release is held and a halt_held alert is sent
    await new Promise((r) => setTimeout(r, 20));
    const events = () => f.mock.calls.map((c: any) => JSON.parse(c[1].body).event);
    expect(events()).toContain("halt_held");
    expect(events()).toContain("rolled_back"); // the first signed revert for release 3 still alerted
  });
});

describe("POST /t rate limits", () => {
  it("answers 429 per IP", async () => {
    const s = setup(); let last = 0;
    for (let i = 0; i <= TELEMETRY_LIMITS.perIp; i++) last = (await post(s.env, { ...rb(i % 5 + 1), event: "applied" }, { "cf-connecting-ip": "198.51.100.1" })).status;
    expect(last).toBe(429);
    expect((await post(s.env, { ...rb(), event: "applied" }, { "cf-connecting-ip": "198.51.100.2" })).status).toBe(202);
  });
  const signedApplied = async (s: ReturnType<typeof setup>, id: string, key: string, ip: string) => {
    const body = JSON.stringify({ ...rb(), event: "applied", install_id: id });
    return post(s.env, body, { "x-shipvo-sig": await hmacHex(await signingSecret(key), body), "cf-connecting-ip": ip });
  };
  it("answers 429 per verified install, not for another install", async () => {
    const s = setup(); let last = 0;
    const ka = ((await (await reg(s.env, "inst-aaaaaaaa", "9.9.9.1")).json()) as any).key;
    const kb = ((await (await reg(s.env, "inst-bbbbbbbb", "9.9.9.2")).json()) as any).key;
    for (let i = 0; i <= TELEMETRY_LIMITS.perInstall; i++) last = (await signedApplied(s, "inst-aaaaaaaa", ka, "10.1.0." + i)).status;
    expect(last).toBe(429);
    expect((await signedApplied(s, "inst-bbbbbbbb", kb, "10.2.0.1")).status).toBe(202);
  });
  it("unsigned posts with an install id do not use up that install's budget", async () => {
    const s = setup();
    const k = ((await (await reg(s.env, "inst-xxxxxxxx", "9.9.9.3")).json()) as any).key;
    for (let i = 0; i <= TELEMETRY_LIMITS.perInstall; i++) await post(s.env, { ...rb(), event: "applied", install_id: "inst-xxxxxxxx" }, { "cf-connecting-ip": "10.3.0." + i });
    expect((await signedApplied(s, "inst-xxxxxxxx", k, "10.4.0.1")).status).toBe(202);
  });
  it("answers 429 per app", async () => {
    const s = setup(); let last = 0;
    for (let i = 0; i <= TELEMETRY_LIMITS.perApp; i++) last = (await post(s.env, { ...rb(), event: "applied" }, { "cf-connecting-ip": `10.${i >> 8}.${i & 255}.1` })).status;
    expect(last).toBe(429);
  });
});
