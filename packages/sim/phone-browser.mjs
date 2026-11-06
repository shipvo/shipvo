// A real Chromium page behind the phone: one isolated browser context per phone, a mobile viewport and touch.
// Pages are untrusted web content. Private hosts are refused unless the caller opts in.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const USER_AGENT_TAG = "ShipvoPhone";

export class BrowserError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function v4Private(a, b) {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** True for loopback, link-local, RFC1918, CGNAT, `.local`, `.internal` and `localhost` names or addresses. */
export function isPrivateHost(host) {
  let h = String(host).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const kind = isIP(h);
  if (kind === 4) { const [a, b] = h.split(".").map(Number); return v4Private(a, b); }
  if (kind === 6) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1)
    const m = /^::ffff:(?:(\d+)\.(\d+)\.(\d+)\.(\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
    if (m) {
      if (m[1]) return v4Private(Number(m[1]), Number(m[2]));
      const hi = parseInt(m[5], 16); return v4Private(hi >> 8, hi & 255);
    }
    if (h === "::" || h === "::1") return true;
    const first = parseInt(h.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;   // fc00::/7 unique local, fe80::/10 link-local
  }
  return false;
}

/**
 * Decides if a URL may be loaded. Throws BrowserError host_not_allowed. A public name that resolves to a
 * private address is refused too, so a DNS record cannot reach the local network.
 */
export async function checkUrl(raw, { allowPrivate = false, allowHosts = [] } = {}, resolve = (h) => lookup(h, { all: true })) {
  let u; try { u = new URL(raw); } catch { throw new BrowserError("bad_url", `not a URL: ${raw}`); }
  if (u.protocol === "about:" || u.protocol === "data:" || u.protocol === "blob:") return u;
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BrowserError("bad_url", `only http and https pages can be opened, not ${u.protocol}`);
  const host = u.hostname.toLowerCase();
  if (allowPrivate || allowHosts.map((x) => x.toLowerCase()).includes(host)) return u;
  const refuse = (why) => new BrowserError("host_not_allowed", `${host} is ${why}, so the phone browser did not open it. Pass allow_private: true, or allow_hosts: ["${host}"], to opt in.`);
  if (isPrivateHost(host)) throw refuse("a private host");
  if (!isIP(host.replace(/^\[|\]$/g, ""))) {
    let addrs = []; try { addrs = await resolve(host); } catch {}
    if (addrs.some((a) => isPrivateHost(a.address))) throw refuse("a name that points to a private address");
  }
  return u;
}

export class PhoneBrowser {
  /** @param browser a Playwright Browser. @param opts {allowPrivate, allowHosts, device, resolve} */
  constructor(browser, opts = {}) {
    this.browser = browser; this.opts = { allowPrivate: !!opts.allowPrivate, allowHosts: opts.allowHosts ?? [] };
    this.device = opts.device ?? {}; this.resolve = opts.resolve; this.navigations = [];
    this.ctx = null; this.page = null; this.pages = []; this.refsFrom = null;
    this.onDeepLink = opts.onDeepLink ?? null;   // called with a link such as myapp://item/3 that a page tried to open
    this.cdp = null; this.screencast = null; this.onChange = null;
  }
  async #start() {
    if (this.ctx) { if (!this.page) await this.ctx.newPage(); return; }
    const d = this.device;
    this.ctx = await this.browser.newContext({ ...d, userAgent: `${d.userAgent ?? "Mozilla/5.0 (Linux; Android 11; Pixel 5)"} ${USER_AGENT_TAG}`, hasTouch: true, isMobile: true, viewport: d.viewport ?? { width: 393, height: 851 } });
    // Every request, including redirects and sub-resources, goes through the same host check.
    await this.ctx.route("**/*", async (route) => {
      try { await checkUrl(route.request().url(), this.opts, this.resolve); } catch (e) {
        if (route.request().isNavigationRequest()) this.#log(route.request().url(), false, e.code);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    // A link to another app's scheme (myapp://...) cannot load in Chromium. Hand it to the phone, which gives it to the app.
    await this.ctx.exposeFunction("__shipvoDeepLink", (u) => { if (isDeepLink(u)) { this.#log(String(u), true, undefined, "deep_link"); this.onDeepLink?.(String(u)); } });
    await this.ctx.addInitScript(() => document.addEventListener("click", (e) => {
      const a = e.target?.closest?.("a[href]"); if (!a) return;
      const u = a.href; if (/^(https?|about|data|blob|javascript|file|mailto|tel):/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return;
      e.preventDefault(); globalThis.__shipvoDeepLink(u);
    }, true));
    this.ctx.on("page", (p) => this.#adopt(p));   // a popup or target=_blank link is a new tab
    await this.ctx.newPage();
  }
  #adopt(p) {
    if (this.pages.includes(p)) return;
    this.pages.push(p); this.page = p; this.refsFrom = null;
    p.on("framenavigated", (f) => { if (f === p.mainFrame()) { this.#log(f.url(), true); this.onChange?.(); } });
    p.on("close", () => { this.pages = this.pages.filter((x) => x !== p); if (this.page === p) { this.page = this.pages.at(-1) ?? null; this.refsFrom = null; if (this.page) this.#cast(); } this.onChange?.(); });
    if (this.screencast) this.#cast();
  }
  #log(url, ok, code, kind = "browser_navigation") { this.navigations.push({ at: Date.now(), kind, detail: { url, allowed: ok, ...(code ? { code } : {}) }, source: "real", simulated: false }); }

  async open(url) {
    try { await checkUrl(url, this.opts, this.resolve); } catch (e) { this.#log(String(url), false, e.code); throw e; }
    await this.#start();
    try { await this.page.goto(url, { waitUntil: "load", timeout: 20000 }); }
    catch (e) { throw new BrowserError(/blockedbyclient/i.test(e.message) ? "host_not_allowed" : "navigation_failed", String(e.message).split("\n")[0]); }
    return this.snapshot();
  }
  #need() { if (!this.page) throw new BrowserError("no_page", "no page is open: call browser_open first"); return this.page; }
  async snapshot() {
    const page = this.#need();
    await page.waitForTimeout(100);
    const tree = await page.locator("body").ariaSnapshot({ mode: "ai" });
    this.refsFrom = page.url();
    return { source: "web", untrusted: true, url: page.url(), title: await page.title(), tree };
  }
  async #target(ref) {
    const page = this.#need();
    const stale = new BrowserError("stale_ref", `stale ref ${ref}: take a new browser_snapshot and use a ref from it.`);
    if (!/^(?:f\d+)?e\d+$/.test(String(ref)) || this.refsFrom !== page.url()) throw stale;
    const l = page.locator(`aria-ref=${ref}`);
    if ((await l.count().catch(() => 0)) !== 1) throw stale;
    return l;
  }
  async click(ref) { const l = await this.#target(ref); await l.click({ timeout: 3000 }); await this.page.waitForLoadState("load").catch(() => {}); return this.snapshot(); }
  async type(ref, text, enter = false) {
    const l = await this.#target(ref);
    await l.fill(String(text ?? ""), { timeout: 3000 }); if (enter) await l.press("Enter");
    await this.page.waitForLoadState("load").catch(() => {});
    return this.snapshot();
  }
  async back() {
    const page = this.#need();
    if (!(await page.goBack({ timeout: 5000 }).catch(() => null))) throw new BrowserError("no_history", "there is no earlier page to go back to");
    return this.snapshot();
  }
  async screenshot() { return this.#need().screenshot({ type: "png" }); }
  async forward() {
    const page = this.#need();
    if (!(await page.goForward({ timeout: 5000 }).catch(() => null))) throw new BrowserError("no_history", "there is no later page to go forward to");
    return this.snapshot();
  }
  async reload() { await this.#need().reload({ timeout: 20000 }).catch((e) => { throw new BrowserError("navigation_failed", String(e.message).split("\n")[0]); }); return this.snapshot(); }
  async scroll(dy = 400, dx = 0) { await this.#need().mouse.wheel(dx, dy); return this.snapshot(); }
  /** Waits for text to appear in the page (or to be gone, with gone: true). Resolves with a snapshot. */
  async waitFor({ text, gone = false, timeoutMs = 5000 } = {}) {
    const page = this.#need();
    if (typeof text !== "string" || !text) throw new BrowserError("bad_args", "browser_wait_for needs text");
    try { await page.waitForFunction(([t, g]) => document.body.innerText.includes(t) !== g, [text, gone], { timeout: Math.min(Math.max(timeoutMs, 100), 30000) }); }
    catch { throw new BrowserError("timeout", `"${text}" ${gone ? "did not go away" : "did not appear"} within ${timeoutMs} ms`); }
    return this.snapshot();
  }
  async tabs() { return Promise.all(this.pages.map(async (p, index) => ({ index, url: p.url(), title: await p.title().catch(() => ""), active: p === this.page }))); }
  async selectTab(index) { const p = this.pages[index]; if (!p) throw new BrowserError("no_tab", `no tab ${index}`); this.page = p; this.refsFrom = null; await p.bringToFront(); if (this.screencast) await this.#cast(); this.onChange?.(); }
  async newTab(url = "about:blank") { await this.#start(); await checkUrl(url, this.opts, this.resolve); const p = await this.ctx.newPage(); await p.goto(url).catch(() => {}); return this.tabs(); }
  async closeTab(index) {
    const p = this.pages[index]; if (!p) throw new BrowserError("no_tab", `no tab ${index}`);
    await p.close(); return this.tabs();
  }

  // Live view. Chromium pushes JPEG frames (CDP Page.startScreencast); each one is acked once it has been handed on.
  async #cast() {
    if (!this.page || !this.ctx) return;
    try {   // a tab that is closing or not yet attached must not take the server down
      await this.cdp?.send("Page.stopScreencast").catch(() => {}); this.cdp?.detach().catch(() => {});
      const c = this.cdp = await this.ctx.newCDPSession(this.page);
      c.on("Page.screencastFrame", (f) => { c.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); this.screencast?.({ data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight }); });
      await c.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 400, maxHeight: 860, everyNthFrame: 1 });
    } catch {}
  }
  async startScreencast(onFrame) { await this.#need(); this.screencast = onFrame; await this.#cast(); }
  async stopScreencast() { this.screencast = null; await this.cdp?.send("Page.stopScreencast").catch(() => {}); }
  /** Input as a finger and keyboard would give it, in CSS px of the viewport. */
  async input(m) {
    this.#need(); const c = this.cdp ?? (this.cdp = await this.ctx.newCDPSession(this.page));
    const touch = (type, x, y) => c.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const num = (...v) => { if (!v.every((n) => Number.isFinite(n))) throw new BrowserError("bad_args", "coordinates must be numbers"); };
    if (m.type === "tap") { num(m.x, m.y); await touch("touchStart", m.x, m.y); await touch("touchEnd"); }
    else if (m.type === "swipe") {
      num(m.x1, m.y1, m.x2, m.y2); await touch("touchStart", m.x1, m.y1);
      for (let i = 1; i <= 8; i++) await touch("touchMove", m.x1 + ((m.x2 - m.x1) * i) / 8, m.y1 + ((m.y2 - m.y1) * i) / 8);
      await touch("touchEnd");
    }
    else if (m.type === "text") await c.send("Input.insertText", { text: String(m.text ?? "").slice(0, 2000) });
    else if (m.type === "key") { const key = String(m.key); const code = { Enter: 13, Backspace: 8, Tab: 9 }[key]; if (!code) throw new BrowserError("bad_args", `unsupported key ${key}`);
      for (const type of ["keyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type, key, windowsVirtualKeyCode: code, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); }
    else throw new BrowserError("bad_args", `unknown input ${m.type}`);
  }
  async close() { this.screencast = null; await this.ctx?.close().catch(() => {}); this.ctx = this.page = this.cdp = null; this.pages = []; }
}

/** True for a link into another app: a scheme that is not a web page scheme. */
export function isDeepLink(u) { return /^[a-z][a-z0-9+.-]*:/i.test(String(u)) && !/^(https?|about|data|blob|javascript|file|ftp|view-source|chrome|devtools|mailto|tel):/i.test(String(u)); }
