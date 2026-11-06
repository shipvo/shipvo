import { describe, it, expect } from "vitest";
import app from "../src/index";

// Cookie value the admin login would set: <app>.<exp>.<hmac>
async function cookie(pw: string, appId: string) {
  const exp = Date.now() + 3600_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pn_admin=${appId}.${exp}.${sig}`;
}
const challenge = { id: "c1", app_id: "tide", command: "publish", args_hash: "h", requester: "agent (owner token)", plan: ["x"], status: "pending",
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() };
function env() {
  const m: Record<string, string> = { "c/tide/challenge/c1": JSON.stringify(challenge) };
  const POINTERS = { get: async (k: string) => m[k] ?? null, put: async (k: string, v: string) => { m[k] = v; }, list: async () => ({ keys: Object.keys(m).map((name) => ({ name })), list_complete: true }) };
  const DB = { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) };
  return { m, e: { POINTERS, DB, OWNER_TOKEN: "owner-secret", ADMIN_PASSWORD: "pw" } as any };
}
const post = (e: any, headers: Record<string, string>, verb = "approve") => app.request("/app/tide/api/approvals/c1/" + verb, { method: "POST", headers }, e);

describe("approval routes", () => {
  it("the owner token (an agent) cannot approve or deny", async () => {
    const { m, e } = env();
    expect((await post(e, { authorization: "Bearer owner-secret" })).status).toBe(403);
    expect((await post(e, { authorization: "Bearer owner-secret" }, "deny")).status).toBe(403);
    expect(JSON.parse(m["c/tide/challenge/c1"]!).status).toBe("pending");
  });
  it("a publish token or no credentials cannot approve", async () => {
    const { e } = env();
    expect((await post(e, { authorization: "Bearer sv_publish_x" })).status).toBe(401);
    expect((await post(e, {})).status).toBe(401);
  });
  it("the signed-in admin approves, and it is bound to the challenge", async () => {
    const { m, e } = env();
    const r = await post(e, { cookie: await cookie("pw", "tide") });
    expect(r.status).toBe(200);
    expect(JSON.parse(m["c/tide/challenge/c1"]!)).toMatchObject({ status: "approved", approved_by: "owner (admin)", approved_how: "admin session", args_hash: "h" });
  });
  it("an unknown id answers 404 and an already decided one 409", async () => {
    const { e } = env();
    const ck = await cookie("pw", "tide");
    const gone = await app.request("/app/tide/api/approvals/nope/approve", { method: "POST", headers: { cookie: ck } }, e);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as any).error.code).toBe("approval_not_found");
    expect((await post(e, { cookie: ck })).status).toBe(200);
    const again = await post(e, { cookie: ck }, "deny");
    expect(again.status).toBe(409);
    expect(((await again.json()) as any).error.code).toBe("approval_not_pending");
  });
  it("the owner token can list pending approvals", async () => {
    const { e } = env();
    const r: any = await (await app.request("/app/tide/api/approvals", { headers: { authorization: "Bearer owner-secret" } }, e)).json();
    expect(r.approvals.map((a: any) => a.id)).toEqual(["c1"]);
  });
});
