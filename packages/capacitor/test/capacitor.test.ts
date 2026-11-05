import { describe, it, expect, beforeAll } from "vitest";
import { ShipvoCapacitor, MemoryFiles, MemoryStore, sha256Hex, semverLess, MAX_BOOTS, WINDOW_MS } from "../src/index.js";

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
let pair: CryptoKeyPair, other: CryptoKeyPair, pub: string;
beforeAll(async () => {
  pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  other = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  pub = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
});

const BASE = "https://cp.test";
const bundle = (n: number) => enc.encode(`web bundle ${n}`);

async function pointer(release: number, over: Record<string, unknown> = {}, opts: { key?: CryptoKeyPair; bytes?: Uint8Array } = {}) {
  const bytes = opts.bytes ?? bundle(release);
  const body = JSON.stringify({
    schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b2", kind: "web", release,
    issued_at: "2026-11-05T00:00:00Z",
    core: { version: "1.0.0", sha256: await sha256Hex(bundle(release)), size: bundle(release).byteLength, url: `/b/${release}` },
    min_shell_version: "1.0.0", ...over,
  });
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", (opts.key ?? pair).privateKey, enc.encode(body)));
  return { env: { body, signature: b64(sig) }, bytes };
}

type Served = { env: unknown; bytes: Uint8Array } | undefined;
function setup(served: () => Served, o: { shell?: string; platform?: "android" | "ios"; store?: MemoryStore; files?: MemoryFiles; now?: () => number } = {}) {
  const store = o.store ?? new MemoryStore(), files = o.files ?? new MemoryFiles(); let reloads = 0;
  const f = (async (url: string) => {
    const s = served();
    if (!s) return new Response("no", { status: 404 });
    if (String(url).includes("/p/")) return Response.json(s.env);
    return new Response(s.bytes);
  }) as unknown as typeof fetch;
  const sc = new ShipvoCapacitor({
    appId: "tide", shellMajor: 1, shellVersion: o.shell ?? "1.2.0", platform: o.platform ?? "android", publicKey: pub,
    baseUrl: BASE, store, files, fetch: f, random: () => 0.5, now: o.now, onReload: () => { reloads++; },
  });
  return { sc, store, files, reloads: () => reloads, again: (now?: () => number): ReturnType<typeof setup> => setup(served, { ...o, store, files, now: now ?? o.now }) };
}
const stage = async (t: ReturnType<typeof setup>, release: number, cur: { v: Served }) => {
  cur.v = await pointer(release); return t.sc.checkForUpdate({ apply: false });
};

describe("verification", () => {
  it("stages a good signed bundle", async () => {
    const cur = { v: await pointer(1) }; const t = setup(() => cur.v);
    const r = await t.sc.checkForUpdate({ apply: true });
    expect(r).toMatchObject({ status: "staged", release: 1 });
    expect((await t.sc.getState()).pendingRelease).toBe(1);
    expect(t.files.files.has("release-1.bundle")).toBe(true);
    expect(t.reloads()).toBe(1);
  });
  it("refuses a forged signature", async () => {
    const cur = { v: await pointer(1, {}, { key: other }) }; const t = setup(() => cur.v);
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
    expect((await t.sc.getState()).pendingRelease).toBe(0);
    expect((await t.sc.consumeEvents()).events).toEqual(["verify_failed"]);
  });
  it("refuses a body changed after signing", async () => {
    const p = await pointer(1); const env = { ...p.env, body: p.env.body.replace('"release":1', '"release":9') };
    const t = setup(() => ({ env, bytes: p.bytes }));
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
    expect((await t.sc.getState()).pendingRelease).toBe(0);
  });
  it("refuses a wrong sha-256, blocks the release and queues verify_failed", async () => {
    const cur = { v: await pointer(1, {}, { bytes: enc.encode("web bundle X") }) }; // same length as "web bundle 1"
    const t = setup(() => cur.v);
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
    const st = await t.sc.getState();
    expect(st.pendingRelease).toBe(0); expect(st.blockedRelease).toBe(1);
    expect(t.files.files.size).toBe(0);
    expect((await t.sc.consumeEvents()).events).toEqual(["verify_failed"]);
  });
  it("refuses a wrong size", async () => {
    const cur = { v: await pointer(1, {}, { bytes: enc.encode("short") }) }; const t = setup(() => cur.v);
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
    expect((await t.sc.getState()).pendingRelease).toBe(0);
  });
});

describe("release decisions", () => {
  it("rule 1: platform must match, and kind must be web", async () => {
    let cur = { v: await pointer(1, { platform: "ios" }) };
    expect((await setup(() => cur.v).sc.checkForUpdate({ apply: false })).status).toBe("error");
    expect((await setup(() => cur.v, { platform: "ios" }).sc.checkForUpdate({ apply: false })).status).toBe("staged");
    cur = { v: await pointer(1, { kind: undefined }) };
    const t = setup(() => cur.v);
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
    expect((await t.sc.consumeEvents()).events).toEqual(["pointer_rejected:not a web bundle"]);
  });
  it("rule 1: asks the iOS path for iOS", async () => {
    const urls: string[] = [];
    const sc = new ShipvoCapacitor({ appId: "tide", shellMajor: 1, shellVersion: "1.0.0", platform: "ios", publicKey: pub, baseUrl: BASE,
      store: new MemoryStore(), files: new MemoryFiles(), random: () => 0.5, fetch: (async (u: string) => { urls.push(u); return new Response("", { status: 404 }); }) as any });
    await sc.checkForUpdate({ apply: false });
    expect(urls).toEqual([`${BASE}/p/tide/1/ios/b2`]);
  });
  it("rule 2: refuses another app or major", async () => {
    for (const over of [{ app_id: "other" }, { shell_major: 2 }]) {
      const cur = { v: await pointer(1, over) };
      expect((await setup(() => cur.v).sc.checkForUpdate({ apply: false })).status).toBe("error");
    }
  });
  it("rule 3: band comes from the cohort and a pointer for another band is refused", async () => {
    const cur = { v: await pointer(1, { band: "b0" }) }; const t = setup(() => cur.v);
    expect((await t.sc.getState()).band).toBe("b2"); // cohort 500
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("error");
  });
  it("rule 4: skips a release not newer than current, pending or blocked", async () => {
    const cur = { v: undefined as Served }; const t = setup(() => cur.v);
    expect((await stage(t, 5, cur)).status).toBe("staged");
    expect((await stage(t, 5, cur)).status).toBe("none");
    expect((await stage(t, 4, cur)).status).toBe("none");
    await t.sc.rollback(); // blocks 0 current but pending 5 dropped; blocked stays below
    cur.v = await pointer(2, {}, { bytes: bundle(2) });
    expect((await t.sc.checkForUpdate({ apply: false })).status).toBe("staged");
  });
  it("rule 5: refuses a release above the installed app version", async () => {
    const cur = { v: await pointer(1, { min_shell_version: "1.3.0" }) };
    expect((await setup(() => cur.v, { shell: "1.2.9" }).sc.checkForUpdate({ apply: false })).status).toBe("none");
    expect((await setup(() => cur.v, { shell: "1.3.0-beta.1" }).sc.checkForUpdate({ apply: false })).status).toBe("staged");
    expect(semverLess("1.2.9", "1.10.0")).toBe(true);
  });
  it("a 404 means nothing to do", async () => {
    expect(await setup(() => undefined).sc.checkForUpdate({ apply: false })).toEqual({ status: "none" });
  });
});

describe("staging, trial boots, promotion", () => {
  it("boots pending, and markHealthy promotes it", async () => {
    const cur = { v: undefined as Served }; const t = setup(() => cur.v);
    await stage(t, 1, cur);
    expect(await t.sc.boot()).toEqual({ release: 1, file: "release-1.bundle" });
    const h = await t.sc.markHealthy();
    expect(h).toMatchObject({ release: 1, promoted: true });
    const st = await t.sc.getState();
    expect([st.currentRelease, st.pendingRelease]).toEqual([1, 0]);
    expect((await t.sc.consumeEvents()).events).toEqual(["applied"]);
    expect((await t.sc.consumeEvents()).events).toEqual([]);
  });
  it("markHealthy does not promote when pending is not the running release", async () => {
    const cur = { v: undefined as Served }; const t = setup(() => cur.v);
    await t.sc.boot(); // embedded
    await stage(t, 1, cur);
    expect((await t.sc.markHealthy()).promoted).toBe(false);
    expect((await t.sc.getState()).pendingRelease).toBe(1);
  });
  it("promotion drops the old previous bundle", async () => {
    const cur = { v: undefined as Served }; let t = setup(() => cur.v);
    for (const r of [1, 2, 3]) {
      await stage(t, r, cur); t = t.again(); await t.sc.boot(); await t.sc.markHealthy();
    }
    expect([...t.files.files.keys()].sort()).toEqual(["release-2.bundle", "release-3.bundle"]);
  });
  it("rule 10: after 3 trial boots the pending release is dropped, blocked and reported", async () => {
    const cur = { v: undefined as Served }; let t = setup(() => cur.v);
    await stage(t, 1, cur);
    for (let i = 0; i < MAX_BOOTS; i++) { t = t.again(); expect((await t.sc.boot()).release).toBe(1); }
    t = t.again();
    expect(await t.sc.boot()).toEqual({ release: 0, file: undefined });
    const st = await t.sc.getState();
    expect([st.pendingRelease, st.blockedRelease]).toEqual([0, 1]);
    expect((await t.sc.consumeEvents()).events).toEqual(["crash_loop_revert"]);
    expect(t.files.files.size).toBe(0);
    expect((await stage(t, 1, cur)).status).toBe("none"); // blocked, not fetched again
  });
});

describe("concurrent first calls", () => {
  it("getState and checkForUpdate on an empty store share one load; cohort and staged release survive a restart", async () => {
    const cur = { v: await pointer(1) as Served };
    let n = 0;
    const store = new MemoryStore(), files = new MemoryFiles();
    const f = (async (url: string) => String(url).includes("/p/") ? Response.json(cur.v!.env) : new Response(cur.v!.bytes)) as unknown as typeof fetch;
    const mk = () => new ShipvoCapacitor({ appId: "tide", shellMajor: 1, shellVersion: "1.2.0", platform: "android", publicKey: pub,
      baseUrl: BASE, store, files, fetch: f, random: () => (++n % 2 ? 0.5 : 0.1) });
    const sc = mk();
    const [st, res] = await Promise.all([sc.getState(), sc.checkForUpdate({ apply: false })]);
    expect(res.status).toBe("staged");
    const again = await mk().getState();
    expect(again.cohort).toBe(st.cohort);
    expect(again.pendingRelease).toBe(1);
    expect(files.files.has("release-1.bundle")).toBe(true);
  });
  it("overlapping checks stage once", async () => {
    const cur = { v: await pointer(1) as Served }; const t = setup(() => cur.v);
    const r = await Promise.all([t.sc.checkForUpdate({ apply: false }), t.sc.checkForUpdate({ apply: false })]);
    expect(r.map((x) => x.status).sort()).toEqual(["none", "staged"]);
  });
  it("a corrupt state file clears stored bundles", async () => {
    const cur = { v: undefined as Served }; const t = setup(() => cur.v);
    await stage(t, 1, cur);
    await t.store.set("shipvo.state", "{not json");
    const t2 = t.again(); await t2.sc.getState();
    expect(t.files.files.size).toBe(0);
  });
});

describe("crash loop, rollback, new shell", () => {
  async function withCurrent(clock: { t: number }) {
    const cur = { v: undefined as Served }; let t = setup(() => cur.v, { now: () => clock.t });
    for (const r of [1, 2]) { await stage(t, r, cur); t = t.again(); await t.sc.boot(); await t.sc.markHealthy(); }
    return { t, cur };
  }
  it("rule 11: more than 3 unhealthy boots in 60 seconds reverts to previous and blocks current", async () => {
    const clock = { t: 1_000_000 }; let { t } = await withCurrent(clock);
    for (let i = 0; i < MAX_BOOTS; i++) { clock.t += 5000; t = t.again(); expect((await t.sc.boot()).release).toBe(2); }
    clock.t += 5000; t = t.again();
    expect(await t.sc.boot()).toEqual({ release: 1, file: "release-1.bundle" });
    const st = await t.sc.getState();
    expect([st.currentRelease, st.blockedRelease]).toEqual([1, 2]);
    expect((await t.sc.consumeEvents()).events).toContain("crash_loop_revert");
  });
  it("rule 11: boots spread over more than 60 seconds, or cleared by markStable, do not revert", async () => {
    const clock = { t: 1_000_000 }; let { t } = await withCurrent(clock);
    for (let i = 0; i < 6; i++) { clock.t += WINDOW_MS + 1; t = t.again(); expect((await t.sc.boot()).release).toBe(2); }
    for (let i = 0; i < 6; i++) { clock.t += 1000; t = t.again(); expect((await t.sc.boot()).release).toBe(2); await t.sc.markStable(); }
  });
  it("rule 14: rollback drops pending, blocks current and goes back", async () => {
    const clock = { t: 1 }; const { t, cur } = await withCurrent(clock);
    await stage(t, 3, cur);
    await t.sc.rollback();
    const st = await t.sc.getState();
    expect([st.currentRelease, st.pendingRelease, st.previousRelease, st.blockedRelease]).toEqual([1, 0, 0, 2]);
    expect((await t.sc.consumeEvents()).events).toContain("rolled_back");
    expect([...t.files.files.keys()]).toEqual(["release-1.bundle"]);
    expect((await t.sc.boot()).release).toBe(1);
    expect((await stage(t, 2, cur)).status).toBe("none");
  });
  it("rule 13: a new shell version deletes bundles and counters but keeps the cohort", async () => {
    const clock = { t: 1 }; const { t } = await withCurrent(clock);
    const cohort = (await t.sc.getState()).cohort;
    const store = t.store, files = t.files;
    const n = setup(() => undefined, { store, files, shell: "1.3.0" });
    const st = await n.sc.getState();
    expect([st.currentRelease, st.previousRelease, st.blockedRelease, st.cohort]).toEqual([0, 0, undefined, cohort]);
    expect(files.files.size).toBe(0);
  });
  it("state survives a restart", async () => {
    const cur = { v: undefined as Served }; const t = setup(() => cur.v);
    await stage(t, 1, cur);
    expect((await t.again().sc.getState()).pendingRelease).toBe(1);
  });
});
