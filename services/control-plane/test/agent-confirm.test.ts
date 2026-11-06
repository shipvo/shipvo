import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { AGENT_ACTOR, listChallenges, resolveChallenge, runOwnerCommand } from "../src/owner";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const content = () => ({
  schema_version: "1.0", app_id: "tide", version: 1, published_at: "2026-11-01T00:00:00Z",
  brand: { name: "Tide", tagline: "" }, theme: { accent: "#112233" }, departments: [{ id: "d", name: "D" }],
  products: [{ id: "rod", name: "Rod", department: "d", price: 1000, stock: 5, water: "both", tags: [], description: "" }],
  promos: [{ code: "SAVE10", percent: 10, min_subtotal: 0, description: "ten off", active: true }], slots: [],
  screens: { home: [{ id: "t1", type: "text", text: "hello", role: "body" }] },
});

function setup(policy?: object) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE content_versions (app_id, version INTEGER, json, published_at, published_by, note);
    CREATE TABLE content_draft (app_id PRIMARY KEY, json, updated_at);
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, at, actor, command, args_json, ok);
    CREATE TABLE telemetry (app_id, event);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id, key_hash, prefix, scope, label, expires_at, revoked_at);`);
  for (let i = 0; i < 3; i++) sql.prepare("INSERT INTO telemetry VALUES ('tide','applied')").run();
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const m: Record<string, string> = { "c/tide/content.json": JSON.stringify(content()) };
  if (policy) m["c/tide/agent_policy"] = JSON.stringify(policy);
  const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; },
    list: async ({ prefix }: any) => ({ keys: Object.keys(m).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) } as any;
  const env = (agent = true, local?: any) => ({ db, kv, appId: "tide", actor: agent ? AGENT_ACTOR : "owner (admin)", agent, local });
  return { sql, env, m };
}
/** Owner approves a challenge in the admin, the way the HTTP route does. */
const approve = (e: any, id: string) => resolveChallenge({ ...e(false) }, id, "approve", "owner (admin)");

// Each irreversible command with arguments that would really change something.
const CASES: [string, Record<string, unknown>][] = [
  ["publish", { note: "x" }],
  ["update_product", { product_id: "rod", price: 1500 }],
  ["remove_product", { product_id: "rod" }],
  ["upsert_promo", { code: "SAVE10", percent: 50, description: "half" }],
  ["set_promo_active", { code: "SAVE10", active: false }],
  ["remove_home_block", { block_id: "t1" }],
  ["create_api_key", { scope: "owner" }],
  ["revoke_api_key", { prefix: "sv_test_abc1" }],
];

describe("agent confirm gate", () => {
  for (const [name, args] of CASES) {
    it(`${name}: needs_confirm, runs with confirm, refused under deny`, async () => {
      const { sql, env } = setup();
      if (name === "revoke_api_key") sql.prepare("INSERT INTO api_keys (app_id, key_hash, prefix, scope, label) VALUES ('tide','h','sv_test_abc1','test','')").run();
      const before = JSON.stringify(sql.prepare("SELECT * FROM content_versions").all());
      const r = await runOwnerCommand(env(), name, args);
      expect(r.ok).toBe(false); expect(r.code).toBe("needs_confirm"); expect(r.plan.length).toBeGreaterThan(0);
      expect(JSON.stringify(sql.prepare("SELECT * FROM content_versions").all())).toBe(before);
      expect(sql.prepare("SELECT COUNT(*) AS n FROM content_draft").get().n).toBe(0); // nothing written
      expect(sql.prepare("SELECT COUNT(*) AS n FROM audit").get().n).toBe(0); // needs_confirm writes no audit row
      const still = await runOwnerCommand(env(), name, { ...args, confirm: true });
      expect(still.code).toBe("needs_confirm"); // confirm: true alone is not enough
      expect(r.challenge.command).toBe(name); expect(r.challenge.approval_url).toContain(r.challenge.id);
      expect((await approve(env, r.challenge.id)).ok).toBe(true);
      const ok = await runOwnerCommand(env(), name, { ...args, approval: r.challenge.id });
      expect(ok.error?.code).not.toBe("needs_confirm"); expect(ok.error?.code).not.toBe("denied");
      expect(ok.ok).toBe(true);
      if (name === "revoke_api_key") expect(ok.result.revoked).toBe(true);
      const log = sql.prepare("SELECT actor, command, args_json FROM audit WHERE command = ?").all(name);
      expect(log).toHaveLength(1); expect(log[0].actor).toBe(AGENT_ACTOR); expect(log[0].args_json).not.toContain("confirmed"); expect(log[0].args_json).toContain('"approved_by":"owner (admin)"'); expect(log[0].args_json).toContain(`"approval_id":"${r.challenge.id}"`); expect(log[0].args_json).toContain('"approved_how":"admin session"');
      const d = setup({ agentPolicy: "deny" });
      const no = await runOwnerCommand(d.env(), name, { ...args, approval: "x" });
      expect(no.ok).toBe(false); expect(no.error.code).toBe("denied");
      const row = d.sql.prepare("SELECT args_json, ok FROM audit WHERE command = ?").get(name);
      expect(row.args_json).not.toContain("confirmed"); expect(row.args_json).toContain('"denied":true'); expect(row.ok).toBe(0);
      const a = setup({ agentPolicy: "allow" });
      const run = await runOwnerCommand(a.env(), name, args);
      expect(run.ok).toBe(true);
      expect(a.sql.prepare("SELECT args_json FROM audit WHERE command = ?").get(name).args_json).not.toContain("confirmed");
    });
  }

  it("set_agent_policy is audited with the admin as actor", async () => {
    const { sql, env } = setup();
    const r = await runOwnerCommand(env(false), "set_agent_policy", { agentPolicy: "allow" });
    expect(r.ok).toBe(true);
    const row = sql.prepare("SELECT actor FROM audit WHERE command = 'set_agent_policy'").get();
    expect(row.actor).toBe("owner (admin)");
  });
  it("publish plan says how many update reports it has, not phones", async () => {
    const r = await runOwnerCommand(setup().env(), "publish", {});
    expect(r.plan.join(" ")).toContain("3 update reports received so far (the number of phones is not known)");
  });
  it("discard_draft is gated when the draft has changes", async () => {
    const { env } = setup();
    await runOwnerCommand(env(), "set_theme", { accent: "#abcdef" });
    const r = await runOwnerCommand(env(), "discard_draft", {});
    expect(r.code).toBe("needs_confirm");
    expect((await runOwnerCommand(env(), "discard_draft", { approval: r.challenge.id })).error.code).toBe("approval_pending");
    await approve(env, r.challenge.id);
    expect((await runOwnerCommand(env(), "discard_draft", { approval: r.challenge.id })).ok).toBe(true);
  });
  it("harmless calls run without confirm: same price, reversible edits, reads", async () => {
    const { env } = setup();
    expect((await runOwnerCommand(env(), "update_product", { product_id: "rod", stock: 9 })).ok).toBe(true);
    expect((await runOwnerCommand(env(), "update_product", { product_id: "rod", price: 1000 })).ok).toBe(true);
    expect((await runOwnerCommand(env(), "list_products", {})).ok).toBe(true);
  });
  it("the admin signed in at the keyboard is not gated", async () => {
    expect((await runOwnerCommand(setup().env(false), "remove_product", { product_id: "rod" })).ok).toBe(true);
  });
  it("allow runs without confirm, but only when the owner set it", async () => {
    expect((await runOwnerCommand(setup({ agentPolicy: "allow" }).env(), "publish", {})).ok).toBe(true);
    expect((await runOwnerCommand(setup({ agentPolicy: "nonsense" }).env(), "publish", {})).code).toBe("needs_confirm");
  });
  it("the deny list blocks any command, confirm or not", async () => {
    const r = await runOwnerCommand(setup({ agentPolicy: "allow", agentDeny: ["set_theme"] }).env(), "set_theme", { accent: "#abcdef" });
    expect(r.error.code).toBe("denied");
  });
  it("a stricter policy from the caller's shipvo.json wins; a looser one does not", async () => {
    expect((await runOwnerCommand(setup({ agentPolicy: "allow" }).env(true, { agentPolicy: "deny" }), "publish", { approval: "x" })).error.code).toBe("denied");
    expect((await runOwnerCommand(setup().env(true, { agentPolicy: "allow" }), "publish", {})).code).toBe("needs_confirm");
    expect((await runOwnerCommand(setup().env(true, { agentDeny: ["set_theme"] }), "set_theme", {})).error.code).toBe("denied");
  });
  it("agents cannot change the policy; the admin can", async () => {
    const { env } = setup();
    expect((await runOwnerCommand(env(), "set_agent_policy", { agentPolicy: "allow" })).error.code).toBe("admin_only");
    expect((await runOwnerCommand(env(false), "set_agent_policy", { agentPolicy: "deny", agentDeny: "publish" })).ok).toBe(true);
    expect((await runOwnerCommand(env(), "get_agent_policy", {})).result).toEqual({ agentPolicy: "deny", agentDeny: ["publish"] });
  });

  describe("one-time challenges", () => {
    const start = async (t = setup(), args: any = { code: "SAVE10", active: false }) => ({ t, r: await runOwnerCommand(t.env(), "set_promo_active", args), args });
    it("a used challenge cannot be replayed", async () => {
      const { t, r, args } = await start(); await approve(t.env, r.challenge.id);
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: r.challenge.id })).ok).toBe(true);
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: r.challenge.id })).error.code).toBe("approval_used");
    });
    it("changing the arguments after approval is refused", async () => {
      const t = setup(); const r = await runOwnerCommand(t.env(), "update_product", { product_id: "rod", price: 1500 }); await approve(t.env, r.challenge.id);
      const bad = await runOwnerCommand(t.env(), "update_product", { product_id: "rod", price: 1 , approval: r.challenge.id });
      expect(bad.error.code).toBe("approval_mismatch");
      const other = await runOwnerCommand(t.env(), "set_promo_active", { code: "SAVE10", active: false, approval: r.challenge.id });
      expect(other.error.code).toBe("approval_mismatch");
      expect(t.sql.prepare("SELECT COUNT(*) AS n FROM content_draft").get().n).toBe(0);
      expect((await runOwnerCommand(t.env(), "update_product", { price: 1500, product_id: "rod", approval: r.challenge.id })).ok).toBe(true); // key order does not matter
    });
    it("an expired challenge fails", async () => {
      const { t, r, args } = await start(); await approve(t.env, r.challenge.id);
      const k = `c/tide/challenge/${r.challenge.id}`; t.m[k] = JSON.stringify({ ...JSON.parse(t.m[k]!), expires_at: new Date(Date.now() - 1000).toISOString() });
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: r.challenge.id })).error.code).toBe("approval_expired");
      expect((await approve(t.env, r.challenge.id) as any).error.code).toBe("approval_not_pending");
    });
    it("a challenge expires after 10 minutes", async () => {
      const { r } = await start(); expect(Date.parse(r.challenge.expires_at) - Date.now()).toBeGreaterThan(9.9 * 60_000); expect(Date.parse(r.challenge.expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    });
    it("a denied challenge fails with a clear code", async () => {
      const { t, r, args } = await start();
      expect((await resolveChallenge(t.env(false), r.challenge.id, "deny", "owner (admin)")).ok).toBe(true);
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: r.challenge.id })).error.code).toBe("approval_denied");
    });
    it("an unapproved or unknown challenge does not run", async () => {
      const { t, r, args } = await start();
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: r.challenge.id })).error.code).toBe("approval_pending");
      expect((await runOwnerCommand(t.env(), "set_promo_active", { ...args, approval: "nope" })).error.code).toBe("approval_not_found");
    });
    it("pending challenges are listed", async () => {
      const { t, r } = await start();
      expect((await listChallenges({ kv: t.env().kv, appId: "tide" })).map((c) => c.id)).toEqual([r.challenge.id]);
      await approve(t.env, r.challenge.id);
      expect(await listChallenges({ kv: t.env().kv, appId: "tide" })).toEqual([]);
    });
    it("approvals are audited", async () => {
      const { t, r } = await start(); await approve(t.env, r.challenge.id);
      const row = t.sql.prepare("SELECT actor, args_json FROM audit WHERE command = 'approval'").get();
      expect(row.actor).toBe("owner (admin)"); expect(row.args_json).toContain('"approval":"approved"');
    });
  });
});
