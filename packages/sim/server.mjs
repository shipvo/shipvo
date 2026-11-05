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

// Network mocks: rules are { url: string | { regex, flags }, method?, response: { status, body, headers?, delayMs? } }.
// A string url must equal the full request URL. Unmatched requests go on to the network. The first matching rule wins.
function parseMockRules(rules) {
  const bad = (m) => new SimError("mock_invalid", `mockNetwork: ${m}`);
  if (!Array.isArray(rules)) throw bad("rules must be an array");
  return rules.map((r, i) => {
    const at = `rule ${i}`;
    if (!r || typeof r !== "object") throw bad(`${at} must be an object`);
    let url = r.url;
    if (typeof url === "string" && url) { /* exact match */ }
    else if (url && typeof url === "object" && typeof url.regex === "string") { try { url = new RegExp(url.regex, url.flags ?? ""); } catch (e) { throw bad(`${at} has an invalid url pattern: ${e.message}`); } }
    else throw bad(`${at} needs a url: a non-empty string or a RegExp`);
    if (r.method !== undefined && (typeof r.method !== "string" || !/^[A-Za-z]+$/.test(r.method))) throw bad(`${at} has an invalid method`);
    const res = r.response;
    if (!res || typeof res !== "object") throw bad(`${at} needs a response: { status, body }`);
    if (!Number.isInteger(res.status) || res.status < 100 || res.status > 599) throw bad(`${at} response.status must be an integer from 100 to 599`);
    if (res.delayMs !== undefined && (typeof res.delayMs !== "number" || !(res.delayMs >= 0) || res.delayMs > 60000)) throw bad(`${at} response.delayMs must be a number from 0 to 60000`);
    if (res.headers !== undefined && (!res.headers || typeof res.headers !== "object" || Object.values(res.headers).some((v) => typeof v !== "string"))) throw bad(`${at} response.headers must map names to strings`);
    if (res.body !== undefined && res.body !== null && typeof res.body !== "string" && typeof res.body !== "object") throw bad(`${at} response.body must be a string or JSON value`);
    return { url, method: r.method?.toUpperCase(), response: res };
  });
}
async function setNetworkMocks(s, rules) {
  s.mocks = rules;
  if (s.mockRouted) return;
  s.mockRouted = true;
  await s.ctx.route("**/*", async (route) => {
    const req = route.request();
    const hit = (s.mocks ?? []).find((m) => (m.method ? m.method === req.method() : true) && (typeof m.url === "string" ? m.url === req.url() : m.url.test(req.url())));
    if (!hit) return route.fallback();
    const { status, body, headers, delayMs } = hit.response;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const isText = typeof body === "string";
    const h = { "access-control-allow-origin": "*", ...(isText || body == null ? {} : { "content-type": "application/json" }), ...(headers ?? {}) };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    return route.fulfill({ status, headers: h, body: body == null ? "" : isText ? body : JSON.stringify(body) });
  });
}

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
  const s = sessions.get(id); if (!s) throw new Error(`no session '${id}': call /session first`);
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
  switch (body.action) {
    case "screen": break;
    case "tap": await (await resolve(body.ref)).click({ timeout: 3000 }); break;
    case "type": {
      // A labelled text field may resolve to its wrapper; type into the real input inside it, as a phone focuses the field.
      let t = await resolve(body.ref);
      const kind = await t.evaluate((el) => (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) ? "field" : el.querySelector("input, textarea") ? "wrapper" : (el.getAttribute("aria-label") || el.textContent || "").trim(), { timeout: 3000 });
      if (kind === "wrapper") t = t.locator("input, textarea").first();
      else if (kind !== "field") {
        // Typing "on" a label or heading: a person would go to the field of that name. One match, or a clear error.
        const named = page.getByRole("textbox", { name: kind, exact: true });
        if ((await named.count()) !== 1) throw new Error(`${body.ref} is not a text field. Type into a "textbox" ref.`);
        t = named;
      }
      await t.fill(String(body.text ?? ""), { timeout: 3000 }); if (body.enter) await t.press("Enter"); break;
    }
    case "scroll": {
      const target = body.ref ? await resolve(body.ref) : page.locator("body");
      const box = await target.boundingBox().catch(() => null);
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
      await page.mouse.wheel(body.direction === "right" ? 300 : body.direction === "left" ? -300 : 0, body.direction === "up" ? -600 : body.direction === "down" ? 600 : 0);
      break;
    }
    // Simulated device: what the phone "has" and what happens to it. See @shipvo/device.
    case "set_device": await page.evaluate((d) => globalThis.__pnDevice?.set(d), body.device ?? {}); break;
    case "push_notification": await page.evaluate((n) => globalThis.__pnDevice?.push(n), { title: body.title ?? "", body: body.body ?? "", data: body.data ?? {} }); break;
    case "mock_network": await setNetworkMocks(s, parseMockRules(body.rules)); break;
    case "clear_network_mocks": await setNetworkMocks(s, []); break;
    case "notifications": return { notifications: await page.evaluate(() => globalThis.__pnDevice?.notifications() ?? []), screen: await screen(page) };
    case "open_notification": { const ok = await page.evaluate((nid) => globalThis.__pnDevice?.openNotification(nid), body.id); if (!ok) throw new Error("no such notification"); await page.waitForTimeout(400); break; }
    case "open_url": {
      if (typeof body.url !== "string" || !body.url) throw new SimError("bad_url", "open_url needs a url, such as myapp://item/3");
      const handled = await page.evaluate((u) => globalThis.__pnDevice?.openUrl(u), body.url);
      if (!handled) throw new SimError("no_url_listener", `the app has no URL listener, so it did not handle ${body.url}. Register one with onUrl from @shipvo/device.`);
      await page.waitForTimeout(400); break;
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
    case "back": { const b = page.getByRole("button", { name: "Back", exact: true }); if (await b.count()) await b.first().click(); else throw new Error("no Back button on this screen"); break; }
    case "screenshot": { const p = join(DIR, `${id}-${Date.now()}.png`); await page.screenshot({ path: p }); return { path: p, screen: await screen(page) }; }
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, tap, type, scroll, back, screenshot, set_device, push_notification, notifications, open_notification, open_url, device_log, device_reset, mock_network, clear_network_mocks`);
  }
  return { screen: await screen(page) };
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
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}), screen: s ? await screen(s.page) : null }); }
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: String(e) }); }
});
// Agents and parity runs pause between actions; keep idle connections open well beyond Node's 5 s default.
server.keepAliveTimeout = 300_000; server.headersTimeout = 310_000; server.requestTimeout = 0;
server.listen(PORT, () => console.log(`Shipvo UI simulator on http://localhost:${PORT} (sessions in ${DIR})`));
launchBrowser();
