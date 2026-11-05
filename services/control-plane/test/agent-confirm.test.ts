import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { AGENT_ACTOR, runOwnerCommand } from "../src/owner";

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
  const kv = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; } } as any;
  const env = (agent = true, local?: any) => ({ db, kv, appId: "tide", actor: agent ? AGENT_ACTOR : "owner (admin)", agent, local });
  return { sql, env };
}

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
      const ok = await runOwnerCommand(env(), name, { ...args, confirm: true });
      expect(ok.error?.code).not.toBe("needs_confirm"); expect(ok.error?.code).not.toBe("denied");
      expect(ok.ok).toBe(true);
      if (name === "revoke_api_key") expect(ok.result.revoked).toBe(true);
      const log = sql.prepare("SELECT actor, command, args_json FROM audit WHERE command = ?").all(name);
      expect(log).toHaveLength(1); expect(log[0].actor).toBe(AGENT_ACTOR); expect(log[0].args_json).toContain('"confirmed":true');
      const d = setup({ agentPolicy: "deny" });
      const no = await runOwnerCommand(d.env(), name, { ...args, confirm: true });
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
    expect((await runOwnerCommand(env(), "discard_draft", { confirm: true })).ok).toBe(true);
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
    expect((await runOwnerCommand(setup({ agentPolicy: "allow" }).env(true, { agentPolicy: "deny" }), "publish", { confirm: true })).error.code).toBe("denied");
    expect((await runOwnerCommand(setup().env(true, { agentPolicy: "allow" }), "publish", {})).code).toBe("needs_confirm");
    expect((await runOwnerCommand(setup().env(true, { agentDeny: ["set_theme"] }), "set_theme", {})).error.code).toBe("denied");
  });
  it("agents cannot change the policy; the admin can", async () => {
    const { env } = setup();
    expect((await runOwnerCommand(env(), "set_agent_policy", { agentPolicy: "allow" })).error.code).toBe("admin_only");
    expect((await runOwnerCommand(env(false), "set_agent_policy", { agentPolicy: "deny", agentDeny: "publish" })).ok).toBe(true);
    expect((await runOwnerCommand(env(), "get_agent_policy", {})).result).toEqual({ agentPolicy: "deny", agentDeny: ["publish"] });
  });
});
