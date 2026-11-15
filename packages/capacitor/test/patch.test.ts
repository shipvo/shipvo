import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { ShipvoCapacitor, MemoryStore, MemoryFiles, sha256Hex } from "../src/index.js";

const enc = new TextEncoder();
const vec = JSON.parse(readFileSync(new URL("../test-vectors/patch.json", import.meta.url), "utf8"));
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
let pair: CryptoKeyPair, pub: string;
beforeAll(async () => {
  pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  pub = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});

/** Files that patch like the Android plugin: it reports what it was asked and what happened. */
class PatchFiles extends MemoryFiles {
  calls: { base: string; name: string; size: number; sha256: string; patchSha256: string }[] = [];
  constructor(public result: { via: "patch" | "full"; patchError?: string }) { super(); }
  async patch(o: { base: string; patch: Uint8Array; patchSha256: string; name: string; size: number; sha256: string }) {
    this.calls.push(o);
    if (this.result.via === "patch") this.files.set(o.name, bytes(vec.new));
    return this.result;
  }
}

async function setup(fromSha: string, files: MemoryFiles) {
  const base = bytes(vec.base); const next = bytes(vec.new);
  const urls: string[] = [];
  const pointer = async (release: number, patches: unknown[]) => {
    const body = JSON.stringify({
      schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b2", kind: "web", release, issued_at: "2026-11-05T00:00:00Z",
      core: { version: "1.0.0", sha256: release === 1 ? await sha256Hex(base) : await sha256Hex(next), size: release === 1 ? base.length : next.length, url: `/b/${release}`, patches },
      min_shell_version: "1.0.0",
    });
    const sig = b64(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, enc.encode(body))));
    return { body, signature: sig };
  };
  let release = 1;
  const fetcher = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/p/")) return Response.json(await pointer(release, release === 1 ? [] : [{ from_sha256: fromSha, url: "/patch/2", size: bytes(vec.patch).length, sha256: vec.patchSha256 }]));
    return new Response(String(url).includes("/patch/") ? bytes(vec.patch) : release === 1 ? base : next);
  }) as unknown as typeof fetch;
  const c = new ShipvoCapacitor({ appId: "tide", shellMajor: 1, shellVersion: "1.0.0", platform: "android", publicKey: pub, baseUrl: "https://cp.test", store: new MemoryStore(), files, fetch: fetcher, random: () => 0.5 });
  // Release 1 becomes current.
  await c.checkForUpdate({ apply: false }); await c.boot(); await c.markHealthy();
  await c.markHealthy();
  release = 2; urls.length = 0;
  return { c, urls };
}

describe("rule 9 patch choice", () => {
  it("uses a matching patch and reports via: patch", async () => {
    const files = new PatchFiles({ via: "patch" });
    const { c, urls } = await setup(vec.baseSha256, files);
    await c.boot(); // marks release 1 running
    await c.markHealthy();
    const r = await c.checkForUpdate({ apply: false });
    expect(r).toMatchObject({ status: "staged", release: 2, via: "patch", bytes: bytes(vec.patch).length });
    expect(files.calls[0]).toMatchObject({ base: "release-1.bundle", name: "release-2.bundle", sha256: vec.newSha256, patchSha256: vec.patchSha256 });
    expect(urls.some((u) => u.includes("/b/2"))).toBe(false);
    expect(files.files.get("release-2.bundle")).toEqual(bytes(vec.new));
  });

  it("skips a patch whose from_sha256 is not the current bundle", async () => {
    const files = new PatchFiles({ via: "patch" });
    const { c } = await setup("a".repeat(64), files);
    await c.boot(); await c.markHealthy();
    const r = await c.checkForUpdate({ apply: false });
    expect(r).toMatchObject({ status: "staged", via: "full" });
    expect(files.calls).toEqual([]);
    expect(files.files.get("release-2.bundle")).toEqual(bytes(vec.new));
  });

  it.each(["patch hash mismatch", "patched bundle hash mismatch", "over_memory_budget", "out_of_memory"])("falls back to the full bundle on %s", async (patchError) => {
    const files = new PatchFiles({ via: "full", patchError });
    const { c } = await setup(vec.baseSha256, files);
    await c.boot(); await c.markHealthy();
    const r = await c.checkForUpdate({ apply: false });
    expect(r).toMatchObject({ status: "staged", via: "full", patchError });
    expect(files.files.get("release-2.bundle")).toEqual(bytes(vec.new));
  });
});
