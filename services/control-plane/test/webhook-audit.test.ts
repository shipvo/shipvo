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
    CREATE TABLE app_alerts (app_id PRIMARY KEY, webhook, updated_at);
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


const SECRET = "https://hooks.example.com/services/T0/B0/s3cr3t-token";

describe("set_alert_webhook audit and confirm", () => {
  it("audits a set and a remove with the host only", async () => {
    const { sql, env } = setup();
    expect((await runOwnerCommand(env(false), "set_alert_webhook", { url: SECRET })).ok).toBe(true);
    expect((await runOwnerCommand(env(false), "set_alert_webhook", { url: "" })).ok).toBe(true);
    const rows = sql.prepare("SELECT command, args_json FROM audit ORDER BY id").all();
    expect(rows.length).toBe(2);
    for (const r of rows) { expect(r.command).toBe("set_alert_webhook"); expect(r.args_json).not.toContain("s3cr3t"); expect(r.args_json).not.toContain("/services/"); }
    expect(rows[0].args_json).toContain("hooks.example.com");
  });
  it("agent without confirm gets needs_confirm and stores nothing", async () => {
    const { sql, env } = setup();
    const r = await runOwnerCommand(env(true), "set_alert_webhook", { url: SECRET });
    expect(r.code).toBe("needs_confirm");
    expect(JSON.stringify(r.plan)).not.toContain("s3cr3t");
    expect(sql.prepare("SELECT COUNT(*) AS n FROM app_alerts").get().n).toBe(0);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM audit").get().n).toBe(0);
    const ok = await runOwnerCommand(env(true), "set_alert_webhook", { url: SECRET, confirm: true });
    expect(ok.ok).toBe(true);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM app_alerts").get().n).toBe(1);
    expect(sql.prepare("SELECT args_json FROM audit").get().args_json).not.toContain("s3cr3t");
  });
});
