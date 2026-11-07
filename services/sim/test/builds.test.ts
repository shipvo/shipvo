import { describe, expect, it } from "vitest";
import { builds, sweepBuilds, DEFAULT_MAX_BUILD_BYTES, type BuildBucket } from "../src/builds";

// A fake R2 bucket with the four calls the module uses.
function fake() {
  const store = new Map<string, { body: Uint8Array; customMetadata: Record<string, string> }>();
  const bucket: BuildBucket = {
    async put(k, body, o) { store.set(k, { body: new Uint8Array(body as Uint8Array), customMetadata: o.customMetadata }); },
    async head(k) { const v = store.get(k); return v ? { customMetadata: v.customMetadata } : null; },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor }) {
      // The cursor is the last key returned, so deleting while paging does not skip objects (as in R2).
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
      const page = keys.slice(0, 2);
      return { objects: page.map((key) => ({ key, customMetadata: store.get(key)!.customMetadata })), truncated: keys.length > 2, cursor: page.at(-1) };
    },
  };
  return { store, bucket };
}
const post = (env: any, account: number | null, body: BodyInit | null, headers: Record<string, string> = {}) =>
  builds(new Request("https://x/builds?app=menu", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit), env, new URL("https://x/builds?app=menu"), account);
const get = (env: any, id: string, account: number | null) => builds(new Request(`https://x/builds/${id}`), env, new URL(`https://x/builds/${id}`), account);
const idOf = async (r: Response) => ((await r.json()) as { id: string }).id;
const chunked = (sizes: number[]) => new ReadableStream({ start(c) { for (const n of sizes) c.enqueue(new Uint8Array(n)); c.close(); } });

describe("builds", () => {
  it("stores a build for the account and answers the same account", async () => {
    const { bucket, store } = fake(); const env = { BUILDS: bucket };
    const r = await post(env, 7, "hello"); expect(r.status).toBe(201);
    const id = await idOf(r);
    expect(store.get(`builds/${id}`)!.customMetadata).toMatchObject({ account: "7", app: "menu" });
    const g = await get(env, id, 7); expect(g.status).toBe(200);
    expect(await g.json()).toMatchObject({ id, app: "menu" });
  });
  it("another account gets build_not_found, the same as a missing id", async () => {
    const { bucket } = fake(); const env = { BUILDS: bucket };
    const id = await idOf(await post(env, 7, "x"));
    const other = await get(env, id, 8), missing = await get(env, "nope", 8);
    expect(other.status).toBe(404); expect(await other.json()).toEqual({ code: "build_not_found" });
    expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ code: "build_not_found" });
  });
  it("a key with no account gets 401", async () => {
    const { bucket } = fake();
    expect((await post({ BUILDS: bucket }, null, "x")).status).toBe(401);
    expect((await get({ BUILDS: bucket }, "a", null)).status).toBe(401);
  });
  it("503 when the bucket is not bound", async () => {
    const r = await post({}, 1, "x"); expect(r.status).toBe(503); expect(((await r.json()) as any).code).toBe("builds_unavailable");
  });
  it("an expired build answers 410 and is deleted", async () => {
    const { bucket, store } = fake(); const env = { BUILDS: bucket };
    const id = await idOf(await post(env, 7, "x"));
    store.get(`builds/${id}`)!.customMetadata.expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await get(env, id, 7); expect(r.status).toBe(410);
    expect(store.has(`builds/${id}`)).toBe(false);
  });
  it("over the declared size gives 413 and stores nothing", async () => {
    const { bucket, store } = fake();
    const r = await post({ BUILDS: bucket, MAX_BUILD_BYTES: "4" }, 7, "hello world");
    expect(r.status).toBe(413); expect(((await r.json()) as any).message).toMatch(/smaller/); expect(store.size).toBe(0);
  });
  it("a chunked upload with no Content-Length is capped while it is read", async () => {
    const { bucket, store } = fake();
    const r = await post({ BUILDS: bucket, MAX_BUILD_BYTES: "10" }, 7, chunked([6, 6, 6]));
    expect(r.status).toBe(413); expect(store.size).toBe(0);
    expect((await post({ BUILDS: bucket, MAX_BUILD_BYTES: "10" }, 7, chunked([5, 5]))).status).toBe(201);
  });
  it("a missing or bad MAX_BUILD_BYTES falls back to a built-in cap, not unlimited", async () => {
    const { bucket } = fake();
    for (const v of [undefined, "", "abc", "0", "-5"]) {
      const r = await post({ BUILDS: bucket, MAX_BUILD_BYTES: v }, 7, null, { "content-length": String(DEFAULT_MAX_BUILD_BYTES + 1) });
      expect(r.status).toBe(413);
    }
  });
  it("the cron sweep deletes only expired builds, across pages", async () => {
    const { bucket, store } = fake(); const env = { BUILDS: bucket };
    const ids = [] as string[]; for (let i = 0; i < 5; i++) ids.push(await idOf(await post(env, 7, "x")));
    for (const id of ids.slice(0, 3)) store.get(`builds/${id}`)!.customMetadata.expires_at = "2000-01-01T00:00:00.000Z";
    expect(await sweepBuilds(env)).toBe(3);
    expect([...store.keys()].sort()).toEqual(ids.slice(3).map((i) => `builds/${i}`).sort());
  });
});
