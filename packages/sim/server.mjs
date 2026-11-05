#!/usr/bin/env node
// Shipvo UI simulator: runs the real app UI (React Native Web build) in a phone-sized headless browser,
// and lets an agent see the screen as an accessibility tree and act on it: tap, type, scroll, back.
// No emulator, no device. Each session also gets a mock control plane that records orders for grading.
//   shipvo sim  (or: node packages/sim/server.mjs) [--port 4545] [--dir /tmp/pn-ui] [--dist ./sim-dist] [--app <id>]
// Reads shipvo.json in the current directory (appId, name, controlPlane) when present.
import http from "node:http";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withAppName } from "./app-name.mjs";
import { parseMockRules } from "./mock-rules.mjs";
import { pushNotification } from "./push-notification.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
// Playwright: the app's own install first (its browsers match it), then this package's, then a global one.
const require_ = createRequire(import.meta.url);
let pw;
for (const get of [() => createRequire(join(process.cwd(), "package.json"))("playwright"), () => require_("playwright"), () => require_(join(execSync("npm root -g").toString().trim(), "playwright"))]) {
  try { pw = get(); break; } catch {}
}
if (!pw) { console.error("playwright is not installed: npm i -D playwright && npx playwright install chromium"); process.exit(2); }
const { chromium, devices } = pw;

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
let CFG = {}; try { CFG = JSON.parse(readFileSync(join(process.cwd(), "shipvo.json"), "utf8")); } catch {}
const PORT = Number(arg("port", 4545)), DIR = arg("dir", "/tmp/pn-ui"), DIST = arg("dist", join(process.cwd(), "sim-dist"));
const DEFAULT_APP = arg("app", CFG.appId || "tide"), APP_NAME = CFG.name || "Tide & Tackle";
// Published releases: open_app("tide@r13") loads the web artifact that `shipvo publish` stored next to the phone bundle.
const CONTROL = (process.env.PN_CONTROL || process.env.CONTENT_FROM || CFG.controlPlane || "https://api.shipvo.dev").replace(/\/$/, "");
async function resolveApp(spec) {
  const m = /^([a-z0-9-]+)(?:@(?:r?(\d+)|(latest)))?$/.exec(String(spec || DEFAULT_APP)); if (!m) throw new Error(`bad app spec "${spec}": use "${DEFAULT_APP}", "${DEFAULT_APP}@r13" or "${DEFAULT_APP}@latest"`);
  const [, app, rel] = m;
  const hasLocal = existsSync(join(DIST, "index.html"));
  if (!rel && !m[3] && hasLocal && app === DEFAULT_APP) return { app, url: `http://localhost:${PORT}/app/`, release: "local" };   // the local build (development)
  // otherwise a published release: the one asked for, or the latest (hosted: there is no local build)
  let n = rel ? Number(rel) : null;
  if (!n) { const r = await fetch(`${CONTROL}/w/${app}/releases.json`); if (!r.ok) throw new Error(`no published web artifact for ${app}`); n = (await r.json()).latest; }
  // Served through this process so the page and its mock backend share one origin (a page on https cannot fetch http://localhost).
  return { app, url: `http://localhost:${PORT}/w/${app}/r${n}/index.html`, release: n };
}
mkdirSync(DIR, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".css": "text/css" };
// Chromium starts after the server is listening (see the end of this file). Handlers await this shared promise.
const LAUNCH_TIMEOUT_MS = 60_000;
let launchBrowser;
const browserReady = new Promise((resolve, reject) => { launchBrowser = () => {
  const timer = setTimeout(() => reject(new Error(`Chromium did not start within ${LAUNCH_TIMEOUT_MS / 1000} s`)), LAUNCH_TIMEOUT_MS);
  const executablePath = arg("chromium", undefined);
  chromium.launch(executablePath ? { executablePath } : {}).then(resolve, reject).finally(() => clearTimeout(timer));
}; });
browserReady.catch((e) => { console.error(`sim: could not launch Chromium: ${e.message.split("\n")[0]}`); process.exit(1); });
const sessions = new Map();

const phone = { ...devices["Pixel 5"], viewport: { width: 393, height: 851 } };

async function newSession(id, opts = {}) {
  if (sessions.has(id)) await sessions.get(id).ctx.close();
  const target = await resolveApp(opts.app);
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify({ orders: [] })); writeFileSync(join(DIR, `${id}.json.log`), "");
  const browser = await browserReady;
  const ctx = await browser.newContext({ ...phone, colorScheme: opts.dark ? "dark" : "light" });
  await ctx.addInitScript((cfg) => { globalThis.__PN_SIM__ = cfg; }, { baseUrl: `http://localhost:${PORT}/s/${id}`, appId: target.app, appName: APP_NAME, seed_cart: opts.seed_cart ?? null, device: opts.device ?? null });
  const page = await ctx.newPage();
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  sessions.set(id, { ctx, page, app: target.app, release: target.release, startedAt: new Date().toISOString() });
}

// Refs are only meaningful for the document that issued them: a full page load restarts Playwright's counter, so an
// old "e5" would point at a different element. Each document gets an epoch; refs after the first load are "p<epoch>e5".
const DOCS = new WeakMap();
async function epochOf(page) {
  const id = await page.evaluate(() => (globalThis.__pnDoc ??= Math.random().toString(36).slice(2)));
  const d = DOCS.get(page);
  if (!d) DOCS.set(page, { id, epoch: 0 }); else if (d.id !== id) { d.id = id; d.epoch++; }
  return DOCS.get(page).epoch;
}
class SimError extends Error { constructor(code, message) { super(message); this.code = code; } }

async function screen(page) {
  await page.waitForTimeout(150);
  const epoch = await epochOf(page);
  // Phones only expose the items of a horizontal list that are on screen; hide the rest, as a phone would,
  // so an agent learns to swipe the rail ("scroll right <ref>") exactly as it must on a device.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-pn-offscreen]")) { el.removeAttribute("aria-hidden"); el.removeAttribute("data-pn-offscreen"); }
    // A modal sheet (accessibilityViewIsModal / aria-modal) hides everything behind it from assistive tech on phones.
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].pop();
    if (modal) for (let node = modal; node && node !== document.body; node = node.parentElement)
      for (const sib of node.parentElement?.children ?? []) if (sib !== node && !sib.hasAttribute("aria-hidden")) { sib.setAttribute("aria-hidden", "true"); sib.setAttribute("data-pn-offscreen", "1"); }
    for (const sc of document.querySelectorAll("div")) {
      const cs = getComputedStyle(sc);
      if (!/(auto|scroll)/.test(cs.overflowX) || sc.scrollWidth <= sc.clientWidth + 1) continue;
      const box = sc.getBoundingClientRect();
      const row = sc.firstElementChild; if (!row) continue;
      for (const item of row.children) {
        const r = item.getBoundingClientRect();
        if (r.right <= box.left + 1 || r.left >= box.right - 1) { item.setAttribute("aria-hidden", "true"); item.setAttribute("data-pn-offscreen", "1"); }
      }
    }
  });
  // What is hidden from assistive tech must not appear at all: this Playwright keeps aria-hidden nodes but strips
  // their names. `inert` removes them from the accessibility tree; it is set only for the snapshot and removed after.
  await page.evaluate(() => { for (const el of document.querySelectorAll('[aria-hidden="true"]')) { el.setAttribute("data-pn-prev-display", el.style.display || ""); el.style.setProperty("display", "none", "important"); } });
  const tree = await page.locator("body").ariaSnapshot({ mode: "ai" });
  await page.evaluate(() => { for (const el of document.querySelectorAll("[data-pn-prev-display]")) { const prev = el.getAttribute("data-pn-prev-display"); if (prev) el.style.display = prev; else el.style.removeProperty("display"); el.removeAttribute("data-pn-prev-display"); } });
  const lines = tree.split("\n").filter((l) => !/^\s*- generic \[ref=e\d+\]:?\s*$/.test(l));
  // A screen reader announces a control's label, not the words inside it (Android and iOS group a pressable's
  // children into one element). Drop the inner text lines of labelled controls, as the phones do.
  const out = []; let hideBelow = -1;
  for (const l of lines) {
    const indent = l.search(/\S/);
    if (hideBelow >= 0 && indent > hideBelow) continue;
    hideBelow = -1;
    if (/\[aria-hidden\]/.test(l)) { hideBelow = indent; continue; }   // hidden from assistive tech: not on screen
    out.push(l);
    if (/^\s*- (button|radio|link|checkbox|switch|tab) "[^"]+"/.test(l) && /:\s*$/.test(l)) hideBelow = indent;
  }
  const text = out.join("\n");
  return epoch ? text.replace(/\[ref=(e\d+)\]/g, `[ref=p${epoch}$1]`) : text;
}

function log(id, action, ok, extra = {}) { appendFileSync(join(DIR, `${id}.json.log`), JSON.stringify({ at: Date.now(), name: action, ok, ...extra }) + "\n"); }

async function act(id, body) {
  const s = sessions.get(id); if (!s) throw new SimError("no_session", `no session '${id}': call /session first`);
  const { page } = s;
  // A ref is valid only for the page it came from and while its element is unchanged. Re-snapshot first, so a node that
  // was re-rendered with new content has lost its old ref, then fail with a typed error instead of acting on anything else.
  const loc = (ref) => page.locator(`aria-ref=${ref}`);
  const resolve = async (ref) => {
    const m = /^(?:p(\d+))?(e\d+)$/.exec(String(ref));
    const stale = () => new SimError("stale_ref", `stale ref ${ref}: the screen changed. Take a new snapshot (action "screen") and use a ref from it.`);
    if (!m) return loc(ref);
    await screen(page);
    if (Number(m[1] ?? 0) !== DOCS.get(page).epoch) throw stale();
    const l = loc(m[2]);
    if ((await l.count()) !== 1) throw stale();
    return l;
  };
  const extra = {};
  if (INPUTS.has(body.action) && body.wait_for) checkWaitFor(body.wait_for);   // before anything is sent
  // Before an input is sent: is the element there, shown and enabled? If not, nothing reaches the app (safe to retry).
  const ready = async (l, ref, verb) => {
    if (!(await l.isVisible())) throw new SimError("not_visible", `${ref} is not visible on screen, so ${verb} was not sent. Scroll it into view or take a new snapshot.`);
    if (await l.isDisabled()) throw new SimError("disabled", `${ref} is disabled, so ${verb} was not sent.`);
  };
  // A click that Playwright could not deliver in time: covered by another element, or just too slow (unknown what happened).
  const clickTarget = async (l, ref) => {
    try { await l.click({ timeout: ACT_TIMEOUT }); }
    catch (e) {
      if (/intercepts pointer events/.test(String(e.message))) throw new SimError("covered", `${ref} is covered by another element, so the tap was not sent.`);
      if (e.name === "TimeoutError") throw new SimError("timeout", `the tap on ${ref} did not complete in time. Call screen to see whether it landed.`);
      throw e;
    }
  };
  switch (body.action) {
    case "screen": break;
    case "tap": { const l = await resolve(body.ref); await ready(l, body.ref, "the tap"); await clickTarget(l, body.ref); break; }
    case "type": {
      // A labelled text field may resolve to its wrapper; type into the real input inside it, as a phone focuses the field.
      let t = await resolve(body.ref);
      const kind = await t.evaluate((el) => (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) ? "field" : el.querySelector("input, textarea") ? "wrapper" : (el.getAttribute("aria-label") || el.textContent || "").trim(), { timeout: 3000 });
      if (kind === "wrapper") t = t.locator("input, textarea").first();
      else if (kind !== "field") {
        // Typing "on" a label or heading: a person would go to the field of that name. One match, or a clear error.
        const named = page.getByRole("textbox", { name: kind, exact: true });
        if ((await named.count()) !== 1) throw new SimError("not_text_field", `${body.ref} is not a text field, so the text was not sent. Type into a "textbox" ref.`);
        t = named;
      }
      await ready(t, body.ref, "the text");
      try { await t.fill(String(body.text ?? ""), { timeout: ACT_TIMEOUT }); }
      catch (e) { if (e.name === "TimeoutError") throw new SimError("timeout", `typing into ${body.ref} did not complete in time. Call screen to see what the field holds.`); throw e; }
      // The text has landed by now, so a failure here is its own reason.
      if (body.enter) { try { await t.press("Enter", { timeout: ACT_TIMEOUT }); } catch (e) { throw new SimError("enter_failed", `the text was typed into ${body.ref} but pressing Enter failed: ${String(e.message).split("\n")[0]}`); } }
      extra.value = await t.inputValue().catch(() => null);
      break;
    }
    case "scroll": {
      const target = body.ref ? await resolve(body.ref) : page.locator("body");
      if (body.ref) await ready(target, body.ref, "the scroll");
      const box = await target.boundingBox().catch(() => null);
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
      await page.mouse.wheel(body.direction === "right" ? 300 : body.direction === "left" ? -300 : 0, body.direction === "up" ? -600 : body.direction === "down" ? 600 : 0);
      break;
    }
    // Simulated device: what the phone "has" and what happens to it. See @shipvo/device.
    case "set_device": await page.evaluate((d) => globalThis.__pnDevice?.set(d), body.device ?? {}); break;
    case "push_notification": return { ...(await pushNotification(page, body)), screen: await screen(page) };
    case "notifications": return { notifications: await page.evaluate(() => globalThis.__pnDevice?.notifications() ?? []), screen: await screen(page) };
    case "open_notification": { const ok = await page.evaluate((nid) => globalThis.__pnDevice?.openNotification(nid), body.id); if (!ok) throw new Error("no such notification"); await page.waitForTimeout(400); break; }
    case "open_url": {
      if (typeof body.url !== "string" || !body.url) throw new SimError("bad_url", "open_url needs a url, such as myapp://item/3");
      const handled = await page.evaluate((u) => globalThis.__pnDevice?.openUrl(u), body.url);
      if (!handled) throw new SimError("no_url_listener", `the app has no URL listener, so it did not handle ${body.url}. Register one with onUrl from @shipvo/device.`);
      await page.waitForTimeout(400); break;
    }
    // Stub fetch/XHR on the page. Rules live on the session; unmatched requests continue untouched.
    case "set_network_mocks": {
      let rules; try { rules = parseMockRules(body.rules ?? []); } catch (e) { throw new SimError(e.code ?? "mock_invalid", e.message); }
      s.mocks = rules;
      if (!s.mockRoute) {
        s.mockRoute = true;
        await page.route("**/*", async (route) => {
          const req = route.request();
          const type = req.resourceType();
          const rule = (type === "fetch" || type === "xhr") && (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
          if (!rule) return route.fallback();
          if (rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
          // The app page may come from another origin, so the stub must pass the browser's CORS check.
          await route.fulfill({ status: rule.status, body: rule.body, headers: { "access-control-allow-origin": "*", ...rule.headers } }).catch(() => {});
        });
      }
      break;
    }
    case "device_log": return { log: await page.evaluate(() => globalThis.__pnDevice?.log() ?? []), capabilities: await page.evaluate(() => globalThis.__pnDevice?.capabilities() ?? null), screen: await screen(page) };
    case "diag": {
      const r = await page.evaluate(async () => {
        const cfg = globalThis.__PN_SIM__ ?? {}; const out = { baseUrl: cfg.baseUrl, origin: location.origin };
        try { const res = await fetch(`${cfg.baseUrl}/o/${cfg.appId ?? "tide"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: { id: "DIAG", lines: [], total: 0 } }) }); out.post = res.status; } catch (e) { out.postError = String(e); }
        try { const res = await fetch(`${cfg.baseUrl}/c/${cfg.appId}/content.json`); out.content = res.status; } catch (e) { out.contentError = String(e); }
        return out;
      });
      return { diag: r, screen: await screen(page) };
    }
    case "device_reset": await page.evaluate((d) => globalThis.__pnDevice?.reset(d), body.device ?? {}); break;
    case "back": { const b = page.getByRole("button", { name: "Back", exact: true }); if (await b.count()) await clickTarget(b.first(), "the Back button"); else throw new SimError("not_visible", "no Back button on this screen"); break; }
    case "screenshot": { const p = join(DIR, `${id}-${Date.now()}.png`); await page.screenshot({ path: p }); return { path: p, screen: await screen(page) }; }
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, tap, type, scroll, back, screenshot, set_device, push_notification, notifications, open_notification, open_url, device_log, device_reset, set_network_mocks`);
  }
  if (INPUTS.has(body.action)) {
    const t0 = Date.now();
    // The input has landed. A failure while waiting must not turn the reply into not_delivered.
    if (body.wait_for) { try { extra.wait_for = { ...(await waitFor(page, body.wait_for)), waited_ms: Date.now() - t0 }; } catch (e) { extra.wait_for = { matched: false, error: String(e.message).split("\n")[0], waited_ms: Date.now() - t0 }; } }
    if (body.settle) { try { extra.settled = await settle(page); } catch { extra.settled = false; } }
    return { screen: await screen(page), delivery: "delivered", safe_to_retry: false, ...extra };
  }
  return { screen: await screen(page) };
}

const INPUTS = new Set(["tap", "type", "scroll", "back"]);
// Reasons where the input never reached the app. A timeout is unknown, so it is not safe to retry.
const NOT_SENT = new Set(["stale_ref", "not_visible", "disabled", "covered", "not_text_field", "bad_wait_for"]);
// Reasons with an unknown outcome: timeout, enter_failed (text landed, Enter did not) and error (any other failure).
const UNKNOWN = new Set(["timeout", "enter_failed"]);
const deliveryOf = (action, e) => !INPUTS.has(action) || e.code === "no_session" ? {}
  : { delivery: "not_delivered", reason: NOT_SENT.has(e.code) || UNKNOWN.has(e.code) ? e.code : "error", safe_to_retry: NOT_SENT.has(e.code) };
// Per-action time limit (3 s). SIM_ACTION_TIMEOUT_MS lets a test force a timeout quickly.
const ACT_TIMEOUT = Number(process.env.SIM_ACTION_TIMEOUT_MS) || 3000;
const checkWaitFor = (w) => { if (!w || typeof w !== "object" || !(w.ref || w.text || w.role)) throw new SimError("bad_wait_for", "wait_for needs a ref, text or role. The action was not sent."); };

// wait_for: { ref | text | role + name, gone?, timeout_ms? }. Polls until the target is shown (or gone).
async function waitFor(page, w) {
  const end = Date.now() + Math.min(Math.max(Number(w.timeout_ms) || 5000, 100), 60_000);
  const present = async () => {
    if (w.ref) { await screen(page); const l = page.locator(`aria-ref=${String(w.ref).replace(/^p\d+/, "")}`); return (await l.count()) === 1 && await l.isVisible(); }
    const l = w.role ? page.getByRole(w.role, w.name ? { name: w.name } : {}) : page.getByText(String(w.text), { exact: false });
    return (await l.count()) > 0 && await l.first().isVisible();
  };
  for (;;) {
    const here = await present();
    if (here !== !!w.gone) return { matched: true };
    if (Date.now() >= end) return { matched: false };
    await page.waitForTimeout(100);
  }
}
// settle: wait until two snapshots 200 ms apart are equal (at most 5 s).
async function settle(page) {
  const end = Date.now() + 5000; let prev = await screen(page);
  while (Date.now() < end) { await page.waitForTimeout(200); const now = await screen(page); if (now === prev) return true; prev = now; }
  return false;
}

const WCACHE = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // CORS plus Chromium's private-network preflight: the app page comes from the public control plane (https) and
  // posts orders and telemetry to this loopback backend.
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-private-network": "true" };
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, ...CORS }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  try {
    if (req.method === "OPTIONS") return send(204, "", "text/plain");
    // the app's static web build
    if (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
      const p = join(DIST, decodeURIComponent(url.pathname)); if (existsSync(p)) return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // released web artifacts, proxied from the control plane and cached (immutable per release)
    if (url.pathname.startsWith("/w/")) {
      const key = url.pathname; let hit = WCACHE.get(key);
      if (!hit) { const r = await fetch(`${CONTROL}${key}`); if (!r.ok) return send(r.status, { error: "artifact" }); hit = { type: r.headers.get("content-type") ?? "application/octet-stream", body: Buffer.from(await r.arrayBuffer()) }; WCACHE.set(key, hit); }
      return send(200, hit.body, hit.type);
    }
    // a founder opening the printed link lands on the app
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") { res.writeHead(302, { location: "/app/", ...CORS }); return res.end(); }
    if (url.pathname.startsWith("/app/")) {
      let p = join(DIST, url.pathname.slice(5) || "index.html"); if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, "index.html");
      if (extname(p) === ".html") return send(200, withAppName(readFileSync(p, "utf8"), APP_NAME), MIME[".html"]);
      return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // mock control plane per session
    const m = url.pathname.match(/^\/s\/([\w-]+)\/(.*)$/);
    if (m) {
      const [, id, rest] = m;
      if (rest.startsWith("c/")) {
        // Use the same live content as devices when CONTENT_FROM points at a control plane; else the bundled default.
        if (process.env.CONTENT_FROM) { try { const r = await fetch(`${process.env.CONTENT_FROM}/${rest}`); if (r.ok) { res.writeHead(200, { "content-type": "application/json", ...CORS }); return res.end(await r.text()); } } catch {} }
        return send(404, { error: "no_content" });
      }
      if (rest === "orders" && req.method === "GET") { try { return send(200, JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"))); } catch { return send(404, { error: "no_session" }); } }
      if (rest.startsWith("o/") && req.method === "POST") {
        let b = ""; for await (const ch of req) b += ch;
        const f = join(DIR, `${id}.json`); const st = JSON.parse(readFileSync(f, "utf8")); st.orders.push(JSON.parse(b).order); writeFileSync(f, JSON.stringify(st));
        return send(202, { ok: true });
      }
      return send(202, { ok: true }); // telemetry etc.
    }
    // agent API
    if (req.method !== "POST") return send(404, { error: "not found" });
    let raw = ""; for await (const ch of req) raw += ch; const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/apps") return send(200, { ok: true, apps: [{ id: DEFAULT_APP, name: APP_NAME }] });
    if (url.pathname === "/sessions") return send(200, { ok: true, sessions: [...sessions.entries()].map(([id, s]) => ({ session: id, app: s.app, release: s.release, started_at: s.startedAt ?? null, url: s.page.url() })) });
    if (url.pathname === "/session") { await newSession(body.session, body); const s = sessions.get(body.session); log(body.session, "start", true, { app: s.app, release: s.release }); return send(200, { ok: true, app: s.app, release: s.release, screen: await screen(s.page) }); }
    if (url.pathname === "/act") {
      try { const r = await act(body.session, body); log(body.session, body.action, true, body.ref ? { ref: body.ref } : {}); return send(200, { ok: true, ...r }); }
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}), ...deliveryOf(body.action, e), screen: s ? await screen(s.page) : null }); }
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: String(e) }); }
});
// Agents and parity runs pause between actions; keep idle connections open well beyond Node's 5 s default.
server.keepAliveTimeout = 300_000; server.headersTimeout = 310_000; server.requestTimeout = 0;
server.listen(PORT, () => console.log(`Shipvo UI simulator on http://localhost:${PORT} (sessions in ${DIR})`));
launchBrowser();
