import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { encryptSecret } from "../src/vault-crypto";
import { useSecret, runnerSecrets, listUses } from "../src/vault-use";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY = "wk_live_SUPERSECRET0987654321";

async function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0021_vault.sql", "0024_vault_use.sql"]) sql.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const sealed = await encryptSecret(MASTER, { app: "tide", name: "WEATHER_KEY", domain: "api.weather.test" }, KEY);
  sql.prepare("INSERT INTO vault_secrets (owner, app_id, name, domain, access, wrapped_key, ciphertext, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("ana", "tide", "WEATHER_KEY", "api.weather.test", "read", sealed.wrapped_key, sealed.ciphertext, "2026-01-01");
  return { sql, env: { DB: db, VAULT_MASTER_KEY: MASTER } };
}
const q = { person: "ana", app: "tide", name: "WEATHER_KEY", host: "api.weather.test" };

describe("vault use at call time", () => {
  it("returns the value to the owner for the bound domain, and records the use", async () => {
    const { env, sql } = await setup();
    expect(await useSecret(env, q)).toEqual({ ok: true, value: KEY });
    const uses = await listUses(env, q);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ domain: "api.weather.test", outcome: "used" });
    expect(JSON.stringify(sql.prepare("SELECT * FROM vault_uses").all())).not.toContain(KEY);
    expect(sql.prepare("SELECT use_count FROM vault_secrets").get().use_count).toBe(1);
  });
  it("refuses another domain, subdomains and look-alikes, and logs the refusal", async () => {
    const { env } = await setup();
    for (const host of ["evil.test", "api.weather.test.evil.test", "x.api.weather.test", "weather.test"]) {
      expect(await useSecret(env, { ...q, host })).toEqual({ ok: false, reason: "domain" });
    }
    expect((await listUses(env, q)).every((u) => u.outcome === "domain_mismatch")).toBe(true);
  });
  it("refuses another person's key and another app's key as missing", async () => {
    const { env } = await setup();
    expect(await useSecret(env, { ...q, person: "bob" })).toEqual({ ok: false, reason: "missing" });
    expect(await useSecret(env, { ...q, app: "other" })).toEqual({ ok: false, reason: "missing" });
    expect(await listUses(env, { ...q, person: "bob" })).toEqual([]);
  });
  it("refuses a revoked key", async () => {
    const { env, sql } = await setup();
    sql.prepare("INSERT INTO vault_revoked VALUES (?,?,?)").run("tide", "WEATHER_KEY", "2026-02-01");
    expect(await useSecret(env, q)).toEqual({ ok: false, reason: "revoked" });
  });
  it("refuses a row whose domain was edited, and a missing master key", async () => {
    const { env, sql } = await setup();
    expect(await useSecret({ ...env, VAULT_MASTER_KEY: undefined }, q)).toEqual({ ok: false, reason: "unavailable" });
    sql.prepare("UPDATE vault_secrets SET domain = 'evil.test'").run();
    expect(await useSecret(env, { ...q, host: "evil.test" })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("runnerSecrets is bound to one person and app, and no result or log row holds the value on refusal", async () => {
    const { env, sql } = await setup();
    const mine = runnerSecrets(env, { person: "ana", app: "tide" });
    expect(await mine("WEATHER_KEY", "api.weather.test")).toBe(KEY);
    expect(await mine("WEATHER_KEY", "evil.test")).toEqual({ refused: "domain" });
    expect(await runnerSecrets(env, { person: "bob", app: "tide" })("WEATHER_KEY", "api.weather.test")).toEqual({ refused: "missing" });
    expect(JSON.stringify(sql.prepare("SELECT * FROM vault_uses").all())).not.toContain(KEY);
  });
});
