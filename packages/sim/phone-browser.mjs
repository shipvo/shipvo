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
    this.ctx = null; this.page = null; this.refsFrom = null;
  }
  async #start() {
    if (this.page) return;
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
    this.page = await this.ctx.newPage();
    this.page.on("framenavigated", (f) => { if (f === this.page.mainFrame()) this.#log(f.url(), true); });
  }
  #log(url, ok, code) { this.navigations.push({ at: Date.now(), kind: "browser_navigation", detail: { url, allowed: ok, ...(code ? { code } : {}) }, source: "real", simulated: false }); }

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
  async close() { await this.ctx?.close().catch(() => {}); this.ctx = this.page = null; }
}
