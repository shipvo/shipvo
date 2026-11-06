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
  const makeXhr = (online = true) => {
    const sent: any = { headers: {}, events: [] };
    class FakeX {
      open(m: string, u: string) { sent.open = [m, u]; }
      setRequestHeader(k: string, v: string) { sent.headers[k] = v; }
      send(b: any) { sent.body = b; }
      addEventListener() {}
      dispatchEvent(e: any) { sent.events.push(e.type); }
    }
    const win: any = { location: { origin: "http://127.0.0.1:1", href: "http://127.0.0.1:1/app/" }, URL, Request, ProgressEvent: class { constructor(public type: string) {} }, setTimeout: (f: () => void) => f(),
      fetch: async () => new Response("x"), XMLHttpRequest: FakeX };
    (0, eval)(netClientSource())(win, { token: "t", session: "s", profile: () => "spotty", online: () => online, log: () => {} });
    return { x: new win.XMLHttpRequest(), sent };
  };
  it("rewrites a cross-origin XMLHttpRequest to the route and marks it as XHR", () => {
    const { x, sent } = makeXhr();
    x.open("post", "http://api.test/a"); x.setRequestHeader("content-type", "text/plain"); x.send("b");
    expect(sent.open).toEqual(["POST", "/__shipvo/net"]);
    expect(sent.headers["x-shipvo-xhr"]).toBe("1");
    expect(sent.headers["x-shipvo-token"]).toBe("t");
    expect(JSON.parse(decodeURIComponent(sent.headers["x-shipvo-req"])).headers).toEqual({ "content-type": "text/plain" });
  });
  it("leaves a same-origin XMLHttpRequest alone", () => {
    const { x, sent } = makeXhr();
    x.open("GET", "/local"); x.send();
    expect(sent.open).toEqual(["GET", "/local"]);
    expect(sent.headers["x-shipvo-token"]).toBeUndefined();
  });
  it("raises an error event for an XMLHttpRequest when offline", () => {
    const { x, sent } = makeXhr(false);
    x.open("GET", "http://api.test/"); x.send();
    expect(sent.events).toEqual(["error"]);
  });
});
