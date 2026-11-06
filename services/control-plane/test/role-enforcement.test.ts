import { describe, it, expect } from "vitest";
import app from "../src/index";
import { forbidden } from "../src/roles";

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const KEY = "sv_publish_tide";

async function pointer(band: string, release: number) {
  const kp: any = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
  const pk = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");
  const body = JSON.stringify({ schema_version: "1.0", app_id: "tide", shell_major: 1, band, release, issued_at: "2026-01-01T00:00:00Z", core: { version: "1.0.0", sha256: "a".repeat(64), size: 1, url: "x" }, min_shell_version: "1.0.0" });
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" } as any, kp.privateKey, new TextEncoder().encode(body))).toString("base64");
  return { pk, body, buf: JSON.stringify({ body, signature: sig }) };
}

// role: undefined => column missing/null (admin).
function env(role: string | null | undefined, pk = "k", live?: { key: string; value: string }) {
  const store: Record<string, string> = live ? { [live.key]: live.value } : {};
  const DB = { prepare: (sql: string) => ({ bind: (...a: unknown[]) => ({
    run: async () => ({}),
    first: async () => {
      if (sql.includes("FROM publish_tokens")) return a[0] === (await sha(KEY)) ? { id: 1, expires_at: null, role: role ?? null } : null;
      if (sql.includes("FROM apps")) return { public_key: pk, bytes_used: 0 };
      return null;
    },
    all: async () => ({ results: [] }),
  }) }) } as any;
  const POINTERS = { get: async (k: string) => store[k] ?? null, put: async (k: string, v: any) => { store[k] = typeof v === "string" ? v : new TextDecoder().decode(v); }, delete: async () => {} };
  return { DB, POINTERS, store } as any;
}
const H = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function putPointer(role: string | null, band: string, release: number, liveRelease?: number) {
  const p = await pointer(band, release);
  const key = `p/tide/1/${band}`;
  const live = liveRelease === undefined ? undefined : { key, value: JSON.stringify({ body: JSON.stringify({ release: liveRelease }), signature: "x" }) };
  return app.request(`/apps/tide/kv/${key}`, { method: "PUT", headers: H, body: p.buf }, env(role, p.pk, live));
}
const putBlob = (role: string | null) => app.request("/apps/tide/kv/b/tide/x.bin", { method: "PUT", headers: H, body: "abc" }, env(role));
const get = (role: string | null, path: string, init: RequestInit = {}) => app.request(path, { headers: H, ...init }, env(role));

describe("role enforcement on publish-token routes", () => {
  it("a token without a role works as before", async () => {
    expect((await putBlob(null)).status).toBe(200);
    expect((await putPointer(null, "b2", 8, 9)).status).toBe(200);
    expect((await get(null, "/audit/tide")).status).toBe(200);
  });
  it("viewer: 403 on publish, promote, rollback, halt; 200 on summary and audit", async () => {
    const r = await putBlob("viewer");
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden", action: "publish", role: "viewer" });
    expect((await putPointer("viewer", "b0", 8)).status).toBe(403);
    const pr = await putPointer("viewer", "b1", 8);
    expect(pr.status).toBe(403);
    expect(await pr.json()).toEqual({ error: "forbidden", action: "promote", role: "viewer" });
    const rb = await putPointer("viewer", "b0", 5, 9);
    expect(await rb.json()).toEqual({ error: "forbidden", action: "rollback", role: "viewer" });
    const h = await get("viewer", "/app/tide/api/halt-config", { method: "PUT", body: JSON.stringify({ threshold: 0.2 }) });
    expect(h.status).toBe(403);
    expect(await h.json()).toEqual({ error: "forbidden", action: "halt", role: "viewer" });
    expect((await get("viewer", "/t/tide/summary")).status).toBe(200);
    expect((await get("viewer", "/audit/tide")).status).toBe(200);
  });
  it("developer can publish but not promote or roll back", async () => {
    expect((await putBlob("developer")).status).toBe(200);
    expect((await putPointer("developer", "b0", 8, 7)).status).toBe(200);
    expect((await putPointer("developer", "b1", 8)).status).toBe(403);
    expect((await putPointer("developer", "b0", 5, 9)).status).toBe(403);
  });
  it("release_manager can promote and roll back", async () => {
    expect((await putPointer("release_manager", "b2", 8, 7)).status).toBe(200);
    expect((await putPointer("release_manager", "b0", 5, 9)).status).toBe(200);
  });
  it("an unknown role gets 403 on everything", async () => {
    for (const r of [await putBlob("root"), await putPointer("root", "b0", 8), await get("root", "/audit/tide"), await get("root", "/t/tide/summary"), await get("root", "/app/tide/api/halt-config")]) {
      expect(r.status).toBe(403);
      expect(((await r.json()) as any).error).toBe("forbidden");
    }
  });
  it("forbidden() treats a missing role as admin", () => {
    expect(forbidden(null, "manage_tokens")).toBeNull();
    expect(forbidden("viewer", "halt")).toEqual({ error: "forbidden", action: "halt", role: "viewer" });
  });
});
