import { describe, it, expect } from "vitest";
import { netClientSource } from "../src/run-net";

// Runs the page-side wrapper against a fake window to check which requests it sends through the route.
describe("run net client", () => {
  const make = (online = true) => {
    const calls: { url: string; init?: any }[] = []; const logs: any[] = [];
    const win: any = { location: { origin: "http://127.0.0.1:1", href: "http://127.0.0.1:1/app/" }, URL, Request, setTimeout,
      fetch: async (u: any, init?: any) => { calls.push({ url: String(u?.url ?? u), init }); return new Response("x", { status: 200 }); } };
    (0, eval)(netClientSource())(win, { token: "t", session: "s", profile: () => "slow-4g", online: () => online, log: (d: any) => logs.push(d) });
    return { win, calls, logs };
  };
  it("sends cross-origin fetch through the route and leaves same-origin alone", async () => {
    const { win, calls, logs } = make();
    await win.fetch("http://localhost:3000/api", { method: "POST", body: "b" });
    await win.fetch("/local.json");
    expect(calls[0].url).toBe("/__shipvo/net");
    expect(calls[0].init.headers["x-shipvo-token"]).toBe("t");
    expect(calls[0].init.headers["x-shipvo-profile"]).toBe("slow-4g");
    expect(JSON.parse(decodeURIComponent(calls[0].init.headers["x-shipvo-req"]))).toMatchObject({ url: "http://localhost:3000/api", method: "POST" });
    expect(calls[1].url).toBe("/local.json");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: "POST", host: "localhost:3000", status: 200 });
  });
  it("leaves a same-origin POST with a Request input unread", async () => {
    const { win, calls } = make();
    const req = new Request("http://127.0.0.1:1/api", { method: "POST", body: "payload" });
    await win.fetch(req);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:1/api");
    expect(req.bodyUsed).toBe(false);
  });
  it("sends a cross-origin Request input with its body through the route", async () => {
    const { win, calls } = make();
    await win.fetch(new Request("http://api.test/x", { method: "POST", body: "payload" }));
    expect(calls[0].url).toBe("/__shipvo/net");
    expect(new TextDecoder().decode(calls[0].init.body)).toBe("payload");
  });
  it("fails like a native network error when the phone is offline", async () => {
    const { win, calls } = make(false);
    await expect(win.fetch("http://api.test/")).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});
