import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import { newInstall } from "./signed";

// A small D1 stand-in that really evaluates the queries the halt code runs, over an array of rows.
const FAILED = ["rolled_back", "crash_loop_revert", "verify_failed", "download_failed"];
function world(cfg: object = { threshold: 0.2, min_reports: 50 }, webhook: string | null = null) {
  const kvm: Record<string, string> = { "halt-config/tide": JSON.stringify(cfg) };
  const rows: any[] = [], audits: any[][] = [], sent = new Map<string, string>();
  const distinct = (xs: any[], f: (r: any) => any) => new Set(xs.map(f).filter((v) => v != null)).size;
  const DB = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    run: async () => {
      if (sql.startsWith("INSERT INTO telemetry")) rows.push({ app: a[0], release: a[1], event: a[2], install: a[11], verified: a[12], net: a[13], fresh: a[14], at: new Date(Date.now()).toISOString() });
      if (sql.startsWith("INSERT INTO audit_log")) audits.push(a);
      if (sql.startsWith("INSERT INTO alert_sent")) { const k = `${a[0]}/${a[1]}`; if (sent.has(k) && !(sent.get(k)! <= a[3])) return { meta: { changes: 0 } }; sent.set(k, a[2]); return { meta: { changes: 1 } }; }
      return { meta: { changes: 1 } };
    },
    all: async () => {
      const m = rows.filter((r) => r.app === a[0] && r.release === a[1] && r.verified === 1);
      const by: Record<string, number> = {};
      for (const e of new Set(m.map((r) => r.event))) by[e] = distinct(m.filter((r) => r.event === e), (r) => r.install);
      return { results: Object.entries(by).map(([event, n]) => ({ event, n })) };
    },
    first: async () => {
      if (sql.includes("AS installs")) {
        const m = rows.filter((r) => r.app === a[1] && r.release === a[2] && r.verified === 1 && FAILED.includes(r.event));
        return { installs: distinct(m, (r) => r.install), nets: distinct(m, (r) => r.net), fresh_installs: distinct(m.filter((r) => r.fresh), (r) => r.install), recent: distinct(m.filter((r) => r.at >= a[0]), (r) => r.install) };
      }
      if (sql.includes("COUNT(*) AS n FROM telemetry")) return { n: rows.filter((r) => r.app === a[0] && r.verified === 1 && r.release !== a[1] && FAILED.includes(r.event) && r.at >= a[2] && r.at < a[3]).length };
      if (sql.includes("COUNT(DISTINCT install_id) AS n")) return { n: distinct(rows.filter((r) => r.app === a[0] && r.release === a[1] && r.verified === 1 && ["rolled_back", "crash_loop_revert"].includes(r.event)), (r) => r.install) };
      if (sql.includes("FROM app_alerts")) return webhook ? { webhook } : null;
      if (sql.includes("COUNT(*)")) return { n: [...sent.keys()].filter((k) => k.startsWith(`${a[0]}/`)).length };
      return null;
    },
  }) }) } as any;
  const POINTERS = { get: async (k: string) => kvm[k] ?? null, put: async (k: string, v: string) => { kvm[k] = v; }, list: async ({ prefix }: any) => ({ keys: Object.keys(kvm).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) } as any;
  return { env: { DB, POINTERS, OWNER_TOKEN: "secret" } as any, kvm, rows, audits };
}
const rb = (release = 5, event = "rolled_back") => ({ schema_version: "1.0", app_id: "tide", release, event });
const ok = (n: number, release = 5) => ({ schema_version: "1.0", app_id: "tide", release, event: "applied", n });
const raw = (env: any, body: unknown, ip = "203.0.113.9") => app.request("/t", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify(body) }, env);
const halted = (w: ReturnType<typeof world>) => w.kvm["halt/tide"];
const held = (w: ReturnType<typeof world>) => w.kvm["c/tide/approval/halt-5"];
afterEach(() => vi.restoreAllMocks());

/** Register `n` installs on `n` different /24 networks, then let them age past the "fresh" hour. */
async function aged(w: ReturnType<typeof world>, n: number, net = (i: number) => `198.${(i >> 8) + 18}.${i & 255}.5`) {
  const installs = [];
  for (let i = 0; i < n; i++) installs.push(await newInstall(w.env, "tide", net(i)));
  const t0 = Date.now(); vi.spyOn(Date, "now").mockReturnValue(t0 + 2 * 3600_000);
  return installs;
}

describe("forged telemetry never halts", () => {
  it("reports with no token, a bad token or a bad HMAC are stored unverified and never count", async () => {
    const w = world();
    const good = await newInstall(w.env);
    for (let i = 0; i < 120; i++) {
      const ip = `192.0.${i >> 8}.${i & 255}`;
      await raw(w.env, { ...rb(), ...(i % 3 === 0 ? {} : { install_id: `f${i}`.padEnd(32, "f"), install_token: "x", sig: "0".repeat(64) }), n: i }, ip);
    }
    const sig = (await good.sign(rb())).sig;
    await raw(w.env, { ...rb(), install_id: good.install_id, install_token: "bad", sig });            // right sig, wrong token
    await raw(w.env, { ...(await good.sign(rb())), event: "crash_loop_revert" });                       // body changed after signing
    expect(w.rows.length).toBe(122);
    expect(w.rows.every((r) => r.verified === 0)).toBe(true);
    expect(halted(w)).toBeUndefined();
    expect(held(w)).toBeUndefined();
  });
  it("a replayed body is stored once", async () => {
    const w = world();
    const inst = await newInstall(w.env);
    const body = await inst.sign(rb());
    expect((await raw(w.env, body)).status).toBe(202);
    const again = await raw(w.env, body);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(w.rows.length).toBe(1);
  });
  it("one install voting many times counts once", async () => {
    const w = world({ threshold: 0.1, min_reports: 1, min_installs: 2 });
    const [one] = await aged(w, 1);
    for (let i = 0; i < 200; i++) await one.send(rb());
    expect(w.rows.length).toBeGreaterThan(20); // the per-install rate limit stops the rest
    expect(halted(w)).toBeUndefined();
  });
  it("many fresh installs from one network never halt or ask", async () => {
    const w = world({ threshold: 0.1, min_reports: 5, min_installs: 20 });
    const installs = await aged(w, 30, (i) => `198.51.100.${i}`);
    for (const i of installs) await i.send(rb(), "198.51.100.1");
    expect(halted(w)).toBeUndefined();
    expect(held(w)).toBeUndefined();
  });
  it("a spread of verified installs halts, and an old unverified flood on top changes nothing", async () => {
    const w = world();
    const installs = await aged(w, 60);
    for (const i of installs.slice(0, 30)) await i.send(ok(1));
    for (const i of installs.slice(30, 55)) await i.send(rb());
    expect(JSON.parse(halted(w))).toMatchObject({ release: 5, failed: 20, reports: 50 }); // halts as soon as 20 distinct installs failed
    expect(w.audits.some((a) => a[2] === "halt-rule")).toBe(true);
  });
  it("does not halt below min_installs even when the share is 100%", async () => {
    const w = world();
    const installs = await aged(w, 15);
    for (const i of installs) await i.send(rb());
    for (let i = 0; i < 60; i++) await raw(w.env, { ...rb(), n: i }, `10.9.${i}.1`);
    expect(halted(w)).toBeUndefined();
  });
});

describe("anomaly guard", () => {
  it("holds the halt for the owner when most failing installs are new, and the owner can confirm it", async () => {
    const w = world();
    const fresh = [];
    for (let i = 0; i < 30; i++) fresh.push(await newInstall(w.env, "tide", `198.18.${i}.5`));
    for (const i of fresh) await i.send(ok(1));
    for (const i of fresh.slice(0, 25)) await i.send(rb());
    expect(halted(w)).toBeUndefined();
    const hold = JSON.parse(held(w));
    expect(hold).toMatchObject({ kind: "halt", status: "pending", release: 5 });
    expect(hold.reason).toContain("registered in the last hour");
    const list = await (await app.request("/apps/tide/approvals", { headers: { authorization: "Bearer secret" } }, w.env)).json() as any;
    expect(list.approvals[0]).toMatchObject({ id: "halt-5", kind: "halt" });
    const summary = await (await app.request("/t/tide/summary", {}, w.env)).json() as any;
    expect(summary.halt_holds[0]).toMatchObject({ id: "halt-5", release: 5 });
    expect((await app.request("/apps/tide/approvals/halt-5/approve", { method: "POST", headers: { authorization: "Bearer secret" } }, w.env)).status).toBe(200);
    expect(JSON.parse(halted(w))).toMatchObject({ release: 5, confirmed_by: "agent (owner token)" });
  });
  it("a dismissed hold stays dismissed and does not halt", async () => {
    const w = world();
    const fresh = [];
    for (let i = 0; i < 30; i++) fresh.push(await newInstall(w.env, "tide", `198.18.${i}.5`));
    for (const i of fresh) await i.send(ok(1));
    for (const i of fresh.slice(0, 25)) await i.send(rb());
    expect(held(w)).toBeDefined();
    expect((await app.request("/apps/tide/approvals/halt-5/reject", { method: "POST", headers: { authorization: "Bearer secret" } }, w.env)).status).toBe(200);
    for (const i of fresh.slice(25)) await i.send(rb());
    expect(halted(w)).toBeUndefined();
    expect(JSON.parse(held(w)).status).toBe("rejected");
  });
  it("holds when failures jump far above the app's normal rate", async () => {
    const w = world({ threshold: 0.2, min_reports: 50, min_installs: 20 });
    const installs = await aged(w, 60);
    const now = Date.now();
    // Normal: 24 failures of other releases spread over the last day (baseline about 0.17 per 10 minutes).
    for (let i = 0; i < 24; i++) w.rows.push({ app: "tide", release: 4, event: "rolled_back", install: `old${i}`, verified: 1, net: `n${i}`, fresh: 0, at: new Date(now - 3600_000 * (3 + i * 0.8)).toISOString() });
    for (const i of installs.slice(0, 30)) await i.send(ok(1));
    for (const i of installs.slice(30, 60)) await i.send(rb());
    expect(halted(w)).toBeUndefined();
    expect(JSON.parse(held(w)).reason).toContain("jumped");
  });
});

describe("rate limits and alert slots", () => {
  it("limits POST /t per IP and /t/register per IP", async () => {
    const w = world();
    let last = 0;
    for (let i = 0; i < 305; i++) last = (await raw(w.env, { ...rb(), n: i }, "192.0.2.1")).status;
    expect(last).toBe(429);
    expect((await raw(w.env, { ...rb(), n: 1 }, "192.0.2.2")).status).toBe(202);
    const reg = (i: number) => app.request("/t/register", { method: "POST", headers: { "cf-connecting-ip": "192.0.2.50" }, body: JSON.stringify({ schema_version: "1.0", app_id: "tide", install_id: `${i}`.padStart(16, "0"), install_key: "a".repeat(64), shell_version: "1.0.0" }) }, w.env);
    const codes = []; for (let i = 0; i < 12; i++) codes.push((await reg(i)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
  it("limits one install per minute and refuses to re-register an install id with another key", async () => {
    const w = world();
    const inst = await newInstall(w.env);
    let last = 0; for (let i = 0; i < 35; i++) last = (await inst.send(ok(i))).status;
    expect(last).toBe(429);
    const r = await app.request("/t/register", { method: "POST", headers: { "cf-connecting-ip": "192.0.2.77" }, body: JSON.stringify({ schema_version: "1.0", app_id: "tide", install_id: inst.install_id, install_key: "c".repeat(64), shell_version: "1.0.0" }) }, w.env);
    expect(r.status).toBe(409);
  });
  it("forged rollbacks cannot use up alert slots; real corroborated reverts still alert", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const w = world({ threshold: 0.2 }, "https://hooks.example.com/x");
    const waits: Promise<unknown>[] = []; const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as any;
    for (let r = 1; r <= 40; r++) for (let k = 0; k < 3; k++) await app.request("/t", { method: "POST", headers: { "cf-connecting-ip": `192.0.${r}.${k}` }, body: JSON.stringify({ ...rb(r), n: k }) }, w.env, ctx);
    await Promise.all(waits);
    expect(f).not.toHaveBeenCalled();
    // One verified install is not enough either.
    const one = await newInstall(w.env, "tide", "198.51.100.1");
    for (let k = 0; k < 5; k++) await one.sendWith(rb(77), ctx);
    await Promise.all(waits);
    expect(f).not.toHaveBeenCalled();
    for (let k = 0; k < 3; k++) await (await newInstall(w.env, "tide", `198.51.${100 + k}.1`)).sendWith(rb(77), ctx);
    await Promise.all(waits);
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it("old runtimes keep working: an unsigned report is accepted and stored", async () => {
    const w = world();
    const r = await raw(w.env, rb());
    expect(r.status).toBe(202);
    expect(w.rows[0]).toMatchObject({ verified: 0, install: null });
  });
});
