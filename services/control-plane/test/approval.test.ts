import { describe, it, expect } from "vitest";
import app from "../src/index";
import { runOwnerCommand } from "../src/owner";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const PUB = "sv_publish_tide", ANN = "sv_login_ann", BOB = "sv_login_bob";

async function pointer(band: string) {
  const kp: any = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
  const pk = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
  const body = JSON.stringify({ schema_version: "1.0", app_id: "tide", shell_major: 1, band, release: 7, issued_at: "2026-01-01T00:00:00Z", core: { version: "1.0.0", sha256: "a".repeat(64), size: 1, url: "x" }, min_shell_version: "1.0.0" });
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" } as any, kp.privateKey, new TextEncoder().encode(body))).toString("base64");
  return { pk, buf: JSON.stringify({ body, signature: sig }) };
}

// One keypair per test so the registered key matches the signed pointer.
async function run(policy: object | undefined, band: string, headers: Record<string, string> = {}) {
  const state = { bytes: 0 };
  const p = await pointer(band);
  const store: Record<string, string> = {}, audits: any[][] = [];
  const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    run: async () => { if (sql.includes("INSERT INTO audit_log")) audits.push(args); return {}; },
    first: async () => {
      if (sql.includes("FROM publish_tokens")) return args[0] === (await sha(PUB)) ? { id: 1, expires_at: null } : null;
      if (sql.includes("JOIN accounts a ON a.id = k.account_id")) {
        if (args[0] === (await sha(ANN))) return { account_id: 1, expires_at: null, github_login: "ann" };
        if (args[0] === (await sha(BOB))) return { account_id: 2, expires_at: null, github_login: "bob" };
        return null;
      }
      if (sql.includes("JOIN accounts")) return { login: "ann" };
      if (sql.includes("FROM apps")) return { public_key: p.pk, bytes_used: state.bytes, account_id: 1 };
      return null;
    },
  }) }) } as any;
  const POINTERS = { put: async (k: string, v: unknown) => { store[k] = typeof v === "string" ? v : new TextDecoder().decode(v as ArrayBuffer); }, get: async (k: string) => (k === "c/tide/release_policy" && policy && !store[k] ? JSON.stringify(policy) : store[k] ?? null) } as any;
  const env = { DB, POINTERS, OWNER_TOKEN: "owner-secret" } as any;
  const r = await app.request(`/apps/tide/kv/p/tide/1/${band}`, { method: "PUT", headers: { authorization: `Bearer ${PUB}`, ...headers }, body: p.buf }, env);
  const act = (aid: string, verb: string, token: string) => app.request(`/apps/tide/approvals/${aid}/${verb}`, { method: "POST", headers: { authorization: `Bearer ${token}` } }, env);
  return { r, store, audits, act, state };
}
const PTR = "p/tide/1/b2";

describe("requireApprovalAbove", () => {
  it("policy off: promote goes live as before", async () => {
    const { r, store, audits } = await run(undefined, "b2");
    expect(r.status).toBe(200); expect(store[PTR]).toBeTruthy(); expect(audits).toHaveLength(1);
  });
  it("at or below the band: promote goes live", async () => {
    const { r, store } = await run({ requireApprovalAbove: "b1" }, "b1");
    expect(r.status).toBe(200); expect(store["p/tide/1/b1"]).toBeTruthy();
  });
  it("above the band: 202, pointer unchanged, one proposed audit row", async () => {
    const { r, store, audits } = await run({ requireApprovalAbove: "b1" }, "b2");
    expect(r.status).toBe(202);
    const j: any = await r.json(); expect(j.approval_id).toBeTruthy();
    expect(store[PTR]).toBeUndefined();
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]![8] as string)).toMatchObject({ approval: "proposed", approval_id: j.approval_id });
  });
  it("a different owner approves: promote applied, proposed and approved audit rows", async () => {
    const { r, store, audits, act } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    const a = await act(approval_id, "approve", "owner-secret");
    expect(a.status).toBe(200); expect(store[PTR]).toBeTruthy();
    expect(audits.map((x) => JSON.parse(x[8] as string).approval)).toEqual(["proposed", "approved"]);
    expect(audits[1]![2]).toBe("agent (owner token)");
    expect((await act(approval_id, "approve", "owner-secret")).status).toBe(409);
  });
  it("a stale proposal is refused with 409 and the newer pointer stays", async () => {
    const { r, store, act, audits } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    const newer = JSON.stringify({ body: JSON.stringify({ band: "b2", release: 8 }), signature: "x" });
    store[PTR] = newer;
    const a = await act(approval_id, "approve", "owner-secret");
    expect(a.status).toBe(409); expect(((await a.json()) as any).error).toBe("stale");
    expect(store[PTR]).toBe(newer);
    expect(audits.map((x) => JSON.parse(x[8] as string).approval)).toEqual(["proposed", "rejected"]);
    expect((await act(approval_id, "approve", "owner-secret")).status).toBe(409);
  });
  it("approve re-checks maxBand: a tightened policy refuses with 403 and the approval stays pending", async () => {
    const { r, store, audits, act } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    store["c/tide/release_policy"] = JSON.stringify({ requireApprovalAbove: "b1", maxBand: "b1" });
    const a = await act(approval_id, "approve", "owner-secret");
    expect(a.status).toBe(403); expect(((await a.json()) as any).error).toBe("policy_refused");
    expect(store[PTR]).toBeUndefined(); expect(audits).toHaveLength(1);
    store["c/tide/release_policy"] = JSON.stringify({ requireApprovalAbove: "b1" });
    expect((await act(approval_id, "approve", "owner-secret")).status).toBe(200);
  });
  it("approve checks the app storage budget", async () => {
    const { r, store, act, state } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    state.bytes = 500 * 1024 * 1024;
    const a = await act(approval_id, "approve", "owner-secret");
    expect(a.status).toBe(413); expect(store[PTR]).toBeUndefined();
  });
  it("set_release_policy keeps requireApprovalAbove", async () => {
    const m: Record<string, string> = { "c/tide/release_policy": JSON.stringify({ requireApprovalAbove: "b1" }) };
    const env: any = { kv: { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } }, appId: "tide", actor: "owner", isAgent: false, db: { prepare: () => ({ bind: () => ({ first: async () => ({ json: JSON.stringify({ x: 1 }) }), run: async () => ({}) }) }) } };
    const out: any = await runOwnerCommand(env, "set_release_policy", { maxBand: "b2" });
    expect(out).toMatchObject({ ok: true }); expect(out.result).toEqual({ maxBand: "b2", requireApprovalAbove: "b1" });
    expect(JSON.parse(m["c/tide/release_policy"]!)).toEqual({ maxBand: "b2", requireApprovalAbove: "b1" });
  });
  it("the proposer cannot approve", async () => {
    const { r, store, act } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    expect((await act(approval_id, "approve", ANN)).status).toBe(403);
    expect(store[PTR]).toBeUndefined();
  });
  it("a person who does not own the app is refused; no auth is refused", async () => {
    const { r, act } = await run({ requireApprovalAbove: "b1" }, "b2");
    const { approval_id } = (await r.json()) as any;
    expect((await act(approval_id, "approve", BOB)).status).toBe(401);
    expect((await act(approval_id, "approve", "nope")).status).toBe(401);
  });
  it("reject leaves the release unchanged and writes a rejected row", async () => {
    const { r, store, audits, act } = await run({ requireApprovalAbove: "b1" }, "b2", { "x-shipvo-actor": "agent" });
    const { approval_id } = (await r.json()) as any;
    expect((await act(approval_id, "reject", ANN)).status).toBe(200);
    expect(store[PTR]).toBeUndefined();
    expect(audits.map((x) => JSON.parse(x[8] as string).approval)).toEqual(["proposed", "rejected"]);
    expect((await act(approval_id, "approve", "owner-secret")).status).toBe(409);
  });
  it("an agent proposal can be approved by the signed-in owner", async () => {
    const { r, store, act } = await run({ requireApprovalAbove: "b1" }, "b2", { "x-shipvo-actor": "agent" });
    const { approval_id } = (await r.json()) as any;
    expect((await act(approval_id, "approve", ANN)).status).toBe(200); expect(store[PTR]).toBeTruthy();
  });
});
