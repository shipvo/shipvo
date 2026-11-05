import { describe, it, expect, vi } from "vitest";
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

async function publish(band: string, policy: object | undefined, headers: Record<string, string> = {}) {
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
  const get = async (k: string) => (k === "c/tide/release_policy" && policy ? JSON.stringify(policy) : null);
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
  });
});
