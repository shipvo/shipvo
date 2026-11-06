import { describe, it, expect, vi, afterEach } from "vitest";
let forceVerified = false;
vi.mock("../src/installs", async (orig) => { const m: any = await orig(); return { ...m, verifyReport: async (...a: any[]) => forceVerified || m.verifyReport(...a) }; });
import app from "../src/index";
import { runOwnerCommand } from "../src/owner";
import { MAX_ALERTS_PER_APP, MAX_UNVERIFIED_ALERTS_PER_APP, sendRevertAlert } from "../src/alerts";

// A tiny D1 stand-in for the three statements the alert code uses.
function fakeDb(webhook: string | null) {
  const sent = new Map<string, string>(); let hook = webhook;
  const d = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
    run: async () => {
      if (sql.startsWith("INSERT INTO alert_sent")) {
        const k = `${sql.includes("alert_sent_unverified") ? "u" : "v"}:${a[0]}/${a[1]}`; const prev = sent.get(k);
        if (prev && !(prev <= a[3])) return { meta: { changes: 0 } };
        sent.set(k, a[2]); return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM alert_sent")) {
        const pre = sql.includes("alert_sent_unverified") ? "u" : "v";
        for (const [k, v] of sent) if (k.startsWith(`${pre}:${a[0]}/`) && v <= a[1]) sent.delete(k);
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT INTO app_alerts")) hook = a[1];
      if (sql.startsWith("DELETE FROM app_alerts")) hook = null;
      return { meta: { changes: 1 } };
    },
    first: async () => sql.includes("COUNT(*)") ? { n: [...sent.keys()].filter((k) => k.startsWith(`${sql.includes("alert_sent_unverified") ? "u" : "v"}:${a[0]}/`)).length } : (sql.includes("FROM app_alerts") && hook ? { webhook: hook } : null),
  }) }) } as any;
  return { d, get hook() { return hook; } };
}
const ev = (event: string, release = 3) => ({ schema_version: "1.0", app_id: "tide", release, event });
const send = (db: any, body: unknown, ctx?: any) => app.request("/t", { method: "POST", body: JSON.stringify(body) }, { DB: db } as any, ctx);
const ctx = () => { const p: Promise<unknown>[] = []; return { c: { waitUntil: (x: Promise<unknown>) => p.push(x), passThroughOnException() {} } as any, done: () => Promise.all(p) }; };

afterEach(() => { vi.unstubAllGlobals(); forceVerified = false; });

describe("revert webhook alert", () => {
  it("sends one POST with the expected body", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    expect((await send(d, ev("crash_loop_revert"), x.c)).status).toBe(202);
    await x.done();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("https://hooks.example.com/x"); expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["app", "event", "release", "time"]);
    expect(body).toMatchObject({ app: "tide", release: 3, event: "crash_loop_revert" });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
  it("sends nothing for a second revert of the same release within the hour, but does for another release", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    await send(d, ev("rolled_back"), x.c); await send(d, ev("crash_loop_revert"), x.c); await x.done();
    expect(f).toHaveBeenCalledTimes(1);
    await send(d, ev("rolled_back", 4), x.c); await x.done();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("sends again for the same release once the hour has passed", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    const t0 = Date.now(); const now = vi.spyOn(Date, "now");
    now.mockReturnValue(t0); await send(d, ev("rolled_back"), x.c); await x.done();
    now.mockReturnValue(t0 + 3600_000 - 1000); await send(d, ev("rolled_back"), x.c); await x.done();
    expect(f).toHaveBeenCalledTimes(1);
    now.mockReturnValue(t0 + 3600_000 + 1000); await send(d, ev("rolled_back"), x.c); await x.done();
    expect(f).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
  it("caps alerts per app across distinct releases, and frees the cap after the hour", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    const t0 = Date.now(); const now = vi.spyOn(Date, "now"); now.mockReturnValue(t0);
    for (let r = 1; r <= 25; r++) await sendRevertAlert(d, "tide", r, "rolled_back", true);
    expect(f).toHaveBeenCalledTimes(MAX_ALERTS_PER_APP);
    now.mockReturnValue(t0 + 3600_000 + 1000); await sendRevertAlert(d, "tide", 99, "rolled_back", true);
    expect(f).toHaveBeenCalledTimes(MAX_ALERTS_PER_APP + 1);
    now.mockRestore();
  });
  it("forged rollbacks do not use up the alert slots for real ones", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    for (let r = 1; r <= 50; r++) await send(d, ev("rolled_back", r), x.c); // unsigned: unverified
    await x.done();
    expect(f).toHaveBeenCalledTimes(MAX_UNVERIFIED_ALERTS_PER_APP);
    // The same release number a forger already used, and new ones, still alert when verified.
    await sendRevertAlert(d, "tide", 1, "rolled_back", true);
    for (let r = 100; r < 100 + MAX_ALERTS_PER_APP - 1; r++) await sendRevertAlert(d, "tide", r, "crash_loop_revert", true);
    expect(f).toHaveBeenCalledTimes(MAX_UNVERIFIED_ALERTS_PER_APP + MAX_ALERTS_PER_APP);
  });
  it("a signed report through POST /t uses the verified slots", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const { d } = fakeDb("https://hooks.example.com/x"); const x = ctx();
    forceVerified = true; // stands in for a valid install signature
    const signed = (r: number) => send(d, { ...ev("rolled_back", r), install_id: "i1", sig: "0".repeat(64) }, x.c);
    for (let r = 1; r <= MAX_UNVERIFIED_ALERTS_PER_APP + 2; r++) await signed(r);
    await x.done();
    expect(f).toHaveBeenCalledTimes(MAX_UNVERIFIED_ALERTS_PER_APP + 2);
  });
  it("sends nothing without a webhook, or for events that are not reverts", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    const x = ctx();
    await send(fakeDb(null).d, ev("rolled_back"), x.c);
    await send(fakeDb("https://hooks.example.com/x").d, ev("applied"), x.c);
    await x.done();
    expect(f).not.toHaveBeenCalled();
  });
  it("a failing webhook does not fail telemetry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const x = ctx();
    expect((await send(fakeDb("https://hooks.example.com/x").d, ev("rolled_back"), x.c)).status).toBe(202);
    await expect(x.done()).resolves.toBeDefined();
  });
  it("works when there is no execution context", async () => {
    const f = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", f);
    expect((await send(fakeDb("https://hooks.example.com/x").d, ev("rolled_back"))).status).toBe(202);
    await new Promise((r) => setTimeout(r, 10));
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("set_alert_webhook owner command", () => {
  const content = JSON.stringify({ products: [] });
  const env = (f: ReturnType<typeof fakeDb>) => {
    const inner = f.d.prepare.bind(f.d);
    f.d.prepare = (sql: string) => sql.includes("content_draft") ? { bind: () => ({ first: async () => ({ json: content }) }) } : inner(sql);
    return { db: f.d, kv: {} as any, appId: "tide", actor: "owner" };
  };
  it("rejects http:// with a typed error and stores nothing", async () => {
    const f = fakeDb(null);
    const r: any = await runOwnerCommand(env(f), "set_alert_webhook", { url: "http://hooks.example.com/x" });
    expect(r.ok).toBe(false); expect(r.error.code).toBe("bad_webhook_url");
    expect(f.hook).toBeNull();
    const r2: any = await runOwnerCommand(env(f), "set_alert_webhook", { url: "not a url" });
    expect(r2.error.code).toBe("bad_webhook_url");
  });
  it("stores an https URL, returns only the host, and an empty url removes it", async () => {
    const f = fakeDb(null);
    const r: any = await runOwnerCommand(env(f), "set_alert_webhook", { url: "https://hooks.example.com/secret-token" });
    expect(r).toEqual({ ok: true, result: { alert_webhook: "hooks.example.com" } });
    expect(f.hook).toBe("https://hooks.example.com/secret-token");
    await runOwnerCommand(env(f), "set_alert_webhook", { url: "" });
    expect(f.hook).toBeNull();
  });
});
