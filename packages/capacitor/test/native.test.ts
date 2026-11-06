import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { ShipvoCapacitor, NativeFiles, NativeStore, bootAndServe, sha256Hex, MAX_BOOTS } from "../src/index.js";
import type { ShipvoNativePlugin } from "../src/index.js";

/** A stand-in for the Android plugin: same methods, same checks (hash before serve), kept in memory. */
class FakeNative implements ShipvoNativePlugin {
  kv = new Map<string, string>(); files = new Map<string, string>(); serving?: string; served: string[] = [];
  async kvGet({ key }: { key: string }) { return { value: this.kv.get(key) }; }
  async kvSet({ key, value }: { key: string; value: string }) { this.kv.set(key, value); }
  async fileWrite({ name, data }: { name: string; data: string }) { this.files.set(name, data); }
  async fileRead({ name }: { name: string }) { const data = this.files.get(name); if (data === undefined) throw new Error("missing"); return { data }; }
  async fileRemove({ name }: { name: string }) { this.files.delete(name); }
  async fileList() { return { names: [...this.files.keys()].sort() }; }
  async fileClear() { this.files.clear(); this.serving = undefined; }
  async serve({ name, sha256 }: { name: string; sha256: string }) {
    const data = this.files.get(name);
    if (data === undefined || createHash("sha256").update(Buffer.from(data, "base64")).digest("hex") !== sha256) throw new Error("bundle hash does not match");
    this.serving = name; this.served.push(name);
  }
  async status() { return { serving: this.serving }; }
  /** A process restart: the web view starts on the embedded bundle again; stored data stays. */
  restart() { this.serving = undefined; }
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
let pair: CryptoKeyPair, pub: string;
beforeAll(async () => {
  pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  pub = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});

async function server(release: number) {
  const bytes = enc.encode(`zip of release ${release}`);
  const body = JSON.stringify({
    schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b2", kind: "web", release, issued_at: "2026-11-05T00:00:00Z",
    core: { version: "1.0.0", sha256: await sha256Hex(bytes), size: bytes.byteLength, url: `/b/${release}` }, min_shell_version: "1.0.0",
  });
  const sig = b64(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, enc.encode(body))));
  return (async (url: string) => String(url).includes("/p/") ? Response.json({ body, signature: sig }) : new Response(bytes)) as unknown as typeof fetch;
}

const core = (n: FakeNative, f: typeof fetch, now: () => number) => new ShipvoCapacitor({
  appId: "tide", shellMajor: 1, shellVersion: "1.0.0", platform: "android", publicKey: pub, baseUrl: "https://cp.test",
  store: new NativeStore(n), files: new NativeFiles(n), fetch: f, random: () => 0.5, now,
});

describe("native bridge", () => {
  it("writes, stages, applies, then rolls back after a crash loop on boot", async () => {
    const n = new FakeNative(); let t = 1_000_000; const now = () => t;
    // Release 1 becomes current.
    let sc = core(n, await server(1), now);
    expect(await bootAndServe(sc, n)).toEqual({ release: 0, served: false });
    expect((await sc.checkForUpdate({ apply: true })).status).toBe("staged");
    n.restart(); sc = core(n, await server(1), now);
    expect(await bootAndServe(sc, n)).toEqual({ release: 1, served: true });
    expect(n.served).toEqual(["release-1.bundle"]);
    // The page of the served bundle starts the core again; it resumes and marks healthy.
    sc = core(n, await server(1), now);
    expect(await bootAndServe(sc, n)).toEqual({ release: 1, served: true });
    expect((await sc.markHealthy()).promoted).toBe(true);
    expect((await sc.getState()).currentRelease).toBe(1);
    // Release 2 is staged and applied, but never becomes healthy.
    await sc.checkForUpdate({ apply: false });
    sc = core(n, await server(2), now);
    expect((await sc.checkForUpdate({ apply: true })).release).toBe(2);
    for (let i = 0; i < MAX_BOOTS; i++) {
      n.restart(); t += 1000; sc = core(n, await server(2), now);
      expect(await bootAndServe(sc, n)).toEqual({ release: 2, served: true });
    }
    // The next launch rolls back to release 1; release 2 is deleted and blocked.
    n.restart(); sc = core(n, await server(2), now);
    expect(await bootAndServe(sc, n)).toEqual({ release: 1, served: true });
    expect(n.files.has("release-2.bundle")).toBe(false);
    const st = await sc.getState();
    expect(st).toMatchObject({ currentRelease: 1, pendingRelease: 0, blockedRelease: 2 });
    expect((await sc.consumeEvents()).events).toContain("crash_loop_revert");
  });

  it("never serves a file whose bytes changed after staging", async () => {
    const n = new FakeNative(); const now = () => 5;
    let sc = core(n, await server(1), now);
    await sc.checkForUpdate({ apply: false });
    n.files.set("release-1.bundle", b64(enc.encode("tampered")));
    n.restart(); sc = core(n, await server(1), now);
    const r = await bootAndServe(sc, n);
    expect(r).toMatchObject({ release: 1, served: false, error: "bundle hash does not match" });
    expect(n.served).toEqual([]);
  });

  it("lists and reads back stored files", async () => {
    const n = new FakeNative(); const f = new NativeFiles(n);
    await f.write("release-3.bundle", new Uint8Array([0, 255, 7]));
    expect(await f.list()).toEqual(["release-3.bundle"]);
    expect([...(await f.read("release-3.bundle"))]).toEqual([0, 255, 7]);
  });
});
