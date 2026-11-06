import { describe, it, expect, vi } from "vitest";
import { runSource, runAction, RunError, memoryCache } from "../src/index";

const SECRET = "sk_live_supersecretvalue123";
const spec = {
  permissions: { network: ["api.example.com"] },
  data: {
    charges: {
      source: "http", get: "https://api.example.com/v1/charges", query: { limit: 10 },
      auth: { secret: "STRIPE_KEY", type: "bearer" }, select: "data", cache: "5m"
    },
    cheap: { source: "http", get: "https://api.example.com/x", auth: { secret: "STRIPE_KEY", type: "query", name: "key" } },
    other: { source: "http", get: "https://evil.example.org/x" }
  },
  actions: {
    summary: { do: [{ refresh: "charges" }, { return: { total: "{{ sum(charges.map(c, c.amount)) }}", n: "{{ input.n }}" } }] },
    heavy: { do: [{ return: "{{ [1,2,3].map(a, [1,2,3].map(b, [1,2,3].map(c, a+b+c))) }}" }] }
  },
  screens: [{ body: [{ type: "stat", value: "{{ sum(charges.map(c, c.amount)) }}" }] }]
};
const body = { has_more: false, data: [{ id: "ch_1", amount: 100, internal_notes: "x", customer: { email: "a@b.c" } }] };
const mkCtx = (over = {}) => {
  const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }));
  return { fetch, ctx: { fetch, secrets: (n: string) => (n === "STRIPE_KEY" ? SECRET : undefined), ...over } };
};

describe("runSource", () => {
  it("trims the response to the fields the spec uses", async () => {
    const { ctx } = mkCtx();
    expect(await runSource(spec, "charges", ctx)).toEqual([{ amount: 100 }]);
  });

  it("adds the key as a bearer header", async () => {
    const { ctx, fetch } = mkCtx();
    await runSource(spec, "charges", ctx);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.example.com/v1/charges?limit=10");
    expect(init.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("uses the cache: a hit avoids a second fetch", async () => {
    const { ctx, fetch } = mkCtx({ cache: memoryCache(), cacheScope: "user-a" });
    await runSource(spec, "charges", ctx);
    await runSource(spec, "charges", ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not read or write the cache for an authed source without cacheScope", async () => {
    const cache = memoryCache();
    const get = vi.spyOn(cache, "get");
    const set = vi.spyOn(cache, "set");
    const { ctx, fetch } = mkCtx({ cache });
    await runSource(spec, "charges", ctx);
    await runSource(spec, "charges", ctx);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps two scopes with different secret values apart", async () => {
    const cache = memoryCache();
    const a = mkCtx({ cache, cacheScope: "a" });
    const b = mkCtx({ cache, cacheScope: "b", secrets: () => "sk_other" });
    await runSource(spec, "charges", a.ctx);
    await runSource(spec, "charges", b.ctx);
    await runSource(spec, "charges", a.ctx);
    await runSource(spec, "charges", b.ctx);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the cache expires", async () => {
    let t = 0;
    const { ctx, fetch } = mkCtx({ cache: memoryCache(() => t), cacheScope: "user-a" });
    await runSource(spec, "charges", ctx);
    t = 5 * 60_000 + 1;
    await runSource(spec, "charges", ctx);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails with secret_missing and names only the key", async () => {
    const { ctx } = mkCtx({ secrets: () => undefined });
    const e = await runSource(spec, "charges", ctx).catch((x) => x);
    expect(e).toBeInstanceOf(RunError);
    expect(e.code).toBe("secret_missing");
    expect(e.message).toContain("STRIPE_KEY");
  });

  it("never puts the secret in errors or logs", async () => {
    const logs: unknown[] = [];
    const fetch = vi.fn(async (url: string) => { throw new Error(`boom ${url}`); });
    const ctx = { fetch, secrets: () => SECRET, log: (e: unknown) => logs.push(e) };
    const e = await runSource(spec, "cheap", ctx).catch((x) => x);
    expect(e.code).toBe("request_failed");
    expect(String(e.message) + JSON.stringify(logs)).not.toContain(SECRET);
    const bad = mkCtx({ fetch: async () => ({ ok: false, status: 500, text: async () => SECRET }) });
    const e2 = await runSource(spec, "charges", bad.ctx).catch((x) => x);
    expect(e2.code).toBe("upstream_error");
    expect(e2.message).not.toContain(SECRET);
  });

  it("refuses a domain outside permissions.network without calling fetch", async () => {
    const { ctx, fetch } = mkCtx();
    const e = await runSource(spec, "other", ctx).catch((x) => x);
    expect(e.code).toBe("domain_not_allowed");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("runSource safety", () => {
  const mk = (data: unknown) => ({ permissions: { network: ["api.example.com"] }, data: { d: { source: "http", get: "https://api.example.com/x", ...(data as object) } } });
  const call = async (sp: unknown, over = {}) => {
    const { ctx, fetch } = mkCtx(over);
    const r = await runSource(sp, "d", ctx).catch((x) => x);
    return { r, fetch };
  };
  const initOf = (fetch: ReturnType<typeof mkCtx>["fetch"]) => (fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; redirect: string }])[1];

  it("sends basic auth as UTF-8 base64", async () => {
    const { fetch } = await call(mk({ auth: { secret: "STRIPE_KEY", type: "basic" } }));
    expect(initOf(fetch).headers.authorization).toBe(`Basic ${btoa(SECRET)}`);
  });
  it("encodes non-ASCII basic credentials as UTF-8", async () => {
    const { fetch } = await call(mk({ auth: { secret: "K", type: "basic" } }), { secrets: () => "é:ü" });
    expect(initOf(fetch).headers.authorization).toBe("Basic " + Buffer.from("é:ü", "utf8").toString("base64"));
  });
  it("places a header key under the given name, lower-cased", async () => {
    const { fetch } = await call(mk({ auth: { secret: "STRIPE_KEY", type: "header", name: "X-Token" } }));
    expect(initOf(fetch).headers["x-token"]).toBe(SECRET);
  });
  it("places a query key in the URL and keeps it out of errors and logs", async () => {
    const log = vi.fn();
    const { fetch } = await call(mk({ auth: { secret: "STRIPE_KEY", type: "query", name: "key" } }), { log });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(`https://api.example.com/x?key=${SECRET}`);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    const { r } = await call(mk({ auth: { secret: "STRIPE_KEY", type: "query" } }), { fetch: async () => ({ ok: false, status: 500, text: async () => "" }) });
    expect(r.code).toBe("upstream_error");
    expect(r.message).not.toContain(SECRET);
  });
  it("does not follow redirects", async () => {
    const { fetch } = await call(mk({}));
    expect(initOf(fetch).redirect).toBe("manual");
  });
  it("treats a 3xx as upstream_error", async () => {
    const { r } = await call(mk({}), { fetch: async () => ({ ok: false, status: 302, text: async () => "" }) });
    expect(r.code).toBe("upstream_error");
    expect(r.message).toContain("redirect");
  });
  it("throws bad_spec for an unknown auth type", async () => {
    const { r, fetch } = await call(mk({ auth: { secret: "STRIPE_KEY", type: "magic" } }));
    expect(r.code).toBe("bad_spec");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses post sources", async () => {
    const sp = { permissions: { network: ["api.example.com"] }, data: { d: { source: "http", post: "https://api.example.com/x" } } };
    const { r, fetch } = await call(sp);
    expect(r.code).toBe("unsupported_step");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails with response_too_large", async () => {
    const { r } = await call(mk({}), { maxResponseChars: 5 });
    expect(r.code).toBe("response_too_large");
  });
  it("fails on a non-JSON response", async () => {
    const { r } = await call(mk({}), { fetch: async () => ({ ok: true, status: 200, text: async () => "<html>" }) });
    expect(r.code).toBe("upstream_error");
  });
  it("returns null when select names a missing path", async () => {
    const { r } = await call(mk({ select: "nope.deeper" }));
    expect(r).toBeNull();
  });
});

describe("runAction", () => {
  it("refreshes a source and returns evaluated values", async () => {
    const { ctx } = mkCtx();
    expect(await runAction(spec, "summary", { n: 2 }, ctx)).toEqual({ total: 100, n: 2 });
  });

  it("fails with a typed cost_limit error over the cost limit", async () => {
    const { ctx } = mkCtx({ maxCost: 50 });
    const e = await runAction(spec, "heavy", {}, ctx).catch((x) => x);
    expect(e).toBeInstanceOf(RunError);
    expect(e.code).toBe("cost_limit");
  });

  const branchSpec = {
    actions: {
      pick: { do: [{ if: "input.n > 1", then: [{ return: "big" }], else: [{ return: "small" }] }] },
      web: { do: [{ http: { post: "https://api.example.com/x" } }] }
    }
  };

  it("runs the then branch when the condition is true and the else branch when it is not", async () => {
    const { ctx } = mkCtx();
    expect(await runAction(branchSpec, "pick", { n: 2 }, ctx)).toBe("big");
    expect(await runAction(branchSpec, "pick", { n: 1 }, ctx)).toBe("small");
  });

  it("refuses http steps with unsupported_step", async () => {
    const { ctx } = mkCtx();
    const e = await runAction(branchSpec, "web", {}, ctx).catch((x) => x);
    expect(e).toBeInstanceOf(RunError);
    expect(e.code).toBe("unsupported_step");
  });
});
