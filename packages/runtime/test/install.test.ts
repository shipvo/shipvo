import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureInstallIdentity, signReport, webCrypto } from "../src/install";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe("install identity", () => {
  it("registers once, then reuses the stored identity", async () => {
    const storage = mem();
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ key: "k1" }) }));
    (globalThis as any).fetch = f;
    const a = await ensureInstallIdentity(storage, webCrypto, "https://cp.test/t/register");
    const b = await ensureInstallIdentity(storage, webCrypto, "https://cp.test/t/register");
    expect(f).toHaveBeenCalledTimes(1);
    expect(a?.key).toBe("k1");
    expect(b).toEqual(a);
    expect(a?.install_id).toMatch(/^[0-9a-f]{32}$/);
  });
  it("returns null and stores nothing when registration fails, then retries", async () => {
    const storage = mem();
    (globalThis as any).fetch = vi.fn(async () => { throw new Error("offline"); });
    expect(await ensureInstallIdentity(storage, webCrypto, "u")).toBeNull();
    expect(storage.m.size).toBe(0);
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false }));
    expect(await ensureInstallIdentity(storage, webCrypto, "u")).toBeNull();
  });
  it("matches the RFC 4231 test case 2 HMAC-SHA256 vector", async () => {
    const r = await signReport({ install_id: "i", key: "Jefe" }, "what do ya want for nothing?", webCrypto);
    expect(r).toEqual({ install_id: "i", sig: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843" });
  });
});

describe("signed send path", () => {
  beforeEach(() => { delete (globalThis as any).__native; });
  async function load(register: boolean) {
    vi.resetModules();
    const calls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (u: string, i: any) => {
      calls.push([u, i]);
      if (u.endsWith("/register")) { if (!register) throw new Error("offline"); return { ok: true, json: async () => ({ key: "sekret" }) }; }
      return { ok: true };
    });
    (globalThis as any).__native = {
      getState: () => ({ baseUrl: "https://cp.test", appId: "app1", runningRelease: 4 }),
      consumeEvents: () => ["rolled_back"], checkForUpdate: async () => ({ status: "none" }),
      markHealthy: () => ({ release: 4 }), rollback: () => {}, reload: () => {},
    };
    return { mod: await import("../src/index"), calls };
  }
  const storage = () => mem();
  it("adds install_id and a verifiable sig", async () => {
    const { mod, calls } = await load(true);
    await mod.enableSignedTelemetry({ storage: storage(), registerUrl: "https://cp.test/t/register" });
    mod.reportRuntimeEvents();
    await new Promise((r) => setTimeout(r, 20));
    const body: string = calls.find((c) => c[0] === "https://cp.test/t")[1].body;
    const parsed = JSON.parse(body);
    const m = body.match(/^(.*),"sig":"([0-9a-f]{64})"\}$/)!;
    expect(parsed.install_id).toMatch(/^[0-9a-f]{32}$/);
    expect(m[2]).toBe(createHmac("sha256", "sekret").update(m[1] + "}").digest("hex"));
  });
  it("sends unsigned when registration fails", async () => {
    const { mod, calls } = await load(false);
    expect(await mod.enableSignedTelemetry({ storage: storage(), registerUrl: "https://cp.test/t/register" })).toBeNull();
    mod.reportRuntimeEvents();
    const body = JSON.parse(calls.find((c) => c[0] === "https://cp.test/t")[1].body);
    expect(body.event).toBe("rolled_back");
    expect(body.sig).toBeUndefined();
  });
});
