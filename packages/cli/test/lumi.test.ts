import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { Lumi, lumiPage, parseCommand, routeName, startLumiServer, type State } from "../src/lumi.js";
import type { Driver, Reply } from "../src/explore.js";

const SCREENS: Record<string, string> = {
  home: `- heading "Home" [ref=e1]\n- button "Sign up" [ref=e2]\n- button "Cart" [ref=e3]`,
  signup: `- heading "Sign up" [ref=e1]\n- textbox "Email" [ref=e2]\n- button "Continue" [ref=e3]\n- button "Back" [ref=e4]`,
  bad: `- heading "Sign up" [ref=e1]\n- text: Enter a valid email\n- textbox "Email" [ref=e2]\n- button "Continue" [ref=e3]\n- button "Back" [ref=e4]`,
  welcome: `- heading "Welcome" [ref=e1]\n- button "Back" [ref=e2]`,
  cart: `- heading "Cart" [ref=e1]\n- text: Network request failed\n- button "Back" [ref=e2]`,
};
function shop() {
  let at = "home"; let email = ""; const stack: string[] = []; const typed: string[] = [];
  const view = (): Reply => ({ ok: true, screen: SCREENS[at] });
  const go = (to: string) => { stack.push(at); at = to; };
  const submit = () => { if (/^\S+@\S+\.\S+$/.test(email)) go("welcome"); else if (at === "signup") go("bad"); };
  const driver: Driver = {
    async open() { at = "home"; email = ""; stack.length = 0; return view(); },
    async openUrl(u) { if (u.endsWith("cart")) { stack.length = 0; at = "cart"; } return view(); },
    async tap(ref) {
      const name = new RegExp(`button "([^"]+)" \\[ref=${ref}\\]`).exec(SCREENS[at]!)?.[1] ?? "?";
      if (name === "Continue") submit(); else if (name === "Sign up") go("signup"); else if (name === "Cart") go("cart");
      return { ...view(), delivery: "delivered" };
    },
    async back() { const p = stack.pop(); if (!p) return { ok: false, error: "no Back", screen: SCREENS[at] }; at = p; return view(); },
    async type(_r, text, enter) { typed.push(text); email = text; if (enter) submit(); return view(); },
    async snapshot() { return view(); },
    async errors() { return []; },
  };
  return { driver, typed };
}
const opts = { settleMs: 1, maxSteps: 60, maxDepth: 3, routes: ["shop://cart"] };

describe("parseCommand", () => {
  it("reads every command", () => {
    expect(parseCommand("Test my app")).toEqual({ kind: "test-all" });
    expect(parseCommand("  test  ")).toEqual({ kind: "test-all" });
    expect(parseCommand("test checkout")).toEqual({ kind: "test-flow", flow: "checkout" });
    expect(parseCommand("test the sign up flow")).toEqual({ kind: "test-flow", flow: "sign up" });
    expect(parseCommand("try sign up with bad input")).toEqual({ kind: "bad-input", flow: "sign up" });
    expect(parseCommand("stop")).toEqual({ kind: "stop" });
    expect(parseCommand("replay bug 2")).toEqual({ kind: "replay", n: 2 });
    expect(parseCommand("replay bug #12")).toEqual({ kind: "replay", n: 12 });
    expect(parseCommand("help")).toEqual({ kind: "help" });
  });
  it("calls anything else unknown", () => {
    expect(parseCommand("make me a sandwich").kind).toBe("unknown");
    expect(parseCommand("replay bug").kind).toBe("unknown");
    expect(parseCommand("").kind).toBe("unknown");
  });
  it("names a route from its url", () => { expect(routeName("shop://cart")).toBe("cart"); expect(routeName("shop://")).toBe(""); });
});

describe("Lumi", () => {
  it("test my app: feeds actions, lists findings and counts coverage, with no AI", async () => {
    const l = new Lumi(shop().driver, opts); const states: State[] = []; l.subscribe((s) => states.push(s));
    expect(await l.command("test my app")).toMatch(/whole app/);
    expect(l.state().running).toBe(true); expect(l.state().mood).toBe("working");
    await l.idle();
    const s = l.state();
    expect(s.running).toBe(false); expect(s.mood).toBe("worried");
    expect(s.feed.some((f) => f.kind === "step" && /tap button "Sign up"/.test(f.text))).toBe(true);
    expect(s.findings.some((f) => /Network failed/.test(f.message))).toBe(true);
    expect(s.findings[0]!.n).toBe(1);
    expect(s.coverage.screens).toBeGreaterThanOrEqual(4);
    expect(s.coverage.controlsTried).toBeGreaterThan(0); expect(s.coverage.controlsSeen).toBeGreaterThanOrEqual(s.coverage.controlsTried);
    expect(s.feed.at(-1)!.text).toMatch(/^Done\./);
    expect(states.length).toBeGreaterThan(5);
  });
  it("test <flow> walks only that flow, by control name", async () => {
    const l = new Lumi(shop().driver, opts);
    expect(await l.command("test sign up")).toBe("Testing Sign up.");
    await l.idle();
    const taps = l.state().feed.filter((f) => f.kind === "step").map((f) => f.text);
    expect(taps.some((t) => /"Cart"/.test(t))).toBe(false);
    expect(taps.some((t) => /Email/.test(t))).toBe(true);
  });
  it("test <flow> finds a route flow", async () => {
    const l = new Lumi(shop().driver, opts);
    expect(await l.command("test cart")).toBe("Testing cart."); await l.idle();
    expect(l.state().findings.some((f) => /Network failed/.test(f.message))).toBe(true);
  });
  it("an unknown flow lists the flows it knows", async () => {
    const l = new Lumi(shop().driver, opts);
    const r = await l.command("test zebra");
    expect(r).toMatch(/do not know a flow called "zebra"/); expect(r).toMatch(/cart/); expect(r).toMatch(/Sign up/);
    expect(l.state().running).toBe(false);
  });
  it("try <flow> with bad input types only invalid values", async () => {
    const { driver, typed } = shop(); const l = new Lumi(driver, opts);
    await l.command("try sign up with bad input"); await l.idle();
    expect(typed.length).toBeGreaterThan(0); expect(typed).not.toContain("ada@example.com");
    expect(typed[0]).toBe("not-an-email");
  });
  it("stop ends a run", async () => {
    const l = new Lumi(shop().driver, opts);
    expect(await l.command("stop")).toBe("Nothing is running.");
    await l.command("test my app");
    expect(await l.command("stop")).toMatch(/Stopping/);
    expect(await l.command("test my app")).toMatch(/busy/);
    await l.idle();
    expect(l.state().feed.at(-1)!.text).toMatch(/Stopped: stopped by you/);
    expect(l.state().running).toBe(false);
  });
  it("replay bug <n> does the steps again and says if the bug is still there", async () => {
    const l = new Lumi(shop().driver, opts);
    expect(await l.command("replay bug 1")).toMatch(/no bugs to replay/);
    await l.command("test my app"); await l.idle();
    const n = l.state().findings.find((f) => /Network failed/.test(f.message))!.n;
    expect(await l.command(`replay bug ${n + 50}`)).toMatch(/There is no bug/);
    const before = l.state().feed.length;
    expect(await l.command(`replay bug ${n}`)).toBe(`Replaying bug ${n}.`); await l.idle();
    const after = l.state();
    expect(after.feed.length).toBeGreaterThan(before + 1);
    expect(after.feed.at(-1)!.text).toMatch(new RegExp(`Bug ${n} is still there`));
    expect(after.mood).toBe("worried");
  });
  it("stopping a replay does not leave Lumi on working", async () => {
    const l = new Lumi(shop().driver, { ...opts, walkDelayMs: 20 });
    await l.command("test my app"); await l.idle();
    const n = l.state().findings.find((f) => /Network failed/.test(f.message))!.n;
    await l.command(`replay bug ${n}`);
    await l.command("stop"); await l.idle();
    expect(l.state().mood).not.toBe("working");
    expect(l.state().feed.at(-1)!.text).toBe("Replay stopped.");
  });
  it("a replay whose action fails says it could not reach the end", async () => {
    const s = shop(); const l = new Lumi(s.driver, opts);
    await l.command("test my app"); await l.idle();
    const n = l.state().findings.find((f) => /Network failed/.test(f.message))!.n;
    s.driver.openUrl = async () => ({ ok: false, error: "boom", screen: SCREENS.home });
    s.driver.tap = async () => ({ ok: false, error: "boom", screen: SCREENS.home });
    await l.command(`replay bug ${n}`); await l.idle();
    const text = l.state().feed.map((f) => f.text);
    expect(text.at(-1)).toBe(`Could not replay bug ${n} to the end.`);
    expect(text.join("\n")).not.toMatch(/did not show up/);
  });
  it("help and unknown text give the short list", async () => {
    const l = new Lumi(shop().driver, opts);
    for (const t of ["help", "dance"]) {
      const r = await l.command(t);
      for (const c of ["test my app", "test <flow>", "try <flow> with bad input", "stop", "replay bug <n>", "help"]) expect(r).toContain(c);
    }
  });
  it("is happy when a clean app has no findings", async () => {
    const clean: Driver = { async open() { return { ok: true, screen: `- heading "Hi" [ref=e1]\n- button "Next" [ref=e2]` }; }, async openUrl() { return this.open(); }, async tap() { return this.open(); }, async back() { return this.open(); }, async errors() { return []; } };
    const l = new Lumi(clean, { maxSteps: 5 }); await l.command("test my app"); await l.idle();
    expect(l.state().mood).toBe("happy"); expect(l.state().findings).toEqual([]);
  });
});

const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer();
  s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as AddressInfo; s.close(() => res(port)); });
});

describe("page and server", () => {
  let server: Server | undefined;
  afterEach(() => { server?.closeAllConnections(); server?.close(); server = undefined; });
  const frame = { html: `<div data-part="phone-body"><img data-part="screen" alt="x"></div>`, css: "" };
  const boot = async () => {
    // Ask the OS for a free port so parallel test files cannot collide with us.
    const port = await freePort();
    const lumi = new Lumi(shop().driver, opts);
    server = await startLumiServer({ lumi, page: lumiPage(frame, "Tide <b>"), shot: async () => Buffer.from([0xff, 0xd8]), port });
    return { lumi, base: `http://127.0.0.1:${port}` };
  };
  it("the page has the sidebar parts and escapes the title", () => {
    const html = lumiPage(frame, "Tide <b>");
    for (const p of ["feed", "findings", "coverage", "command", "now"]) expect(html).toContain(`data-part="${p}"`);
    expect(html).toContain("<title>Lumi: Tide b</title>");
  });
  it("keeps the stage a fixed share of the height on narrow screens and refits when it resizes", () => {
    const html = lumiPage(frame, "Tide");
    expect(html).toMatch(/@media \(max-width:900px\)[^`]*\.lm-stage\{flex:none;height:50vh\}/);
    expect(html).toContain("new ResizeObserver(fit).observe(stage)");
  });
  it("serves the page, a command, state and a screenshot", async () => {
    const { lumi, base } = await boot();
    expect(await (await fetch(base + "/")).text()).toContain("Tell Lumi what to do");
    const r = await fetch(base + "/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "help" }) });
    expect((await r.json() as { reply: string }).reply).toContain("test my app");
    await lumi.command("dance");
    expect((await (await fetch(base + "/shot")).arrayBuffer()).byteLength).toBe(2);
    expect(((await (await fetch(base + "/state")).json()) as State).mood).toBe("idle");
  });
  it("refuses a command from another site and a foreign Host", async () => {
    const { base } = await boot();
    const evil = await fetch(base + "/cmd", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ text: "test my app" }) });
    expect(evil.status).toBe(403);
    const plain = await fetch(base + "/cmd", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(plain.status).toBe(403);
    const { request } = await import("node:http");
    const status = await new Promise<number>((ok) => { const q = request(base + "/", { headers: { host: "evil.example" } }, (res) => { res.resume(); ok(res.statusCode!); }); q.end(); });
    expect(status).toBe(403);
  });
});
