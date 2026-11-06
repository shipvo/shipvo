import { describe, expect, it } from "vitest";
import { ensureInstallIdentity, signReport } from "../src/telemetry";

const mem = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } }; };

describe("signed telemetry", () => {
  it("registers once and reuses the stored identity", async () => {
    const storage = mem(); let calls = 0; let sent: any;
    const fetch = (async (_u: string, init: any) => { calls++; sent = JSON.parse(init.body); return new Response(JSON.stringify({ install_token: "tok" }), { status: 200 }); }) as any;
    const a = await ensureInstallIdentity({ baseUrl: "https://c.example/", appId: "tide", shellVersion: "1.0.0", storage, fetch });
    const b = await ensureInstallIdentity({ baseUrl: "https://c.example/", appId: "tide", shellVersion: "1.0.0", storage, fetch });
    expect(calls).toBe(1);
    expect(b).toEqual(a);
    expect(sent.install_id).toMatch(/^[0-9a-f]{32}$/);
    expect(sent.install_key).toMatch(/^[0-9a-f]{64}$/);
  });
  it("returns null when registration fails", async () => {
    const fetch = (async () => new Response("no", { status: 429 })) as any;
    expect(await ensureInstallIdentity({ baseUrl: "https://c.example", appId: "tide", shellVersion: "1.0.0", storage: mem(), fetch })).toBeNull();
  });
  it("signs a report without sending the key", async () => {
    const id = { install_id: "a".repeat(32), install_key: "b".repeat(64), install_token: "tok", shell_version: "1.0.0" };
    const r = await signReport(id, { schema_version: "1.0", app_id: "tide", release: 3, event: "applied" });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain(id.install_key);
    expect(r.install_token).toBe("tok");
  });
});
