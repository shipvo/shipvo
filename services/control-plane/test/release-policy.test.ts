import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import { AGENT_ACTOR, runOwnerCommand } from "../src/owner";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const KEY = "sv_publish_tide";

async function pointer(band: string) {
  const kp: any = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
  const pk = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
  const body = JSON.stringify({ schema_version: "1.0", app_id: "tide", shell_major: 1, band, release: 7, issued_at: "2026-01-01T00:00:00Z", core: { version: "1.0.0", sha256: "a".repeat(64), size: 1, url: "x" }, min_shell_version: "1.0.0" });
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" } as any, kp.privateKey, new TextEncoder().encode(body))).toString("base64");
  return { pk, buf: JSON.stringify({ body, signature: sig }) };
}

async function publish(band: string, policy: object | undefined, headers: Record<string, string> = {}, kvExtra: Record<string, string> = {}) {
  const { pk, buf } = await pointer(band);
  const audits: any[] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    run: async () => { if (sql.includes("INSERT INTO audit_log")) audits.push(args); return {}; },
    first: async () => {
      if (sql.includes("FROM publish_tokens")) return args[0] === (await sha(KEY)) ? { id: 1, expires_at: null } : null;
      if (sql.includes("JOIN accounts")) return { login: "ann" };
      if (sql.includes("FROM apps")) return { public_key: pk, bytes_used: 0 };
      return null;
    },
  }) }) } as any;
  const put = vi.fn(async () => {});
  const get = async (k: string) => (k === "c/tide/release_policy" && policy ? JSON.stringify(policy) : kvExtra[k] ?? null);
  const r = await app.request(`/apps/tide/kv/p/tide/1/${band}`, { method: "PUT", headers: { authorization: `Bearer ${KEY}`, ...headers }, body: buf }, { DB, POINTERS: { put, get } } as any);
  return { r, put, audits };
}

describe("publish enforces the stored release policy", () => {
  it("refuses b2 when maxBand is b1: typed 403, nothing written, one audit row", async () => {
    const { r, put, audits } = await publish("b2", { maxBand: "b1" });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "policy_refused", rule: "maxBand", reason: expect.stringContaining("b2") });
    expect(put).not.toHaveBeenCalled();
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]![8] as string)).toMatchObject({ refused: true, rule: "maxBand", band: "b2" });
  });
  it("allows b1 under maxBand b1", async () => {
    const { r, put } = await publish("b1", { maxBand: "b1" });
    expect(r.status).toBe(200); expect(put).toHaveBeenCalled();
  });
  it("refuses an agent beyond agentMaxBand; a human at the same band succeeds", async () => {
    const policy = { agentMaxBand: "b0" };
    const a = await publish("b1", policy, { "x-shipvo-actor": "agent" });
    expect(a.r.status).toBe(403);
    expect(await a.r.json()).toMatchObject({ code: "policy_refused", rule: "agentMaxBand" });
    expect(a.put).not.toHaveBeenCalled();
    expect(a.audits[0]![3]).toBe("agent");
    const h = await publish("b1", policy);
    expect(h.r.status).toBe(200); expect(h.put).toHaveBeenCalled();
  });
  it("changes nothing when no policy is stored", async () => {
    for (const headers of [{}, { "x-shipvo-actor": "agent" }]) {
      const { r, put } = await publish("b2", undefined, headers);
      expect(r.status).toBe(200); expect(put).toHaveBeenCalled();
    }
  });
});

const staged = (release: number, issued_at: string) => JSON.stringify({ body: JSON.stringify({ release, issued_at, band: "b0" }), signature: "x" });
const refusal = async (x: Awaited<ReturnType<typeof publish>>, rule: string, reason?: string) => {
  expect(x.r.status).toBe(403);
  expect(await x.r.json()).toMatchObject({ code: "policy_refused", rule, reason: expect.stringContaining(reason ?? "") });
  expect(x.put).not.toHaveBeenCalled();
  expect(x.audits).toHaveLength(1);
  expect(JSON.parse(x.audits[0]![8] as string)).toMatchObject({ refused: true, rule });
};

describe("publish enforces weekday and staging rules", () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
  it("blockedWeekdays refuses on a blocked UTC day when no timeZone is set", async () => {
    at("2026-11-05T09:00:00Z"); // Thursday
    await refusal(await publish("b0", { blockedWeekdays: ["thu"] }), "blockedWeekdays");
    const ok = await publish("b0", { blockedWeekdays: ["fri"] });
    expect(ok.r.status).toBe(200);
  });
  it("blockedAfterHour and timeZone decide the local day and hour", async () => {
    at("2026-11-05T15:00:00Z"); // Thu 15:00 UTC = Thu 16:00 Paris = Thu 07:00 Los Angeles = Fri 00:00 Tokyo
    const policy = { blockedWeekdays: ["thu"], blockedAfterHour: 16 };
    expect((await publish("b0", policy)).r.status).toBe(200); // UTC 15 < 16
    await refusal(await publish("b0", { ...policy, timeZone: "Europe/Paris" }), "blockedWeekdays");
    expect((await publish("b0", { ...policy, timeZone: "America/Los_Angeles" })).r.status).toBe(200);
    expect((await publish("b0", { ...policy, timeZone: "Asia/Tokyo" })).r.status).toBe(200);
  });
  const stage = { requireStageBeforeFull: { percent: 10, minHours: 24 } };
  it("requireStageBeforeFull refuses b2 for a release never staged, or staged too briefly", async () => {
    at("2026-11-05T12:00:00Z");
    await refusal(await publish("b2", stage), "requireStageBeforeFull");
    const young = await publish("b2", stage, {}, { "p/tide/1/b1": staged(7, "2026-11-05T00:00:00Z") });
    await refusal(young, "requireStageBeforeFull", "24 h");
    const other = await publish("b2", stage, {}, { "p/tide/1/b1": staged(6, "2026-11-01T00:00:00Z") });
    await refusal(other, "requireStageBeforeFull");
  });
  it("requireStageBeforeFull allows b2 after minHours at the stage, and never limits narrower bands", async () => {
    at("2026-11-05T12:00:00Z");
    const ok = await publish("b2", stage, {}, { "p/tide/1/b1": staged(7, "2026-11-04T11:00:00Z") });
    expect(ok.r.status).toBe(200); expect(ok.put).toHaveBeenCalled();
    expect((await publish("b1", stage)).r.status).toBe(200);
    // b0 is 1%, below the 10% stage, so it does not count
    await refusal(await publish("b2", stage, {}, { "p/tide/1/b0": staged(7, "2026-11-01T00:00:00Z") }), "requireStageBeforeFull");
  });
});

describe("release policy owner commands", () => {
  const mk = () => {
    const m: Record<string, string> = {};
    const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
    const audits: any[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...a: any[]) => ({
      first: async () => (sql.includes("content_draft") ? { json: JSON.stringify({ x: 1 }) } : null),
      run: async () => { if (sql.includes("INSERT INTO audit")) audits.push(a); return {}; },
    }) }) } as any;
    return { m, env: (agent: boolean) => ({ db, kv, appId: "tide", actor: agent ? AGENT_ACTOR : "owner (admin)", agent }), audits };
  };
  it("the owner sets and reads it; agents cannot set it", async () => {
    const { m, env } = mk();
    const denied = await runOwnerCommand(env(true), "set_release_policy", { maxBand: "b0" });
    expect(denied.error.code).toBe("admin_only"); expect(m["c/tide/release_policy"]).toBeUndefined();
    const set = await runOwnerCommand(env(false), "set_release_policy", { maxBand: "b1", agentMaxBand: "b0" });
    expect(set).toEqual({ ok: true, result: { maxBand: "b1", agentMaxBand: "b0" } });
    expect((await runOwnerCommand(env(true), "get_release_policy", {})).result).toEqual({ maxBand: "b1", agentMaxBand: "b0" });
    expect((await runOwnerCommand(env(false), "set_release_policy", { maxBand: "b9" })).error.code).toBe("bad_param");
    const rules = await runOwnerCommand(env(false), "set_release_policy", { blockedWeekdays: "fri, sat", blockedAfterHour: 12, timeZone: "Europe/Paris", stagePercent: 10, stageMinHours: 24 });
    expect(rules.result).toEqual({ blockedWeekdays: ["fri", "sat"], blockedAfterHour: 12, timeZone: "Europe/Paris", requireStageBeforeFull: { percent: 10, minHours: 24 } });
    expect((await runOwnerCommand(env(false), "set_release_policy", { timeZone: "Mars/Base" })).error.code).toBe("bad_param");
  });
});
