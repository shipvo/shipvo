import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { encryptSecret } from "../src/vault-crypto";
import { dispatchSchedules } from "../src/dispatcher";
import { scheduleRunner } from "../src/runner";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY = "wk_live_SUPERSECRET0987654321";
const HEAVY = "{{ " + "[1,2,3,4,5,6,7,8,9,10].map(a, [1,2,3,4,5,6,7,8,9,10].map(b, [1,2,3,4,5,6,7,8,9,10].map(c, [1,2,3,4,5,6,7,8,9,10].map(d, a+b+c+d)))) " + "}}";

const spec = {
  spec: "v0", app: { id: "tide", name: "Tide" },
  permissions: { network: ["api.weather.test"] },
  data: { weather: { source: "http", get: "https://api.weather.test/forecast", auth: { secret: "WEATHER_KEY" }, select: "days", cache: "10m" } },
  screens: [{ id: "home", title: "Home", body: [{ type: "list", data: "weather", item: { title: "{{ item.day }}", subtitle: "{{ item.temp }}" } }] }],
  actions: {},
  schedules: [
    { id: "morning", cron: "0 8 * * *", do: [{ refresh: "weather" }, { return: "{{ weather }}" }] },
    { id: "heavy", cron: "0 8 * * *", do: [{ return: HEAVY }] },
  ],
};

async function setup() {
  const sql = new DatabaseSync(":memory:");
  for (const f of ["0021_vault.sql", "0022_app_schedules.sql", "0022_people_phone.sql", "0024_vault_use.sql", "0025_spec_runner.sql"]) sql.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
  const sealed = await encryptSecret(MASTER, { app: "tide", name: "WEATHER_KEY", domain: "api.weather.test" }, KEY);
  sql.prepare("INSERT INTO vault_secrets (owner, app_id, name, domain, access, wrapped_key, ciphertext, created_at) VALUES (?,?,?,?,?,?,?,?)").run("1", "tide", "WEATHER_KEY", "api.weather.test", "read", sealed.wrapped_key, sealed.ciphertext, "2026-01-01");
  sql.prepare("INSERT INTO phone_apps (person_id, app_id, installed_at) VALUES (1, 'tide', '2026-01-01')").run();
  const due = (name: string, at: string) => sql.prepare("INSERT INTO app_schedules (app, name, cron, next_run_at) VALUES ('tide', ?, '0 8 * * *', ?)").run(name, at);
  return { sql, due, env: { DB: db, VAULT_MASTER_KEY: MASTER } };
}
const upstream = { days: [{ day: "Mon", temp: 14, secretNote: "x", wind: 3 }, { day: "Tue", temp: 12, secretNote: "y", wind: 5 }], meta: { plan: "pro" } };
const now = new Date("2026-11-07T08:00:30.000Z");

describe("spec runner through the dispatcher", () => {
  it("runs a due schedule, injects the key, trims the result and keeps the key out of results and logs", async () => {
    const { env, sql, due } = await setup();
    due("morning", "2026-11-07T08:00:00.000Z");
    const seen: any[] = [];
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const fetch = async (url: string, init: any) => { seen.push({ url, headers: init.headers }); return { ok: true, status: 200, text: async () => JSON.stringify(upstream) }; };
    const run = scheduleRunner(env, { loadSpec: async () => spec, fetch });
    expect(await dispatchSchedules(env.DB, run, { now })).toBe(1);
    spy.mockRestore();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
    const stored = sql.prepare("SELECT result FROM app_run_results").get().result;
    expect(JSON.parse(stored)).toEqual([{ day: "Mon", temp: 14 }, { day: "Tue", temp: 12 }]);
    expect(stored).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
    expect(logs.length).toBeGreaterThan(0);
    expect(sql.prepare("SELECT last_status FROM app_schedules").get().last_status).toBe("ok");
  });

  it("fails an action over the CEL cost limit with a typed error, and other schedules still run", async () => {
    const { env, sql, due } = await setup();
    due("heavy", "2026-11-07T07:00:00.000Z");
    due("morning", "2026-11-07T08:00:00.000Z");
    const fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(upstream) });
    await dispatchSchedules(env.DB, scheduleRunner(env, { loadSpec: async () => spec, fetch }), { now });
    const status = (n: string) => sql.prepare("SELECT last_status FROM app_schedules WHERE name = ?").get(n).last_status;
    expect(status("heavy")).toMatch(/^error: cost_limit: /);
    expect(status("morning")).toBe("ok");
    expect(sql.prepare("SELECT COUNT(*) AS n FROM app_run_results WHERE name = 'morning'").get().n).toBe(1);
  });

  it("keeps a key sent in the URL query out of results and logs", async () => {
    const { env, sql, due } = await setup();
    due("morning", "2026-11-07T08:00:00.000Z");
    const qspec = { ...spec, data: { weather: { ...spec.data.weather, get: "https://api.weather.test/forecast-q", auth: { secret: "WEATHER_KEY", type: "query", name: "apikey" } } } };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const urls: string[] = [];
    const fetch = async (url: string) => { urls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(upstream) }; };
    await dispatchSchedules(env.DB, scheduleRunner(env, { loadSpec: async () => qspec, fetch }), { now });
    spy.mockRestore();
    expect(urls[0]).toContain(`apikey=${encodeURIComponent(KEY)}`);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain("apikey");
    expect(sql.prepare("SELECT result FROM app_run_results").get().result).not.toContain(KEY);
  });

  it("records a missing key for one person and still stores the result for another", async () => {
    const { env, sql, due } = await setup();
    sql.prepare("INSERT INTO phone_apps (person_id, app_id, installed_at) VALUES (2, 'tide', '2026-01-01')").run();
    due("morning", "2026-11-07T08:00:00.000Z");
    const fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(upstream) });
    await dispatchSchedules(env.DB, scheduleRunner(env, { loadSpec: async () => spec, fetch }), { now });
    expect(sql.prepare("SELECT last_status FROM app_schedules").get().last_status).toMatch(/^error: /);
    expect(sql.prepare("SELECT person FROM app_run_results").all().map((r: any) => r.person)).toEqual([1]);
  });
});
