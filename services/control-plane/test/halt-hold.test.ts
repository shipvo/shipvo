import { describe, it, expect } from "vitest";
import app from "../src/index";

async function cookie(pw: string, appId: string) {
  const exp = Date.now() + 3600_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pn_admin=${appId}.${exp}.${sig}`;
}
// 20 installs, 6 failed. `age` is how long ago the failing installs registered.
function setup(ageMs: number, rates = { recent: 0, earlier: 0 }) {
  const store: Record<string, string> = { "halt-config/tide": JSON.stringify({ threshold: 0.2, min_reports: 20 }) };
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: string) => { store[k] = v; },
    list: async () => ({ keys: Object.keys(store).map((name) => ({ name })), list_complete: true }) } as any;
  const created = new Date(Date.now() - ageMs).toISOString();
  const DB = { prepare: (sql: string) => ({ bind: () => ({
    run: async () => ({}),
    all: async () => ({ results: sql.includes("GROUP BY t.install_id") ? Array.from({ length: 20 }, (_, i) => ({ install_id: "i" + i, net_hash: "n" + (i % 3), created_at: created, failed: i < 6 ? 1 : 0, healthy: i < 6 ? 0 : 1 })) : [rates] }),
  }) }) } as any;
  return { env: { POINTERS, DB, ADMIN_PASSWORD: "pw", OWNER_TOKEN: "tok" } as any, store };
}
const fail = (env: any) => app.request("/t", { method: "POST", body: JSON.stringify({ schema_version: "1.0", app_id: "tide", release: 5, event: "rolled_back" }) }, env);
const pending = (s: ReturnType<typeof setup>) => Object.entries(s.store).filter(([k]) => k.startsWith("c/tide/challenge/")).map(([, v]) => JSON.parse(v));
const decide = async (s: ReturnType<typeof setup>, verb: string) => app.request(`/app/tide/api/approvals/${pending(s)[0].id}/${verb}`, { method: "POST", headers: { cookie: await cookie("pw", "tide") } }, s.env);

describe("held release on suspected attack", () => {
  it("holds a burst of fresh-install failures and lists an approval", async () => {
    const s = setup(60_000);
    expect((await fail(s.env)).status).toBe(202);
    expect(s.store["halt/tide"]).toBeUndefined();
    expect(pending(s)).toHaveLength(1);
    expect(pending(s)[0]).toMatchObject({ command: "halt_release", release: 5, status: "pending" });
    await fail(s.env);
    expect(pending(s)).toHaveLength(1);
    const list = await app.request("/app/tide/api/approvals", { headers: { authorization: "Bearer tok" } }, s.env);
    expect(((await list.json()) as any).approvals).toHaveLength(1);
  });
  it("owner confirm halts the release", async () => {
    const s = setup(60_000);
    await fail(s.env);
    expect((await decide(s, "approve")).status).toBe(200);
    expect(JSON.parse(s.store["halt/tide"]!)).toMatchObject({ release: 5 });
  });
  it("owner dismiss clears the hold without halting", async () => {
    const s = setup(60_000);
    await fail(s.env);
    expect((await decide(s, "deny")).status).toBe(200);
    expect(s.store["halt/tide"]).toBeUndefined();
    const list = await app.request("/app/tide/api/approvals", { headers: { authorization: "Bearer tok" } }, s.env);
    expect(((await list.json()) as any).approvals).toHaveLength(0);
  });
  it("a dismissed hold is not raised again by later failures", async () => {
    const s = setup(60_000);
    await fail(s.env);
    expect((await decide(s, "deny")).status).toBe(200);
    await fail(s.env);
    expect(pending(s).filter((c) => c.status === "pending")).toHaveLength(0);
    expect(s.store["halt/tide"]).toBeUndefined();
  });
  it("an unanswered hold that expired is raised again", async () => {
    const s = setup(60_000);
    await fail(s.env);
    const [k, v] = Object.entries(s.store).find(([key]) => key.startsWith("c/tide/challenge/"))!;
    s.store[k] = JSON.stringify({ ...JSON.parse(v), expires_at: new Date(Date.now() - 1000).toISOString() });
    await fail(s.env);
    expect(pending(s).filter((c) => c.status === "pending" && Date.parse(c.expires_at) > Date.now())).toHaveLength(1);
  });
  it("a burst of failures from established installs is held, not halted", async () => {
    const s = setup(30 * 3600_000, { recent: 50, earlier: 144 });
    await fail(s.env);
    expect(s.store["halt/tide"]).toBeUndefined();
    expect(pending(s)).toHaveLength(1);
    expect(pending(s)[0].plan[0]).toContain("far above the normal rate");
  });
  it("established-install failures still halt", async () => {
    const s = setup(30 * 3600_000);
    await fail(s.env);
    expect(JSON.parse(s.store["halt/tide"]!).release).toBe(5);
    expect(pending(s)).toHaveLength(0);
  });
});
