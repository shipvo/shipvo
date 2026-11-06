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
    const { ctx, fetch } = mkCtx({ cache: memoryCache() });
    await runSource(spec, "charges", ctx);
    await runSource(spec, "charges", ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the cache expires", async () => {
    let t = 0;
    const { ctx, fetch } = mkCtx({ cache: memoryCache(() => t) });
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
});
